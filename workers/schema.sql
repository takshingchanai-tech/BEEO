-- AuditWave D1 Schema
-- Apply: npx wrangler d1 execute auditwave-db --remote --file=workers/schema.sql
-- Source of truth for register fields: EMSD EAF register (search_eaf.php) publishes
-- EXPIRY dates (not issue dates), EUI figures, REA number, bilingual via /en/ + /tc/ pages.

-- Buildings discovered from the EMSD EAF register + LLM enrichment
CREATE TABLE IF NOT EXISTS buildings (
  id                 TEXT PRIMARY KEY,        -- sha256(normalized EN address), hex
  name_en            TEXT,
  name_zh            TEXT,
  address_en         TEXT NOT NULL,
  address_zh         TEXT,
  district           TEXT,                    -- canonical EN key of 18 HK districts (LLM-derived)
  building_type      TEXT,                    -- BEEO Schedule category (LLM-classified)
  is_new_scope       INTEGER NOT NULL DEFAULT 0,  -- 1 = one of the 9 new types (2026 amendment)
  is_demolished      INTEGER NOT NULL DEFAULT 0,  -- register marks these with "(已拆卸)" / "(Demolished)" prefix
  classification_confidence REAL,
  classification_raw TEXT,                    -- JSON: full classifier output (audit/correction corpus)
  classified_at      TEXT,
  first_seen         TEXT NOT NULL,           -- ISO date first observed (longitudinal moat)
  last_seen          TEXT NOT NULL,
  created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_buildings_district ON buildings(district);
CREATE INDEX IF NOT EXISTS idx_buildings_type ON buildings(building_type);

-- One row per (building, EAF expiry) observed in the register. Never deleted.
CREATE TABLE IF NOT EXISTS eaf_records (
  id                 TEXT PRIMARY KEY,        -- sha256(building_id|expiry_published)
  building_id        TEXT NOT NULL REFERENCES buildings(id),
  expiry_published   TEXT NOT NULL,           -- ISO date as published by EMSD (issue + 10y legacy)
  issue_date_derived TEXT NOT NULL,           -- expiry_published minus legacy interval
  deadline_new_regime TEXT NOT NULL,          -- computed by regulatory engine (5y regime + transition)
  code_edition       TEXT NOT NULL,           -- 'BEC2015/EAC2015' | 'BEC2024/EAC2024'
  eui_mj             REAL,                    -- latest EUI MJ/m2/annum
  eui_kwh            REAL,
  prev_expiry_published TEXT,                 -- previous audit expiry, if any
  prev_eui_mj        REAL,
  rea_no             TEXT,                    -- REA registration number who signed the EAF
  memo_en            TEXT,                    -- Sonnet-drafted outreach memo (EN)
  memo_zh            TEXT,                    -- Sonnet-drafted outreach memo (繁中)
  memo_generated_at  TEXT,
  first_seen         TEXT NOT NULL,
  last_seen          TEXT NOT NULL,
  UNIQUE(building_id, expiry_published)
);
CREATE INDEX IF NOT EXISTS idx_eaf_deadline ON eaf_records(deadline_new_regime);
CREATE INDEX IF NOT EXISTS idx_eaf_expiry ON eaf_records(expiry_published);

-- Newly-in-scope buildings with no EAF yet (the "September 2026 Wave List")
CREATE TABLE IF NOT EXISTS wave_targets (
  building_id        TEXT PRIMARY KEY REFERENCES buildings(id),
  statutory_deadline TEXT NOT NULL,
  memo_en            TEXT,
  memo_zh            TEXT,
  memo_generated_at  TEXT,
  exclusively_assigned_to TEXT REFERENCES clients(id)
);

-- Registered Energy Assessors (prospect CRM) — populated when REA register source is wired up
CREATE TABLE IF NOT EXISTS reas (
  registration_no    TEXT PRIMARY KEY,
  name               TEXT,
  company            TEXT,
  email              TEXT,
  phone              TEXT,
  address            TEXT,
  expiry_date        TEXT,
  eaf_count          INTEGER NOT NULL DEFAULT 0,  -- how many EAFs in register signed by this REA
  first_seen         TEXT NOT NULL,
  last_seen          TEXT NOT NULL,
  outreach_status    TEXT NOT NULL DEFAULT 'none', -- 'none'|'seeded'|'contacted'|'replied'|'converted'|'opted_out'
  seeded_lead_building_id TEXT,
  last_contacted     TEXT
);

-- Subscribers
CREATE TABLE IF NOT EXISTS clients (
  id                 TEXT PRIMARY KEY,
  email              TEXT NOT NULL UNIQUE,    -- lowercase+trimmed at every write
  company            TEXT NOT NULL,
  contact_name       TEXT,
  language           TEXT NOT NULL DEFAULT 'zh',   -- 'zh' | 'en'
  tier               TEXT NOT NULL DEFAULT 'district', -- 'district'|'territory'|'exclusive'
  exclusive_vertical TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_price_id    TEXT,
  next_billing_date  TEXT,
  trial_start        TEXT NOT NULL,
  trial_end          TEXT NOT NULL,           -- 14-day trial; '9999-12-31' = skip-trial sentinel
  status             TEXT NOT NULL DEFAULT 'trial',
    -- 'trial' -> 'awaiting' -> 'active' -> 'cancelled' (or 'paused' on payment failure)
  payment_reminder_sent INTEGER NOT NULL DEFAULT 0,
  pause_digests      INTEGER NOT NULL DEFAULT 0,
  csv_export_enabled INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,
  cancelled_at       TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_exclusive_vertical
  ON clients(exclusive_vertical) WHERE exclusive_vertical IS NOT NULL AND status != 'cancelled';

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

CREATE TABLE IF NOT EXISTS sent_digests (
  id           TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL REFERENCES clients(id),
  sent_at      TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end   TEXT NOT NULL,
  lead_count   INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'sent'
);
CREATE INDEX IF NOT EXISTS idx_sent_digests_client ON sent_digests(client_id, sent_at);

CREATE TABLE IF NOT EXISTS delivered_leads (
  client_id    TEXT NOT NULL REFERENCES clients(id),
  building_id  TEXT NOT NULL,
  eaf_id       TEXT,
  delivered_at TEXT NOT NULL,
  PRIMARY KEY (client_id, building_id)
);

CREATE TABLE IF NOT EXISTS crawl_runs (
  id            TEXT PRIMARY KEY,
  source        TEXT NOT NULL,                -- 'eaf_register' | 'rea_register'
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  pages_fetched INTEGER NOT NULL DEFAULT 0,
  rows_seen     INTEGER NOT NULL DEFAULT 0,
  rows_new      INTEGER NOT NULL DEFAULT 0,
  rows_changed  INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'running', -- 'running'|'ok'|'error'|'blocked'
  error_detail  TEXT
);

CREATE TABLE IF NOT EXISTS invoices (
  id                TEXT PRIMARY KEY,         -- AW-YYYY-NNN
  client_id         TEXT NOT NULL REFERENCES clients(id),
  stripe_invoice_id TEXT,
  amount_hkd        INTEGER NOT NULL,
  period_start      TEXT NOT NULL,
  period_end        TEXT NOT NULL,
  issued_at         TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_stripe ON invoices(stripe_invoice_id)
  WHERE stripe_invoice_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS login_tokens (
  token      TEXT PRIMARY KEY,
  client_id  TEXT NOT NULL REFERENCES clients(id),
  expires_at TEXT NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  multi_use  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS unsubscribed_emails (
  email           TEXT PRIMARY KEY,
  unsubscribed_at TEXT NOT NULL
);
