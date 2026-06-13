# BEEO Energy-Audit Wave Engine — Full Build Plan

**Working codename:** `auditwave` (AuditWave HK) — domain to be purchased before go-live (e.g. `auditwavehk.com`); all repo/worker/DB names below use `auditwave` and are easy to rename.
**Architecture style:** Mirrors the proven NorwayContact stack (`/Norway/Norway_coldmails_service`) — Cloudflare Pages (Next.js static export) + 3 Cloudflare Workers + 1 D1 database + Cloudflare Queues + Stripe + Resend.
**Date:** 12 June 2026 · **Hard deadline driving the build:** BEEO Amendment commencement **20 September 2026** (≈14 weeks away).

---

## 1. What we're building (one paragraph)

A deadline-intelligence service for Hong Kong Registered Energy Assessor (REA) firms. A daily cron crawls the EMSD Energy Audit Form (EAF) register, computes each building's statutory next-audit deadline (pre-commencement EAFs: published expiry stands; audits conducted on/after 20 Sep 2026: audit date + 5 years), classifies buildings into the 9 newly-in-scope BEEO Schedule categories, drafts bilingual (EN/繁中) outreach memos for newly-triggered buildings, and delivers a weekly deadline-pipeline digest filtered by district and building type. Three flat-rate tiers as currently implemented: District HK$2,500/mo · Territory HK$5,000/mo · Exclusive vertical HK$9,000/mo. **Note:** the recurring subscription model assumes ongoing lead flow from the rolling pipeline of 10-year expiries + new building types; a one-time data purchase or annual model is a viable alternative if monthly churn proves too high.

**Key simplification vs NorwayContact:** no Gmail/Outlook OAuth at all. Subscribers *receive* digests from our own domain via Resend — we never send from their inboxes. This removes the entire OAuth surface (tokens, refresh, encryption, inbox-uniqueness, reconnect flows), which was the most complex and bug-prone part of the Norway codebase.

---

## 2. Repository & folder layout

Mirror the Norway monorepo-of-reference + per-deployable-repos pattern:

```
HongKong/BEEO/                        ← this folder = monorepo (reference + business docs)
├── BUILD_PLAN.md                     ← this file
├── Rec1_BEEO_Energy_Audit_Engine_EN.md / _ZH.md
├── README.md                         ← live-state doc (like Norway's README)
├── auditwave/                        ← Next.js website (own git repo → Cloudflare Pages)
│   ├── app/                          ← page.tsx, signup/, dashboard/, reconnect/,
│   │                                    privacy/, terms/, sample-report/
│   ├── components/                   ← HomePage.tsx, SignupPage.tsx
│   └── lib/                          ← content.ts (en/zh keys), config.ts, useLang.ts
├── workers/
│   ├── CLAUDE.md                     ← full backend context for Claude (like Norway)
│   ├── schema.sql                    ← D1 schema
│   ├── migrations/                   ← numbered migration files
│   ├── api/                          ← auditwave-api worker (own repo)
│   ├── cron/                         ← auditwave-cron worker (own repo)
│   └── stripe/                       ← auditwave-stripe worker (own repo)
└── business/                         ← invoices, billing docs (reuse Norway's reportlab generator)
```

| Deployable | GitHub repo | Deploys to | CI |
|---|---|---|---|
| Website | `auditwave` | Cloudflare Pages (direct GitHub integration, build `npm run build`, output `out/`) | automatic on push |
| API worker | `auditwave-api` | `auditwave-api.takshingchanai.workers.dev` | GitHub Actions `deploy.yml` |
| Cron worker | `auditwave-cron` | `auditwave-cron.takshingchanai.workers.dev` | GitHub Actions `deploy.yml` |
| Stripe worker | `auditwave-stripe` | `auditwave-stripe.takshingchanai.workers.dev` | GitHub Actions `deploy.yml` |

Cloudflare account `5900f27550c6ceb26233821ab0cd541c` (same as Norway). Each worker repo needs `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` secrets.

**New infra pieces not in Norway:**
- **R2 bucket `auditwave-crawl-cache`** — raw HTML snapshots of every crawled register page (audit trail, re-parse without re-crawling, crawl-block mitigation).
- **One Cloudflare Queue `auditwave-queue`** — multi-stage like Norway's email queue, but with crawl/classify/memo/digest message types.

---

## 3. D1 database — `auditwave-db`

