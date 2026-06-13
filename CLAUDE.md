# AuditWave HK (BEEO) — Claude Context

Statutory energy-audit deadline intelligence for Hong Kong REA firms. Crawls the EMSD
EAF register daily, computes each building's next-audit deadline under the Buildings
Energy Efficiency (Amendment) Ordinance 2025 (commencement **20 Sep 2026**), classifies
buildings with Claude, and emails subscribers a weekly bilingual (繁中/EN) lead digest.

Architecture deliberately mirrors NorwayContact
(`../../Norway/Norway_coldmails_service`) — Cloudflare Pages + 3 Workers + D1 + Queues +
Stripe + Resend — **minus all Gmail/Outlook OAuth** (digests are sent from our own
domain via Resend). When implementing backend changes, consult Norway's
`workers/CLAUDE.md` + README first: they document ~100 fixed bugs (CodeChecking issues)
whose patterns this codebase imports as design rules.

## Key documents

| File | Contents |
|---|---|
| `workers/CLAUDE.md` | **Full backend context** — live infra IDs, data-source findings, endpoint tables, secrets status, go-live checklist. Read this before touching workers. |
| `BUILD_PLAN.md` | Original build plan (phases, schema rationale, risk register) |
| `README.md` | Live-state overview + common commands |
| `Rec1_BEEO_Energy_Audit_Engine_EN.md` / `_ZH.md` | Business proposal |

## Layout

```
auditwave/        Next.js 16 static export (output:"export") → Cloudflare Pages "auditwave"
                  lib/content.ts = ALL copy with {zh,en} keys · lib/useLang.ts (aw_lang, default zh)
workers/
  schema.sql      D1 schema (13 tables) — apply: npx wrangler d1 execute auditwave-db --remote --file=workers/schema.sql
  cron/           Crawl engine + LLM pipeline + digests + trials (the core product)
  api/            Signup / magic-link login / dashboard / filters / cancel / CSV
  stripe/         Webhook handler (HKD: district 2,500 / territory 5,000 / exclusive 9,000)
```

## Live infrastructure (Cloudflare account 5900f27550c6ceb26233821ab0cd541c)

- Site: https://auditwave.pages.dev (domain not yet purchased — SITE_URL/CORS point here)
- Workers: `auditwave-api` / `auditwave-cron` / `auditwave-stripe` (.takshingchanai.workers.dev)
- D1 `auditwave-db` (`99a57571-2f63-42ec-b904-718759df423d`) · Queue `auditwave-queue` · R2 `auditwave-crawl-cache`
- Crons: daily crawl 18:00 UTC (02:00 HKT) · weekly digest Mon 00:00 UTC (08:00 HKT)

## Hard rules

- **Never use fake/random email addresses for test signups** (Resend bounce-rate rule).
  Use `shing0012000@gmail.com`. Current test client is that address.
- **After building or changing features, always run the tests and check the logs until
  everything works**: `cd workers/cron && npm test`, deploy, then
  `npx wrangler tail <worker> --format=pretty` while exercising the change, and check
  `/health?key=$(cat workers/cron/.cron_trigger_key)` on the cron worker.
- `workers/cron/.cron_trigger_key` holds the trigger key — gitignored, never commit it.
- Emails are lowercased+trimmed at every write. All API inputs get `typeof` guards and
  length caps. Claim-style queries use atomic `UPDATE … RETURNING`.
- The regulatory engine (`workers/cron/src/regulatory.ts`) is the correctness core —
  any change requires updating its unit tests; statutory constants stay in
  `DEFAULT_CONFIG` (a commencement slip must be a config change, not a code change).
  ⚠️ CRITICAL LEGAL AMBIGUITY — two interpretations documented in regulatory.ts:
  · Interpretation A (CURRENT CODE): 5-year rule applied retroactively to existing EAF
    issue dates → ~1,948 buildings have accelerated deadlines.
  · Interpretation B (LIKELY CORRECT, cited by REA practitioners): audits conducted
    BEFORE 20 Sep 2026 keep their original 10-year expiry; 5-year cycle only applies to
    audits conducted ON/AFTER 20 Sep 2026.
  Must read Ordinance No. 24 of 2025 (elegislation.gov.hk/hk/2025/24) in a real browser
  and correct the code before first paid digest. Fix = one line + rerun 23 unit tests.
- LLM models are fixed by the build plan: `claude-haiku-4-5` (classification),
  `claude-sonnet-4-6` (memos). Memo prompt may only cite the statutory facts embedded
  in it — never let it recall ordinance text from memory.
- EMSD register layout changes must fail loudly (parser throws "layout changed") —
  fixtures live in `workers/cron/test/fixtures/`, snapshotted 2026-06-12.

## Current state (12 Jun 2026)

Built, deployed, E2E-verified in **dry-run email mode** (`EMAIL_DRY_RUN="1"`).
DB holds 2,556 buildings / 2,617 EAF records from the live register; 1,035 due within
18 months. Classification NOT yet run (`ANTHROPIC_API_KEY` not set). Pending go-live:
API key + classification backfill, domain + Resend, Stripe products, REA-register
prospect crawler, GitHub repos + CI — full checklist in `workers/CLAUDE.md`.

## Common commands

```bash
cd workers/cron && npm test                                  # 23 unit tests
KEY=$(cat workers/cron/.cron_trigger_key)
curl "https://auditwave-cron.takshingchanai.workers.dev/health?key=$KEY"
curl "https://auditwave-cron.takshingchanai.workers.dev/trigger-crawl?key=$KEY"
curl "https://auditwave-cron.takshingchanai.workers.dev/trigger-digest?key=$KEY"
npx wrangler d1 execute auditwave-db --remote --command "SELECT ..."
cd workers/<w> && npx wrangler deploy                        # deploy a worker
cd auditwave && npm run build && npx wrangler pages deploy out --project-name=auditwave
```
