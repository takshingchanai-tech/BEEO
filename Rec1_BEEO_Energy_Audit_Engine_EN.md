# Recommendation 1: The BEEO Energy-Audit Wave Engine
**Prepared for:** Solo developer / registry-driven automation operator
**Date:** 12 June 2026
**Model:** Official-registry data → AI normalization pipeline → asynchronous Cloudflare background queues → zero-touch daily delivery
**Companion documents:** `Rec2_MBIS_Repair_Order_Radar_EN.md` (the second top pick, sharing ~80% of this product's infrastructure) · `HK_All_Findings_General_Report_EN.md` (all five findings)

---

## Why This Is the #1 Pick

This opportunity rides a hard statutory cliff on **20 September 2026** (Buildings Energy Efficiency (Amendment) Ordinance 2025: nine new building types enter the energy-audit regime and audit intervals halve from 10 years to 5). That creates a ~3-month forced-adoption land-grab window that cannot be recreated later, followed by a permanent recurring market. The buyer list is a free government register.

Realistic 12-month contribution toward a combined HK$80,000–150,000 MRR target (with Recommendation 2), at near-zero marginal cost, fully automatable by one person.

---

## 1. Opportunity Overview

The Buildings Energy Efficiency Ordinance (Cap. 610, "BEEO") requires owners of commercial buildings (and commercial portions of composite buildings) to commission a statutory **energy audit** of four key central building services installations, performed by a **Registered Energy Assessor (REA)**, with the resulting **Energy Audit Form (EAF)** displayed at the building entrance.

**The 2026 inflection point.** The Buildings Energy Efficiency (Amendment) Ordinance 2025 (gazetted 20 June 2025) makes two changes that take effect **by 20 September 2026**:

- **Nine additional building types** enter the audit regime: educational facilities, hospitals/healthcare, data centres, airports, government-owned buildings, and others.
- **Audit interval halves from 10 years to 5 years.**
- Audit reports must disclose additional technical information; the new Building Energy Code and Energy Audit Code (2024 editions, effective 23 August 2025) raise efficiency standards by over 20% versus the 2015 editions.

Thousands of buildings enter scope simultaneously, and every existing commercial building's renewal clock accelerates. Each audit engagement is worth **HK$50,000–300,000** to an REA firm. No one is systematically computing *which specific building's deadline lands when* — that computation is the product.

## 2. Pillar 1 — The Data Source Moat

| Source | Content | Access |
|---|---|---|
| EMSD **Register of buildings issued with Energy Audit Forms** (`emsd.gov.hk/beeo/en/register/search_eaf.php`) | Building name, address, EAF issue date | Search-form gated (no bulk download) |
| EMSD **Register of Registered Energy Assessors** (`emsd.gov.hk/beeo/en/rea/search_rea.php`) | Every licensed REA + contact details | Public search |
| BEEO + Amendment Ordinance text (`elegislation.gov.hk`, Cap. 610) | Building-type schedules, intervals, transitional provisions | Public |
| CSDI / data.gov.hk building datasets | Building age, use, storeys, geocoding | Open CSV/API |

The EAF issue date is the key field: **next statutory deadline = issue date + interval (10y legacy / 5y new regime)**. Because the register is form-gated rather than bulk-downloadable, whoever crawls and reconciles it longitudinally owns a deadline database that does not exist anywhere else — including inside EMSD's public surface.

## 3. Pillar 2 — The High-Value Problem & Trigger Events

- **Hard statutory trigger:** 20 September 2026 commencement. Newly-in-scope building owners (schools, hospitals, data centres…) face a legal duty most don't yet know they have.
- **Rolling triggers forever:** every EAF issued since 2012 has a computable expiry; the 10y→5y change *doubles* the renewal frequency of the entire existing stock.
- **The pain:** building owners face statutory non-compliance (and the audit itself is a five-to-six-figure procurement they don't know how to scope); REA firms face a feast they cannot see — they have no pipeline visibility into which buildings fall due next quarter.
- **Receptivity moment:** an alert that says "this named building's audit falls due on this date under this code edition" arrives exactly when the recipient can convert it into a HK$50k–300k engagement.

## 4. Pillar 3 — AI & Automation Leverage (Cloudflare Architecture)

```
[Cron Trigger: daily 02:00 HKT]
   └─> Worker: polite rate-limited crawl of EMSD EAF register (delta pages)
         └─> D1: upsert building records; compute deadline = EAF_date + interval
               └─> Queue: "classification" jobs
                     └─> Worker + LLM (Workers AI / Claude Haiku):
                           • classify building into BEEO schedule categories
                             (is this premises one of the 9 new types?)
                           • bilingual address normalization via CSDI lookup
                           • enrich: age, storeys, estimated installation scale
                     └─> Worker + LLM (Claude Sonnet, low volume):
                           • draft bilingual outreach memo citing correct
                             code edition + statutory deadline
   └─> Cron Trigger: weekly digest assembly
         └─> Queue fan-out per subscriber (district + building-type filters)
               └─> Email Worker (Resend/MailChannels) → subscriber inbox
```

- **100% async, zero manual intervention.** Crawl, diff, classify, score, draft, send — all queue-driven.
- LLM cost discipline: cheap model for classification at volume; premium model only for the final outreach memo on *newly triggered* buildings (low daily count).
- Maintenance surface for one person: crawler selector drift (rare; government sites change ~yearly) and prompt updates when codes are amended.

## 5. Pillar 4 — Platform Moat & Gatekeeping

1. **No bulk export exists.** The EAF register must be crawled politely and reconciled over months. Your longitudinal database (first-seen dates, form renewals, disappearances) cannot be backfilled by a newcomer.
2. **Encoded regulatory logic.** Which interval applies (5 vs 10 years), which code edition governs, how transitional provisions treat buildings audited shortly before commencement — this is domain knowledge baked into your pipeline, invisible to a generic scraper.
3. **Building-type classification accuracy.** Deciding whether a premises is an "educational facility" or "data centre" under the Schedule is a judgment task; your prompt corpus + correction history compounds.
4. **Bilingual address graph** (shared asset with Recommendation 2): Traditional-Chinese building names ↔ English street addresses ↔ lot numbers.

## 6. Pillar 5 — Monetization & Target Buyer

**Primary persona:** Partner / business-development lead at a building-services engineering consultancy employing REAs (typically 5–50 staff, HK or PRC-owned, fee-hungry, no software budget discipline — sell outcomes, not features).
**Secondary personas:** sustainability/facility heads at property managers; ESG teams at REITs; M&E contractors bundling audits with retrofit work.

**Pricing (flat-rate monthly):**

| Tier | Price | Includes |
|---|---|---|
| District | HK$2,500/mo | One district, weekly deadline pipeline + memos |
| Territory | HK$5,000/mo | All HK, building-type filters, CSV export |
| Exclusive vertical | HK$9,000/mo | e.g. "all data centres" exclusively, max 1 buyer/vertical |

**Unit economics:** Cloudflare + LLM + crawl infra ≈ US$50–150/month total. 20 Territory subscribers = HK$100k MRR at ~99% gross margin.
**Sales channel:** the REA register itself — every prospect's name and credentials are public. Cold outreach is warm because the first email *contains a live lead*.

## 7. 90-Day Launch Plan

1. **Weeks 1–3:** Crawler + D1 schema + deadline computation; backfill EAF register history.
2. **Weeks 4–6:** LLM classification of the 9 new building types against open building datasets; produce the "September 2026 Wave List."
3. **Weeks 7–9:** Digest/email pipeline; landing page (bilingual); seed 30 REA firms with one free live lead each.
4. **Weeks 10–13:** Convert at HK$2,500 founding-member pricing; publish a free "BEEO 2026 readiness" mini-report for SEO/LinkedIn authority.

**Risk register:** EMSD could publish bulk open data (mitigation: moat shifts to classification + memos); amendment commencement could slip (mitigation: rolling 10-year renewals still exist); crawl blocking (mitigation: low-frequency polite crawl, cache in R2).

## 8. Shared Infrastructure & Sequencing (with Recommendation 2)

| Component | Built in | Reused by |
|---|---|---|
| Cron → Worker → D1 diff engine | BEEO (weeks 1–3) | MBIS as-is |
| Bilingual address-resolution graph | Both, compounding | Every future HK registry product |
| LLM classification/memo pipeline | BEEO | MBIS (prompt swap) |
| Queue fan-out + digest email | BEEO | MBIS as-is |
| Buyer CRM from public registers | EMSD REA register | BD RI/contractor registers |

**Sequencing rationale:** build BEEO first because the 20 September 2026 commencement creates time-boxed urgency you cannot recreate later; the MBIS radar (see companion document) follows 6–8 weeks later on the same rails.

---

*All registries, ordinances, datasets, deadlines and renewal rules cited were verified against live official sources (EMSD, e-Legislation, DATA.GOV.HK, CSDI) on 12 June 2026.*