No EU jurisdiction lock needed (HK product; building data is public registry data). Subscriber PII handled per HK PDPO — keep the Norway-style 90-day post-cancellation anonymisation cron.

### `workers/schema.sql` (draft)

```sql
-- Buildings discovered from the EMSD EAF register + open-data enrichment
CREATE TABLE IF NOT EXISTS buildings (
  id                 TEXT PRIMARY KEY,        -- stable hash of normalized address
  name_en            TEXT,
  name_zh            TEXT,                    -- Traditional Chinese building name
  address_en         TEXT,
  address_zh         TEXT,
  district           TEXT,                    -- one of the 18 HK districts (canonical EN key)
  lot_number         TEXT,
  building_type      TEXT,                    -- LLM-classified BEEO Schedule category
  is_new_scope       INTEGER NOT NULL DEFAULT 0,  -- 1 = one of the 9 new types (2026 amendment)
  classification_confidence REAL,             -- 0..1 from Haiku classifier
  classification_raw TEXT,                    -- JSON: full classifier output for audit/corrections
  storeys            INTEGER,
  year_built         INTEGER,
  gfa_sqm            REAL,
  lat                REAL,
  lng                REAL,
  enrich_source      TEXT,                    -- 'csdi' | 'datagovhk' | NULL
  first_seen         TEXT NOT NULL,           -- ISO date first observed in register
  last_seen          TEXT NOT NULL,
  created_at         TEXT NOT NULL
);

-- One row per EAF observed in the register (longitudinal — never delete)
CREATE TABLE IF NOT EXISTS eaf_records (
  id                 TEXT PRIMARY KEY,
  building_id        TEXT NOT NULL REFERENCES buildings(id),
  eaf_number         TEXT,
  expiry_date        TEXT NOT NULL,           -- ISO date published by the register — THE key field
  interval_years     INTEGER NOT NULL,        -- 10 (legacy, pre-commencement) or 5 (post-commencement audits)
  deadline           TEXT NOT NULL,           -- for pre-commencement EAFs: expiry_date; for post-commencement: audit_date + 5y
  code_edition       TEXT NOT NULL,           -- 'BEC2015/EAC2015' | 'BEC2024/EAC2024'
  source_page_r2_key TEXT,                    -- R2 key of the HTML snapshot this row was parsed from
  first_seen         TEXT NOT NULL,
  last_seen          TEXT NOT NULL,
  superseded_by      TEXT,                    -- id of a newer EAF for the same building (renewal detected)
  UNIQUE(building_id, issue_date)
);
CREATE INDEX IF NOT EXISTS idx_eaf_deadline ON eaf_records(deadline);

-- Newly-in-scope buildings with no EAF yet (the "September 2026 Wave List")
-- Sourced from open building datasets + classification; deadline = statutory first-audit date.
CREATE TABLE IF NOT EXISTS wave_targets (
  building_id        TEXT PRIMARY KEY REFERENCES buildings(id),
  statutory_deadline TEXT NOT NULL,           -- per transitional provisions
  memo_en            TEXT,                    -- Sonnet-drafted outreach memo (English)
  memo_zh            TEXT,                    -- Sonnet-drafted outreach memo (繁中)
  memo_generated_at  TEXT,
  exclusively_assigned_to TEXT REFERENCES clients(id)  -- Exclusive-tier claim, NULL = open
);

-- Registered Energy Assessors crawled from the EMSD REA register → prospect CRM
CREATE TABLE IF NOT EXISTS reas (
  registration_no    TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  company            TEXT,
  email              TEXT,
  phone              TEXT,
  address            TEXT,
  discipline         TEXT,                    -- BSE / electrical / etc. as listed
  expiry_date        TEXT,
  first_seen         TEXT NOT NULL,
  last_seen          TEXT NOT NULL,
  outreach_status    TEXT NOT NULL DEFAULT 'none',  -- 'none'|'seeded'|'contacted'|'replied'|'converted'|'opted_out'
  seeded_lead_building_id TEXT,               -- the free live lead we sent them
  last_contacted     TEXT
);

-- Subscribers (REA firms / consultancies) — simplified clients table, no OAuth columns
CREATE TABLE IF NOT EXISTS clients (
  id                 TEXT PRIMARY KEY,
  email              TEXT NOT NULL UNIQUE,    -- lowercase+trimmed at write time (Norway lesson)
  company            TEXT NOT NULL,
  contact_name       TEXT,
  language           TEXT NOT NULL DEFAULT 'zh',   -- 'zh' | 'en' — all system emails + digests
  tier               TEXT NOT NULL DEFAULT 'district', -- 'district' | 'territory' | 'exclusive'
  exclusive_vertical TEXT,                    -- e.g. 'data_centre' — only for exclusive tier
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_price_id    TEXT,
  next_billing_date  TEXT,
  trial_start        TEXT NOT NULL,
  trial_end          TEXT NOT NULL,           -- 14-day trial; sentinel '9999-12-31' = skip-trial
  status             TEXT NOT NULL DEFAULT 'trial',
    -- 'trial' → 'awaiting' → 'active' → 'cancelled' (or 'paused' on payment failure)
  payment_reminder_sent INTEGER NOT NULL DEFAULT 0,
  pause_digests      INTEGER NOT NULL DEFAULT 0,
  csv_export_enabled INTEGER NOT NULL DEFAULT 0,  -- territory + exclusive tiers
  created_at         TEXT NOT NULL,
  cancelled_at       TEXT
);

-- Many-to-many filters (analogous to Norway's client_industries)
CREATE TABLE IF NOT EXISTS client_districts (
  client_id TEXT NOT NULL REFERENCES clients(id),
  district  TEXT NOT NULL,
  PRIMARY KEY (client_id, district)
);
CREATE TABLE IF NOT EXISTS client_building_types (
  client_id     TEXT NOT NULL REFERENCES clients(id),
  building_type TEXT NOT NULL,
  PRIMARY KEY (client_id, building_type)
);

-- Exclusive-vertical lock: max 1 active buyer per vertical
CREATE UNIQUE INDEX IF NOT EXISTS idx_exclusive_vertical
  ON clients(exclusive_vertical) WHERE exclusive_vertical IS NOT NULL AND status != 'cancelled';

-- Digest delivery log (one row per digest email sent)
CREATE TABLE IF NOT EXISTS sent_digests (
  id           TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL REFERENCES clients(id),
  sent_at      TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end   TEXT NOT NULL,
  lead_count   INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'sent'   -- 'sent' | 'failed'
);

-- Which leads each client has already received (dedup across digests)
CREATE TABLE IF NOT EXISTS delivered_leads (
  client_id   TEXT NOT NULL REFERENCES clients(id),
  building_id TEXT NOT NULL,
  eaf_id      TEXT,                            -- NULL for wave_targets leads
  delivered_at TEXT NOT NULL,
  PRIMARY KEY (client_id, building_id)
);

-- Crawl bookkeeping
CREATE TABLE IF NOT EXISTS crawl_runs (
  id            TEXT PRIMARY KEY,
  source        TEXT NOT NULL,                 -- 'eaf_register' | 'rea_register' | 'csdi'
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  pages_fetched INTEGER NOT NULL DEFAULT 0,
  rows_new      INTEGER NOT NULL DEFAULT 0,
  rows_changed  INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'running', -- 'running'|'ok'|'error'|'blocked'
  error_detail  TEXT
);

-- Invoices (AW-YYYY-NNN numbering, same atomic MAX()+1 pattern as Norway)
CREATE TABLE IF NOT EXISTS invoices (
  id                TEXT PRIMARY KEY,
  client_id         TEXT NOT NULL REFERENCES clients(id),
  stripe_invoice_id TEXT,
  amount_hkd        INTEGER NOT NULL,
  period_start      TEXT NOT NULL,
  period_end        TEXT NOT NULL,
  issued_at         TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_stripe ON invoices(stripe_invoice_id)
  WHERE stripe_invoice_id IS NOT NULL;

-- Magic-link login (copy Norway design verbatim incl. multi_use column, migration 016 lesson)
CREATE TABLE IF NOT EXISTS login_tokens (
  token      TEXT PRIMARY KEY,
  client_id  TEXT NOT NULL REFERENCES clients(id),
  expires_at TEXT NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  multi_use  INTEGER NOT NULL DEFAULT 0
);

-- Email-level opt-out for REA outreach (copy Norway's unsubscribed_emails design)
CREATE TABLE IF NOT EXISTS unsubscribed_emails (
  email           TEXT PRIMARY KEY,
  unsubscribed_at TEXT NOT NULL
);
```

