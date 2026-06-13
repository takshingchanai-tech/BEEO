# AuditWave Workers — Claude Context

## What this folder is
Three Cloudflare Workers powering the AuditWave HK backend (BEEO energy-audit deadline
intelligence). Architecture mirrors NorwayContact (`Norway_coldmails_service/workers`),
minus all OAuth (digests are sent from our own domain via Resend).

## Live infrastructure (account 5900f27550c6ceb26233821ab0cd541c)

| Resource | Name / URL | ID |
|---|---|---|
| API worker | https://auditwave-api.takshingchanai.workers.dev | — |
| Cron worker | https://auditwave-cron.takshingchanai.workers.dev | — |
| Stripe worker | https://auditwave-stripe.takshingchanai.workers.dev | — |
| Website | https://auditwave.pages.dev (Pages project `auditwave`) | — |
| D1 | `auditwave-db` | `99a57571-2f63-42ec-b904-718759df423d` |
| Queue | `auditwave-queue` | `efd03154e0f345eb845b22a0d6e4e171` |
| R2 | `auditwave-crawl-cache` | — |

Apply schema: `npx wrangler d1 execute auditwave-db --remote --file=workers/schema.sql`

## Data source (verified live 2026-06-12)

- EAF register EN: `https://www.emsd.gov.hk/beeo/en/register/search_eaf.php`
- EAF register TC: `https://www.emsd.gov.hk/beeo/tc/register/search_eaf.php`
- A plain GET returns the ENTIRE register (~2,748 rows, ~1.8 MB) server-rendered.
  Each `<tr>` carries data attributes: `data-name`, `data-addr`, `data-expiry_date`
  (DD/MM/YYYY), `data-eui`, `data-eui2`, `data-prev_expiry_date`, `data-prev_eui`,
  `data-rea`. The register publishes EXPIRY dates, not issue dates.
- Official bulk XLSX also exists: `https://www.emsd.gov.hk/beeo/en/pee/ea__full_list.xlsx`
  (bilingual names + EUI, but NO expiry dates / REA numbers — HTML page is primary).
- EN/TC rows sort differently; joined on composite key (rea, expiry, eui, prev_expiry,
  prev_eui) — 100% match rate on live data (`parser.ts joinBilingual`).
- Demolished buildings carry a `(已拆卸)` / `(Demolished)` name prefix → `is_demolished`.
- REA register URL from the proposal 404s — actual location TBD (prospect CRM blocked on this).
- Parser fixtures snapshotted in `cron/test/fixtures/` — keep in sync if EMSD changes layout.

## auditwave-cron (the engine)

Crons: `0 18 * * *` (= 02:00 HKT daily) and `0 0 * * 1` (= 08:00 HKT Monday digest).
Queue messages (one queue, `type` discriminator):

| type | does |
|---|---|
| `crawl` | Fetch EN+TC register pages, snapshot to R2 (`eaf/YYYY-MM-DD/{en,tc}.html`), parse+join, upsert buildings/eaf_records with computed deadlines, record crawl_runs, enqueue classify (≤200) and memo (≤20) jobs |
| `classify` | One building → `claude-haiku-4-5` structured output: building_type, district, confidence. `confidence < 0.7` → stored as `unknown` (manual review pool). Skipped+acked if ANTHROPIC_API_KEY unset |
| `memo` | One EAF → `claude-sonnet-4-6` bilingual outreach memo. Hallucination guard: prompt embeds the only citable statutory facts |
| `digest_dispatch` | One client → select new leads (deadline ≤18mo, filters, minus delivered_leads), enqueue digest_email |
| `digest_email` | Render + send one digest via Resend; write sent_digests + delivered_leads |

