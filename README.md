# AuditWave HK

Statutory energy-audit deadline intelligence for Hong Kong REA firms (BEEO / Cap. 610).
Crawls the EMSD Energy Audit Form register daily, computes every building's next-audit
deadline under the 2025 Amendment Ordinance (commencement 20 Sep 2026), classifies
buildings with Claude, and delivers weekly bilingual lead digests to subscribers.

**Business case:** `Rec1_BEEO_Energy_Audit_Engine_EN.md` · **Build plan:** `BUILD_PLAN.md`
· **Backend detail:** `workers/CLAUDE.md`

## Live URLs

| Service | URL |
|---|---|
| Website | https://auditwave.pages.dev (domain pending) |
| API Worker | https://auditwave-api.takshingchanai.workers.dev |
| Cron Worker | https://auditwave-cron.takshingchanai.workers.dev |
| Stripe Worker | https://auditwave-stripe.takshingchanai.workers.dev |

## Layout

```
BEEO/
├── auditwave/          ← Next.js 16 static-export website (繁中/EN) → Cloudflare Pages
├── workers/
│   ├── schema.sql      ← D1 schema (13 tables) — applied to auditwave-db
│   ├── CLAUDE.md       ← full backend context
│   ├── cron/           ← crawl engine + LLM pipeline + digests (23 unit tests)
│   ├── api/            ← signup / magic-link login / dashboard / CSV export
│   └── stripe/         ← webhook handler (HKD; district 2,500 / territory 5,000 / exclusive 9,000)
└── BUILD_PLAN.md
```

## Status (12 Jun 2026)

✅ Built, deployed, and verified end-to-end in dry-run mode: daily crawl (2,748 register
rows → D1 + R2), deadline engine (unit-tested), digest pipeline with dedup, signup/login/
session/cancel flows, CORS, Stripe webhook guards.

⏳ Pending go-live (see `workers/CLAUDE.md` checklist): `ANTHROPIC_API_KEY` secret,
domain + Resend, Stripe products, REA-register prospect crawler, GitHub repos + CI.

✅ **Regulatory interpretation confirmed (13 Jun 2026).** Ord. No. 24 of 2025 Schedule 5 +
EMSD official guidance confirm: audits conducted **before** 20 Sep 2026 keep their 10-year
interval (published expiry stands). 5-year cycle only applies to audits conducted on/after
commencement. `computeDeadlines()` updated, 24/24 tests green. Deploy cron worker to refresh
D1 deadline values.

## Pricing (monthly, HKD)

| Tier | Price | Includes |
|---|---|---|
| District | 2,500 | Chosen districts, weekly digest + bilingual memos |
| Territory | 5,000 | All 18 districts, building-type filters, CSV export |
| Exclusive vertical | 9,000 | One building category exclusively (max 1 buyer/vertical) |

14-day free trial, no card. Trial → awaiting → active → cancelled (paused on payment failure).

## Common commands

```bash
cd workers/cron && npm test                       # regulatory + parser tests
npx wrangler d1 execute auditwave-db --remote --command "SELECT ..."
KEY=$(cat workers/cron/.cron_trigger_key)
curl "https://auditwave-cron.takshingchanai.workers.dev/health?key=$KEY"
curl "https://auditwave-cron.takshingchanai.workers.dev/trigger-crawl?key=$KEY"
curl "https://auditwave-cron.takshingchanai.workers.dev/trigger-digest?key=$KEY"
cd auditwave && npm run build && npx wrangler pages deploy out --project-name=auditwave
```