**Schema design notes (lessons imported from Norway's CodeChecking history):**
- All email writes lowercase+trim (Issue #44/#60 class).
- All text fields get server-side length caps and `typeof === 'string'` guards at the API boundary (Issues #91–#94).
- Atomic `UPDATE … RETURNING` for any claim-style query (Issue #97 — here: Exclusive-tier lead assignment).
- Invoice numbering via `MAX()+1` subquery inside INSERT (concurrency-safe).
- `cancelled_at` + 90-day anonymisation cron from day one (don't retrofit like Norway migration 013).

---

## 4. Worker 1 — `auditwave-cron` (the engine)

The heart of the product. Two cron triggers + one queue consumer.

### Cron schedule (`wrangler.toml`)

```toml
[triggers]
crons = [
  "0 18 * * *",   # 18:00 UTC = 02:00 HKT next day — daily crawl + classify + memo pipeline
  "0 0 * * 1"     # 00:00 UTC Monday = 08:00 HKT Monday — weekly digest assembly + fan-out
]

[[queues.producers]]
queue = "auditwave-queue"
binding = "PIPELINE_QUEUE"

[[queues.consumers]]
queue = "auditwave-queue"
max_batch_size = 1          # crawl politeness: one register page per invocation
max_retries = 3

[[r2_buckets]]
binding = "CRAWL_CACHE"
bucket_name = "auditwave-crawl-cache"
```

### Queue message types (single queue, `type` discriminator — Norway's 3-stage pattern extended)

| `type` | Producer | What the handler does |
|---|---|---|
| `crawl_page` | daily `scheduled()` | Fetch ONE EMSD register page (search-form POST with paging params), store raw HTML in R2, parse rows, upsert `buildings` + `eaf_records`, compute `deadline`. Enqueue next page with **delaySeconds 20–40s + jitter** (polite, ~rate of a human clicking). New/changed buildings → enqueue `classify`. |
| `classify` | `crawl_page` handler | One building → Claude **`claude-haiku-4-5`** call: classify into BEEO Schedule categories, flag `is_new_scope`, normalize bilingual name/address against CSDI lookup. Write `building_type`, `classification_confidence`. If newly triggered (new EAF expiry inside 18 months, or new-scope building) → enqueue `memo`. |
| `memo` | `classify` handler | One triggered building → Claude **`claude-sonnet-4-6`** call: draft bilingual outreach memo citing the correct code edition + exact statutory deadline + relevant ordinance section. Store in `wave_targets.memo_en/memo_zh` (or an `eaf_memos` column). Low daily volume by design. |
| `digest_dispatch` | weekly `scheduled()` | One message per active/trial client (chunked `sendBatch` ≤100 — Norway Issue #90). Selects this client's new leads (deadline window + district/type filters, minus `delivered_leads`), renders the digest, enqueues one `digest_email`. Exclusive tier: atomically claim verticals' leads via `UPDATE wave_targets SET exclusively_assigned_to = ? WHERE … RETURNING`. |
| `digest_email` | `digest_dispatch` | Send ONE digest via Resend (own subrequest budget per invocation, 2-min stagger + jitter — Norway deliverability pattern). Log to `sent_digests` + `delivered_leads`. |

### Also in daily `scheduled()` (DB-only, no API calls — Norway pattern)

- Trial management: day-12 payment reminder → day-14 expiry → `awaiting` → day-17 `paused`. Pause step ordered BEFORE expiry step (Norway Issue #77).
- Login-token cleanup.
- PDPO 90-day cleanup of cancelled clients (anonymise row, delete filters/digest logs, keep invoices).
- Crawl-health check: if last `crawl_runs` status is `error`/`blocked` 2 days running → alert email to `shing0012000@gmail.com`.
- Monthly (1st): REA register re-crawl enqueue (prospects change slowly).

### Crawl strategy details

1. **Backfill (one-time, weeks 1–2):** iterate the EAF register search by district to enumerate every building with an EAF since 2012. Run as a slow queue chain over several nights. Everything lands in R2 + D1 with `first_seen = backfill date`.
2. **Daily delta:** re-crawl recently-updated search slices + a rotating 1/30th of the full register (full refresh every month). Diff against D1: new EAF rows → renewals detected (`superseded_by`), disappeared rows → flag.
3. **Politeness/blocking mitigation:** ≤1 request per 20–40s, honest UA string with contact email, cache in R2, exponential backoff on non-200, `crawl_runs.status='blocked'` + alert rather than hammering.
4. **Deadline computation is pure code** (`lib/regulatory.ts`): interval selection (issue date vs amendment commencement, transitional provisions), code-edition mapping. Unit-test this exhaustively — it is the product's correctness core.
5. **CSDI/data.gov.hk enrichment:** separate `crawl_page`-style jobs against open CSV/API endpoints (no politeness constraints needed) populating storeys/age/geocode + the bilingual address graph.

### LLM integration (`lib/llm.ts`)

Raw `fetch` to `https://api.anthropic.com/v1/messages` from the Worker (no SDK dependency needed in Workers; keeps bundle small — same philosophy as Norway's raw Stripe/Resend calls).

Provider selected by `LLM_PROVIDER` env var (`"anthropic"` or `"openai"`); currently set to `"openai"`. Set `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` to match.

| Task | Anthropic model | OpenAI model | Volume | Est. cost |
|---|---|---|---|---|
| Building classification | `claude-haiku-4-5` | `gpt-4o-mini` | backfill ~2,556 once; ~50/day steady | backfill ≈ $5–15; ≈ $2/mo steady |
| Bilingual memo drafting | `claude-sonnet-4-6` | `gpt-4o` | ~10–30/day | ≈ $6–15/mo |

- Classification uses **structured outputs** (`output_config.format` json_schema: `{category, is_new_scope, confidence, name_zh, name_en, district}`) so parsing never breaks.
- Put the static Schedule-definitions system prompt first with `cache_control: {type:"ephemeral"}` — classification calls within a crawl run hit the prompt cache (5-min TTL fits the queue cadence).
- `ANTHROPIC_API_KEY` as a Worker secret on cron only.
- Total LLM + Cloudflare cost comfortably inside the proposal's US$50–150/mo envelope.

### Manual test endpoints (guarded by `CRON_TRIGGER_KEY` — Norway pattern)

- `GET /trigger-crawl?key=` — kick one crawl cycle
- `GET /trigger-digest?key=` — kick digest assembly
- `GET /classify-one?key=&building_id=` — re-run classifier on one building
- `GET /health?key=` — last crawl_run, queue depths, counts

---

## 5. Worker 2 — `auditwave-api`

Direct port of Norway's api worker minus all OAuth code. Endpoints:

| Endpoint | Method | Notes |
|---|---|---|
| `/api/signup` | POST | company, email, language, tier, districts[], building_types[]; 14-day trial; welcome email (bilingual template). Cancelled re-signups → `awaiting`, no second trial. All Norway input-validation lessons applied (type guards, length caps, array caps ≤ 20 districts / ≤ 15 types). |
| `/api/status?id=` | GET | dashboard data: tier, filters, trial days left, plan info, next_billing_date, recent digests |
| `/api/client` | PATCH | session-cookie-gated; edit filters, language, pause_digests |
| `/api/filters` | PUT | replace district/type selections |
| `/api/cancel` | POST | active → Stripe `cancel_at_period_end=true`; trial/awaiting/paused → immediate (incl. immediate Stripe `/cancel` to stop retries — Norway Issue #78) |
| `/api/change-plan` | POST | upgrades only (2,500 < 5,000 < 9,000), DB-first write + compensating revert (Norway Issue #69); Exclusive upgrades validate vertical availability against the partial unique index |
| `/api/login/request` | POST | magic link via Resend |
| `/api/login/verify?token=` | GET | sets HMAC-signed `aw_session` HttpOnly cookie (HKDF-derived key — Norway Issue #87); multi_use tokens for email-embedded dashboard links |
| `/api/leads.csv?from=&to=` | GET | session-gated CSV export — Territory + Exclusive tiers only |
| `/api/sample-digest` | GET | public: returns the current free "BEEO 2026 readiness" sample (SEO/lead magnet) |
| `/api/unsubscribe` | GET/POST | HMAC-token-verified opt-out for REA outreach emails (verbatim Norway design) |

Session auth, CORS (`https://<domain>`), email normalisation, `TOKEN_ENCRYPTION_KEY` HKDF sub-keys — all copied from Norway.

---

## 6. Worker 3 — `auditwave-stripe`

Near-verbatim port of `norgeconnect-stripe`:

| Event | Action |
|---|---|
| `customer.subscription.created` | price ID → tier (`district`/`territory`/`exclusive`); set `csv_export_enabled`; for Exclusive, claim the vertical (fail → alert + manual resolution); activate; confirmation email |
| `invoice.paid` | log invoice `AW-YYYY-NNN` (dedup on `stripe_invoice_id`), ensure active, sync `next_billing_date`, confirmation email with PDF link (`invoice.invoice_pdf`) |
| `invoice.payment_failed` | pause client; alert email; dedup guard (skip if already paused); cancelled-client guard (Norway Issue #98) |
| `customer.subscription.deleted` | cancel; release `exclusive_vertical`; `cancelled_at = COALESCE(...)`; confirmation email |

Carry over: signature verification with timestamp + `isNaN` check (Issue #79), Stripe API-version field locations (`invoice.parent.subscription_details.subscription`, `items.data[0].current_period_end`), customer-ID email fallback.

**Stripe setup tasks (existing Stripe HK account, currency HKD):**
1. Product "AuditWave HK" with 3 monthly prices: HK$2,500 / HK$5,000 / HK$9,000 (+ optional founding-member HK$2,500-forever coupon for the first 30 conversions, per the 90-day plan).
2. Payment links with `?prefilled_email=` support.
3. Webhook endpoint → `auditwave-stripe.…workers.dev`, events as above.
4. Record price IDs as wrangler vars `STRIPE_PRICE_ID_DISTRICT/TERRITORY/EXCLUSIVE` on api + stripe workers.

---

## 7. Website — `auditwave/` (Next.js static export)

Clone the norgeconnect structure; the language pair changes from NO/EN to **繁中/EN** (Traditional Chinese default — buyers are HK engineering firms).

- `lib/useLang.ts` — localStorage key `aw_lang`, default `'zh'`.
- `lib/content.ts` — every string with `{zh, en}` keys. District names and the 18-district picker live here (canonical EN keys + 繁中 labels), plus the BEEO building-type taxonomy (the 9 new categories + legacy commercial).
- **Pages:**
  - `/` — Hero ("Every building's statutory energy-audit deadline. Before your competitors see it."), How it works, **live counter** ("X buildings enter the audit regime on 20 Sep 2026"), sample digest preview, pricing (3 tier cards), FAQ, footer.
  - `/signup` — tier picker (3 cards; Exclusive shows live vertical availability via a public `/api/verticals` check), district multi-select (18 districts, disabled for Territory/Exclusive = all), building-type multi-select, language toggle, email. **No card required** for 14-day trial; optional skip-trial toggle (Norway pattern, sentinel `trial_end='9999-12-31'`).
  - `/dashboard` — stats tiles (leads delivered this month, total pipeline value est., trial days left, plan), filter editor, recent digests list, CSV export button (tier-gated), billing row (plan + next billing date from D1), payment buttons for awaiting/paused, branded cancel modal with status-aware copy (Norway Issues #82/#83).
  - `/reconnect` — magic-link login (bilingual).
  - `/sample-report` — the free "BEEO 2026 Readiness" mini-report (SEO/LinkedIn authority play from the 90-day plan; static page regenerated monthly from real data).
  - `/privacy`, `/terms` — PDPO-compliant privacy policy; terms with data-accuracy disclaimer ("intelligence service, not legal advice; verify against the official register").

---

## 8. Email system (Resend)

- Sender: `hello@<domain>` via Resend. DNS tasks at go-live: DKIM, SPF (send subdomain), DMARC `p=quarantine` — set wherever the domain's DNS lives, verify all three in Resend before first digest (Norway lesson: Resend doesn't manage DMARC).
- **All system emails** use the Norway standardised `<!DOCTYPE html>` template (recolored header, card body, grey footer), bilingual by `client.language`. Inventory: welcome, skip-trial welcome, magic link, payment reminder (day 12), trial summary, **weekly digest**, payment confirmed, payment failed, cancellation, crawl-failure operator alert.
- **Weekly digest content:** grouped by urgency band (overdue / due ≤6 months / due ≤18 months / new-scope wave), each lead = building name (bi-lingual), district, type, deadline date, code edition, and the Sonnet memo as an expandable "suggested outreach" block. Footer: dashboard link (multi_use token), List-Unsubscribe headers on everything non-login.
- **REA prospecting emails (sales channel):** one-off seeded emails containing a single free live lead, sent via Resend from the cron worker on manual trigger (`/seed-prospects?key=&batch=10`). Tracked in `reas.outreach_status`. Opt-out honoured via `unsubscribed_emails`. Low volume (30 firms over weeks 7–9), warmed gradually — new-domain reputation lesson from Norway applies.

---

## 9. Secrets & plain vars

| Secret | Workers |
|---|---|
| `STRIPE_SECRET_KEY` | api, cron, stripe |
| `STRIPE_WEBHOOK_SECRET` | stripe |
| `RESEND_API_KEY` | api, cron, stripe |
| `ANTHROPIC_API_KEY` | cron (if `LLM_PROVIDER="anthropic"`) |
| `OPENAI_API_KEY` | cron (if `LLM_PROVIDER="openai"` — current default) |
| `TOKEN_ENCRYPTION_KEY` | api, cron (sessions, unsubscribe HMAC, login HKDF sub-keys) |
| `CRON_TRIGGER_KEY` | cron |

| Var | Value |
|---|---|
| `SITE_URL` | `https://www.<domain>` |
| `CORS_ORIGIN` | `https://<domain>` |
| `SYSTEM_FROM_EMAIL` | `hello@<domain>` |
| `PAYMENT_LINK_DISTRICT/TERRITORY/EXCLUSIVE` | Stripe payment links |
| `STRIPE_PRICE_ID_*` | three price IDs |
| `EMSD_EAF_BASE` / `EMSD_REA_BASE` | register URLs (config, not hardcoded — selector drift mitigation) |

---

## 10. Build phases (mapped to the proposal's 90-day plan, with test gates)

Per the standing instruction, **every phase ends with tests run and logs checked** (`npx wrangler tail` + `/health` endpoint) before the next phase starts.

### Phase 0 — Scaffolding (days 1–3)
Create 4 repos, D1 DB, queue, R2 bucket; apply `schema.sql`; deploy 3 hello-world workers + blank Pages site; wire GitHub Actions.
**Test gate:** all 4 deploys green; `wrangler d1 execute … "SELECT 1"` remote OK.

### Phase 1 — Crawler + deadline engine (weeks 1–3)
1. `lib/regulatory.ts` — interval/code-edition/transitional logic. **Unit tests first** (vitest, ~30 cases incl. edge dates around 20 Sep 2026).
2. EAF register page fetcher + parser (HTML → rows). Build against live pages; snapshot 5 sample pages into the repo as parser fixtures.
3. `crawl_page` queue chain with politeness delays; R2 snapshotting; `crawl_runs` bookkeeping.
4. REA register crawler (same machinery, different parser) → `reas` table.
5. Launch the **backfill** (runs over several nights).
**Test gate:** vitest green; manual `/trigger-crawl` run crawls ≥3 pages and upserts rows with correct deadlines (spot-check 10 against the live register); tail logs clean; backfill progressing in `/health`.

### Phase 2 — LLM classification + Wave List (weeks 4–6)
1. `classify` handler with Haiku + structured outputs + prompt caching; confidence threshold (< 0.7 → `building_type='unclassified'` for manual review list).
2. CSDI/data.gov.hk enrichment jobs (bilingual address graph, storeys, age, geocode).
3. Cross-reference open building datasets against the 9 new Schedule types → populate `wave_targets` ("September 2026 Wave List").
4. `memo` handler with Sonnet — bilingual memo prompt citing Cap. 610 sections + deadline; generate for top wave targets.
**Test gate:** classify 50 known buildings, manually verify ≥90% category accuracy; memos for 10 buildings read correct in both languages (correct code edition, correct deadline, no hallucinated ordinance text — verify citations against elegislation); cost telemetry in logs matches estimates.

### Phase 3 — Digest pipeline + website + signup (weeks 7–9)
1. `digest_dispatch`/`digest_email` queue stages; lead selection query (filters + dedup + urgency bands); Exclusive atomic claim.
2. api worker: signup, magic link, dashboard endpoints, CSV export.
3. Website: all pages, bilingual content, sample report.
4. Resend domain verification (buy domain first), email templates.
5. Stripe products/links/webhook + stripe worker.
6. Seed-prospect machinery + first 10 seeded REA emails (real leads from the backfilled DB).
**Test gate:** end-to-end dry run with my own email (`shing0012000@gmail.com` — never fake addresses, Norway bounce-rate rule): signup → welcome → filters → forced digest via `/trigger-digest` → digest received with correct leads → Stripe test-mode payment → activation email → cancel flow. Tail all three workers during the run. Lighthouse + mobile pass on the site.

### Phase 4 — Launch + convert (weeks 10–13)
1. Seed remaining ~20 REA firms (1 free live lead each).
2. Founding-member pricing comms; publish the free readiness mini-report; LinkedIn posts.
3. Switch Stripe to live mode; first paid onboardings.
4. Ops hardening: crawl-failure alerting verified by simulating a blocked crawl; weekly manual review of `unclassified` buildings (feeds the prompt-correction corpus — moat #3).
**Test gate:** first real subscriber receives 2 consecutive correct weekly digests; invoice email + PDF correct; `/health` clean for 14 consecutive days.

### Phase 5 (post-launch, weeks 14+) — MBIS Repair-Order Radar
Reuses: crawl machinery, queue pipeline, classification/memo handlers (prompt swap), digest fan-out, api/stripe workers, website shell. Per the proposal, ~80% shared — budget 6–8 weeks.

---

## 11. What's copied from Norway vs new vs dropped

| Copied (port with renames) | New (BEEO-specific) | Dropped |
|---|---|---|
| 3-worker + D1 + queue architecture | EMSD register crawler + parser | All Gmail/Outlook OAuth (~40% of Norway api+cron code) |
| Status flow trial→awaiting→active→paused/cancelled + trial cron | Regulatory deadline engine (`regulatory.ts`) | Inbox uniqueness / trial-abuse-by-inbox checks |
| Magic link + session cookies (HKDF) | LLM classify/memo pipeline (Haiku/Sonnet) | Per-target cold-email sending on clients' behalf |
| Stripe webhook handler incl. all dedup/guard fixes | R2 crawl cache | Logo upload/serving |
| Resend templates + List-Unsubscribe + bilingual rendering | Wave List + Exclusive-vertical locking | Stripe usage meters (Norway confirmed orphaned anyway) |
| Queue stagger/jitter + sendBatchChunked | CSV export endpoint | revenue_band filtering |
| Invoice numbering + PDF generator (business/) | REA prospect CRM + seeding | |
| Input-validation hardening (Issues #60–#95 class) | Crawl-health alerting | |
| GDPR→PDPO 90-day anonymisation cron | 18-district / building-type filter model | |

---

## 12. Risk register (build-relevant)

| Risk | Mitigation in this plan |
|---|---|
| EMSD register HTML changes (selector drift) | Parser fixtures in repo; R2 snapshots allow re-parse; crawl-health alert within 24h; register URLs as config vars |
| Crawl blocking | Politeness budget (1 req/20–40s), backoff, `blocked` status + alert, R2 cache means we never re-fetch what we have |
| Classification errors embarrass us with paying clients | Confidence threshold + manual review queue; digest footer "verify against official register"; corrections feed prompt corpus |
| Amendment commencement slips past 20 Sep 2026 | Rolling 10-year renewals still produce weekly leads; deadline engine takes commencement date as config |
| Memo hallucinates ordinance text | Memo prompt only allows citing from a vetted statute-snippet library embedded in the prompt (no free recall); Phase-2 test gate checks citations |
| Exclusive tier double-sell | Partial unique index + atomic claim; webhook failure path alerts for manual resolution |
| New-domain email reputation (digests junked) | Buy domain at Phase-3 start (≥4 weeks before first paid digest); full DKIM/SPF/DMARC; low-volume warm-up via seeded prospect emails |
| Monthly subscription hard to justify if data changes slowly | The register is mostly static; a competitor can one-time scrape the same data. Subscription value must come from the rolling pipeline of expiries + ongoing outreach execution, not data freshness. Evaluate one-time data purchase (HK$3,000–8,000) or annual model as alternatives before or after first paying cohort. |
| Raw data is not a defensible moat | The competitive advantage is the regulatory computation layer (transitional provision logic) + classification accuracy + bilingual memo quality — not data access. Pitch accordingly. |

---

## 13. Immediate next actions

1. Confirm/choose product name + buy domain (blocks Resend setup, nothing else — Phases 0–2 don't need it).
2. Phase 0 scaffolding (half a day).
3. Start Phase 1 with `regulatory.ts` + its unit tests — the highest-value, zero-dependency piece — while inspecting the live EMSD register pages to design the parser.