Daily `scheduled()` also runs: trial management (pause BEFORE expiry — Norway #77),
login-token cleanup, PDPO 90-day anonymisation, crawl-health watchdog (alerts
ALERT_EMAIL after 2 consecutive failed runs).

**Regulatory engine** (`cron/src/regulatory.ts`): All constants in `DEFAULT_CONFIG`
(commencement 2026-09-20). 24 unit tests in `cron/test/`.

**CONFIRMED RULE — Schedule 5, Part 2 (Ord. No. 24 of 2025) + EMSD official guidance (pms2025-1.pdf):**
  Dividing line = date the audit was CONDUCTED (issueDate = expiry − 10y = audit start date).
  → Audit conducted BEFORE 20 Sep 2026: next interval remains 10 years (published expiry stands).
  → Audit conducted ON/AFTER 20 Sep 2026: next interval is 5 years from that audit date.
  Impact: virtually all existing EAFs keep their original published expiry.
  Example: audited 2022 (expiry 2032) → deadline remains 2032.
  Product value: pipeline of upcoming 10-year expiries + new building types 3–11 entering the regime.

Manual triggers (need `?key=$CRON_TRIGGER_KEY`, key in `cron/.cron_trigger_key`, gitignored):
`/trigger-crawl` `/trigger-digest` `/classify-batch?n=` `/trigger-trials` `/health`

## auditwave-api

| Endpoint | Method | Notes |
|---|---|---|
| `/api/signup` | POST | company/email/language/tier/districts[]/building_types[]; 14-day trial; cancelled re-signup → `awaiting` (no 2nd trial, sentinel trial dates 9999-12-31); exclusive tier checks vertical availability (409 if taken) |
| `/api/status?id=` | GET | full client state + filters + recent digests |
| `/api/client` | PATCH | session-gated: language, pause_digests, contact_name |
| `/api/filters` | PUT | session-gated: replace district/type selections |
| `/api/cancel` | POST | session-gated: active → Stripe cancel_at_period_end; others immediate + Stripe /cancel (stops retries, Norway #78) |
| `/api/login/request` | POST | magic link (no account enumeration) |
| `/api/login/verify?token=` | GET | sets `aw_session` HMAC cookie (HKDF salt `auditwave-session-tokens`), redirects to /dashboard. multi_use tokens skip used-flag |
| `/api/leads.csv` | GET | session-gated; territory/exclusive only (csv_export_enabled) |
| `/api/verticals` | GET | public: which exclusive verticals are taken/available |
| `/api/unsubscribe` | GET/POST | HMAC-token-verified (salt `auditwave-unsubscribe`) |

Sessions: 30-day HttpOnly SameSite=None cookie. All inputs type-guarded + length-capped
(Norway #91–#94 class). Emails lowercased+trimmed at every write.

Email links go to `SITE_URL/api-login?token=…` (static page on the site) which forwards
to the api worker verify endpoint — keeps email links on the product domain.

## auditwave-stripe

Same 4 events as Norway with the same guards: signature verify (timestamp + isNaN,
Norway #79), payment_failed dedup (skip if already paused) + cancelled-client guard
(Norway #98), invoice dedup on stripe_invoice_id, atomic AW-YYYY-NNN numbering,
customer-ID email fallback with backfill. Tier from price ID
(`STRIPE_PRICE_ID_DISTRICT/TERRITORY/EXCLUSIVE` vars — NOT yet set).
Cancellation releases `exclusive_vertical`.

## Secrets status

| Secret | Worker | Status |
|---|---|---|
| `CRON_TRIGGER_KEY` | cron | ✅ set (value in `cron/.cron_trigger_key`) |
| `TOKEN_ENCRYPTION_KEY` | api | ✅ set |
| `ANTHROPIC_API_KEY` | cron | ❌ NOT SET — classify/memo stages skip until set |
| `RESEND_API_KEY` | api, cron, stripe | ❌ not set — EMAIL_DRY_RUN="1" logs instead of sending |
| `STRIPE_SECRET_KEY` | stripe (+api for cancel) | ⚠️ placeholder on stripe; not set on api |
| `STRIPE_WEBHOOK_SECRET` | stripe | ⚠️ placeholder |

## Go-live checklist (remaining)

1. `cd workers/cron && npx wrangler secret put ANTHROPIC_API_KEY` → then backfill
   classification: `curl ".../classify-batch?key=$KEY&n=500"` repeatedly (~2,556 buildings,
   haiku, ~US$15 total). District/type filters only fully work after this.
2. Buy domain (auditwavehk.com or other) → attach to Pages project → update SITE_URL /
   CORS_ORIGIN / API_BASE (site `lib/config.ts`) → Resend domain + DKIM/SPF/DMARC →
   `wrangler secret put RESEND_API_KEY` on all 3 workers → set `EMAIL_DRY_RUN="0"`.
3. Stripe: create product + 3 HKD monthly prices (2500/5000/9000) + payment links +
   webhook → set secrets + price-ID vars + payment links (site `lib/config.ts`).
4. ✅ RESOLVED: Transitional provisions confirmed by Ord. No. 24 of 2025 + EMSD guidance.
   computeDeadlines() updated: pre-commencement audits keep 10-year expiry. 24 tests green.
   After deploying cron worker, crawl-computed deadlines in D1 will equal published expiry
   for virtually all existing buildings — run trigger-crawl to refresh if needed.
5. Find the relocated REA register URL → build reas crawler (prospect CRM).
6. GitHub repos + Actions auto-deploy (currently deployed manually via wrangler).

## Test state (2026-06-13)

- 24/24 unit tests green (`cd workers/cron && npm test`).
- Live crawl verified: 2,748 rows → 2,556 buildings + 2,617 EAF records, R2 snapshots OK.
- Regulatory fix applied (13 Jun): computeDeadlines() now correctly returns legacyExpiry for
  pre-commencement audits. Virtually all existing buildings keep their published 10-year expiry.
  D1 deadline_new_regime values will be refreshed on next crawl run.
- Districts pre-filled deterministically for ~786 HK-Island buildings (address keywords)
  so the digest pipeline could be tested before classification runs; classifier will
  overwrite/extend.
- Digest E2E verified twice with dedup (80 distinct leads to test client) in dry-run mode.
- Test client: shing0012000@gmail.com (id 748f3c0a-…) — currently `awaiting` after
  re-signup test. Never use fake emails for signups (Resend bounce-rate rule).
