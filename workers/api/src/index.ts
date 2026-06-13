// auditwave-api — signup, magic-link login, dashboard, filters, cancel, CSV export.
// Session/auth/validation patterns ported from NorwayContact (norgeconnect-api),
// minus all OAuth (digests are sent from our own domain via Resend).

export interface Env {
  DB: D1Database;
  RESEND_API_KEY?: string;
  TOKEN_ENCRYPTION_KEY: string;
  STRIPE_SECRET_KEY?: string;

  SITE_URL: string;
  CORS_ORIGIN: string;
  SYSTEM_FROM_EMAIL: string;
  EMAIL_DRY_RUN: string;
  PAYMENT_LINK_DISTRICT?: string;
  PAYMENT_LINK_TERRITORY?: string;
  PAYMENT_LINK_EXCLUSIVE?: string;
}

const DISTRICTS = new Set([
  "central_western", "wan_chai", "eastern", "southern",
  "yau_tsim_mong", "sham_shui_po", "kowloon_city", "wong_tai_sin", "kwun_tong",
  "kwai_tsing", "tsuen_wan", "tuen_mun", "yuen_long", "north", "tai_po",
  "sha_tin", "sai_kung", "islands",
]);
const BUILDING_TYPES = new Set([
  "commercial_office", "retail_mall", "hotel", "composite_commercial",
  "educational", "hospital_healthcare", "data_centre", "airport_terminal",
  "government", "community_cultural", "industrial", "transport_facility",
  "residential_common_area",
]);
const TIERS = new Set(["district", "territory", "exclusive"]);
const TRIAL_DAYS = 14;

// ---------- crypto (HKDF sub-keys per use — Norway #87) ----------

async function hkdfKey(env: Env, salt: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(env.TOKEN_ENCRYPTION_KEY), "HKDF", false, ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode(salt), info: new Uint8Array() },
    base,
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

async function hmacHex(env: Env, salt: string, data: string): Promise<string> {
  const key = await hkdfKey(env, salt, "sign");
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const SESSION_SALT = "auditwave-session-tokens";
const UNSUB_SALT = "auditwave-unsubscribe";
const SESSION_TTL_S = 30 * 24 * 3600;

async function signSession(env: Env, clientId: string): Promise<string> {
  const expiry = Math.floor(Date.now() / 1000) + SESSION_TTL_S;
  const payload = `${clientId}.${expiry}`;
  return `${payload}.${await hmacHex(env, SESSION_SALT, payload)}`;
}

async function verifySession(env: Env, req: Request): Promise<string | null> {
  const cookie = req.headers.get("cookie") ?? "";
  const m = cookie.match(/aw_session=([^;]+)/);
  if (!m) return null;
  const parts = m[1].split(".");
  if (parts.length !== 3) return null;
  const [clientId, expiry, sig] = parts;
  if (Number.isNaN(Number(expiry)) || Number(expiry) < Date.now() / 1000) return null;
  const expected = await hmacHex(env, SESSION_SALT, `${clientId}.${expiry}`);
  if (sig.length !== expected.length || sig !== expected) return null;
  return clientId;
}

// ---------- helpers ----------

function json(o: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(o), {
    status,
    headers: { "content-type": "application/json", ...extra },
  });
}

function corsHeaders(env: Env): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": env.CORS_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Credentials": "true",
  };
}

function isStr(v: unknown): v is string {
  return typeof v === "string";
}

function strField(v: unknown, max: number): string | null {
  if (!isStr(v)) return null;
  const t = v.trim();
  if (!t || t.length > max) return null;
  return t;
}

function strArray(v: unknown, allowed: Set<string>, maxLen: number): string[] | null {
  if (!Array.isArray(v) || v.length > maxLen) return null;
  const out: string[] = [];
  for (const item of v) {
    if (!isStr(item) || !allowed.has(item)) return null;
    out.push(item);
  }
  return [...new Set(out)];
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function sendEmail(env: Env, to: string, subject: string, html: string): Promise<boolean> {
  if (env.EMAIL_DRY_RUN === "1" || !env.RESEND_API_KEY) {
    console.log(`[EMAIL_DRY_RUN] to=${to} subject="${subject}"`);
    return true;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: `AuditWave HK <${env.SYSTEM_FROM_EMAIL}>`, to: [to], subject, html,
      headers: {
        "List-Unsubscribe": `<mailto:${env.SYSTEM_FROM_EMAIL}?subject=unsubscribe>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    }),
  });
  if (!res.ok) console.error(`resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.ok;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function emailShell(env: Env, lang: "zh" | "en", bodyHtml: string): string {
  const footer = lang === "zh" ? "AuditWave HK — 香港能源審核期限情報" : "AuditWave HK — Hong Kong energy-audit deadline intelligence";
  return `<!DOCTYPE html><html><body style="margin:0;background:#F5F5F2;font-family:-apple-system,'Segoe UI',Arial,'PingFang TC',sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 0;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
<tr><td style="background:#0E3B2E;color:#fff;padding:16px 24px;border-radius:8px 8px 0 0;font-size:18px;font-weight:700;">AuditWave HK</td></tr>
<tr><td style="background:#fff;padding:24px;border-radius:0 0 8px 8px;color:#222;font-size:14px;line-height:1.6;">${bodyHtml}</td></tr>
<tr><td style="padding:16px 24px;color:#888;font-size:11px;text-align:center;">${footer}</td></tr>
</table></td></tr></table></body></html>`;
}

async function createLoginToken(env: Env, clientId: string, multiUse: boolean, ttlDays: number): Promise<string> {
  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  await env.DB.prepare(
    "INSERT INTO login_tokens (token, client_id, expires_at, used, multi_use) VALUES (?,?,datetime('now', ?),0,?)",
  ).bind(token, clientId, `+${ttlDays} days`, multiUse ? 1 : 0).run();
  return token;
}

// ---------- handlers ----------

async function handleSignup(req: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const company = strField(body.company, 200);
  const contactName = body.contact_name == null ? null : strField(body.contact_name, 150);
  const rawEmail = strField(body.email, 254);
  const language = body.language === "en" ? "en" : "zh";
  const tier = isStr(body.tier) && TIERS.has(body.tier) ? body.tier : "district";
  if (!company || !rawEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rawEmail)) {
    return json({ error: "missing or invalid fields" }, 400);
  }
  const email = rawEmail.toLowerCase().trim();

  const districts = strArray(body.districts ?? [], DISTRICTS, 18);
  const buildingTypes = strArray(body.building_types ?? [], BUILDING_TYPES, 14);
  if (districts === null || buildingTypes === null) return json({ error: "invalid filters" }, 400);
  if (tier === "district" && districts.length === 0) {
    return json({ error: "district tier requires at least one district" }, 400);
  }
  let exclusiveVertical: string | null = null;
  if (tier === "exclusive") {
    exclusiveVertical = isStr(body.exclusive_vertical) && BUILDING_TYPES.has(body.exclusive_vertical)
      ? body.exclusive_vertical : null;
    if (!exclusiveVertical) return json({ error: "exclusive tier requires a vertical" }, 400);
    const taken = await env.DB.prepare(
      "SELECT 1 FROM clients WHERE exclusive_vertical = ? AND status != 'cancelled'",
    ).bind(exclusiveVertical).first();
    if (taken) return json({ error: "vertical already exclusively licensed" }, 409);
  }

  const existing = await env.DB.prepare(
    "SELECT id, status FROM clients WHERE email = ?",
  ).bind(email).first<{ id: string; status: string }>();

  const today = todayISO();
  let clientId: string;
  let status: string;

  if (existing) {
    if (existing.status !== "cancelled") return json({ error: "email already registered" }, 409);
    // Re-signup after cancellation: reactivate, no second trial (Norway rule)
    clientId = existing.id;
    status = "awaiting";
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE clients SET company=?, contact_name=?, language=?, tier=?, exclusive_vertical=?,
          status='awaiting', trial_start='9999-12-31', trial_end='9999-12-31',
          payment_reminder_sent=0, pause_digests=0, cancelled_at=NULL,
          csv_export_enabled=?
        WHERE id=?
      `).bind(company, contactName, language, tier, exclusiveVertical, tier === "district" ? 0 : 1, clientId),
      env.DB.prepare("DELETE FROM client_districts WHERE client_id=?").bind(clientId),
      env.DB.prepare("DELETE FROM client_building_types WHERE client_id=?").bind(clientId),
    ]);
  } else {
    clientId = crypto.randomUUID();
    status = "trial";
    await env.DB.prepare(`
      INSERT INTO clients (id, email, company, contact_name, language, tier, exclusive_vertical,
        trial_start, trial_end, status, csv_export_enabled, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
    `).bind(
      clientId, email, company, contactName, language, tier, exclusiveVertical,
      today, addDays(today, TRIAL_DAYS), "trial", tier === "district" ? 0 : 1,
    ).run();
  }

  const filterStmts: D1PreparedStatement[] = [];
  for (const d of districts) {
    filterStmts.push(env.DB.prepare(
      "INSERT OR IGNORE INTO client_districts (client_id, district) VALUES (?,?)",
    ).bind(clientId, d));
  }
  for (const t of buildingTypes) {
    filterStmts.push(env.DB.prepare(
      "INSERT OR IGNORE INTO client_building_types (client_id, building_type) VALUES (?,?)",
    ).bind(clientId, t));
  }
  if (filterStmts.length) await env.DB.batch(filterStmts);

  const dashToken = await createLoginToken(env, clientId, true, 7);
  const dashUrl = `${env.SITE_URL}/api-login?token=${dashToken}`;
  const lang = language as "zh" | "en";
  await sendEmail(
    env, email,
    status === "trial"
      ? (lang === "zh" ? "歡迎使用 AuditWave — 14 天免費試用已開始" : "Welcome to AuditWave — your 14-day trial has started")
      : (lang === "zh" ? "歡迎回來 — 啟用訂閱以恢復服務" : "Welcome back — activate to resume service"),
    emailShell(env, lang, lang === "zh"
      ? `<p>${esc(company)} 您好，</p><p>${status === "trial" ? "您的 14 天免費試用已開始。逢星期一您將收到每週期限線索摘要。" : "您的帳戶已重新登記，付款後服務即恢復。"}</p><p><a href="${dashUrl}">前往儀表板</a></p>`
      : `<p>Hello ${esc(company)},</p><p>${status === "trial" ? "Your 14-day free trial has started. You'll receive your weekly deadline-lead digest every Monday." : "Your account is re-registered; service resumes on payment."}</p><p><a href="${dashUrl}">Go to dashboard</a></p>`),
  );

  return json({ id: clientId, status });
}

async function handleStatus(req: Request, env: Env, url: URL): Promise<Response> {
  const id = url.searchParams.get("id");
  if (!id) return json({ error: "missing id" }, 400);
  const c = await env.DB.prepare(`
    SELECT id, email, company, contact_name, language, tier, exclusive_vertical, status,
      trial_start, trial_end, next_billing_date, pause_digests, csv_export_enabled, stripe_price_id
    FROM clients WHERE id = ?
  `).bind(id).first();
  if (!c) return json({ error: "not found" }, 404);
  const districts = await env.DB.prepare(
    "SELECT district FROM client_districts WHERE client_id = ?",
  ).bind(id).all<{ district: string }>();
  const types = await env.DB.prepare(
    "SELECT building_type FROM client_building_types WHERE client_id = ?",
  ).bind(id).all<{ building_type: string }>();
  const digests = await env.DB.prepare(
    "SELECT sent_at, lead_count, status FROM sent_digests WHERE client_id = ? ORDER BY sent_at DESC LIMIT 8",
  ).bind(id).all();
  const leadsDelivered = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM delivered_leads WHERE client_id = ?",
  ).bind(id).first<{ n: number }>();
  return json({
    ...c,
    districts: districts.results.map((r) => r.district),
    building_types: types.results.map((r) => r.building_type),
    recent_digests: digests.results,
    leads_delivered: leadsDelivered?.n ?? 0,
  });
}

async function handleUpdateClient(req: Request, env: Env): Promise<Response> {
  const sessionId = await verifySession(env, req);
  if (!sessionId) return json({ error: "unauthorized" }, 401);
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (body.language !== undefined) {
    if (body.language !== "zh" && body.language !== "en") return json({ error: "invalid language" }, 400);
    sets.push("language=?");
    binds.push(body.language);
  }
  if (body.pause_digests !== undefined) {
    if (body.pause_digests !== 0 && body.pause_digests !== 1) return json({ error: "invalid pause_digests" }, 400);
    sets.push("pause_digests=?");
    binds.push(body.pause_digests);
  }
  if (body.contact_name !== undefined) {
    const v = body.contact_name === null ? null : strField(body.contact_name, 150);
    if (body.contact_name !== null && v === null) return json({ error: "invalid contact_name" }, 400);
    sets.push("contact_name=?");
    binds.push(v);
  }
  if (sets.length === 0) return json({ error: "nothing to update" }, 400);
  binds.push(sessionId);
  await env.DB.prepare(`UPDATE clients SET ${sets.join(",")} WHERE id=?`).bind(...binds).run();
  return json({ ok: true });
}

async function handlePutFilters(req: Request, env: Env): Promise<Response> {
  const sessionId = await verifySession(env, req);
  if (!sessionId) return json({ error: "unauthorized" }, 401);
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const districts = strArray(body.districts ?? [], DISTRICTS, 18);
  const buildingTypes = strArray(body.building_types ?? [], BUILDING_TYPES, 14);
  if (districts === null || buildingTypes === null) return json({ error: "invalid filters" }, 400);
  const client = await env.DB.prepare("SELECT tier FROM clients WHERE id=?").bind(sessionId)
    .first<{ tier: string }>();
  if (!client) return json({ error: "not found" }, 404);
  if (client.tier === "district" && districts.length === 0) {
    return json({ error: "district tier requires at least one district" }, 400);
  }
  const stmts = [
    env.DB.prepare("DELETE FROM client_districts WHERE client_id=?").bind(sessionId),
    env.DB.prepare("DELETE FROM client_building_types WHERE client_id=?").bind(sessionId),
  ];
  for (const d of districts) {
    stmts.push(env.DB.prepare("INSERT INTO client_districts (client_id, district) VALUES (?,?)").bind(sessionId, d));
  }
  for (const t of buildingTypes) {
    stmts.push(env.DB.prepare("INSERT INTO client_building_types (client_id, building_type) VALUES (?,?)").bind(sessionId, t));
  }
  await env.DB.batch(stmts);
  return json({ ok: true });
}

async function handleCancel(req: Request, env: Env): Promise<Response> {
  const sessionId = await verifySession(env, req);
  if (!sessionId) return json({ error: "unauthorized" }, 401);
  const c = await env.DB.prepare(
    "SELECT id, status, stripe_subscription_id FROM clients WHERE id=?",
  ).bind(sessionId).first<{ id: string; status: string; stripe_subscription_id: string | null }>();
  if (!c) return json({ error: "not found" }, 404);

  if (c.status === "active" && c.stripe_subscription_id && env.STRIPE_SECRET_KEY) {
    // service continues until period end; stripe webhook finalizes cancellation
    const res = await fetch(`https://api.stripe.com/v1/subscriptions/${c.stripe_subscription_id}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "cancel_at_period_end=true",
    });
    if (!res.ok) return json({ error: "stripe error" }, 502);
    return json({ ok: true, mode: "period_end" });
  }

  // trial/awaiting/paused: immediate cancel; terminate any subscription now to stop
  // retry charges (Norway #78)
  if (c.stripe_subscription_id && env.STRIPE_SECRET_KEY) {
    await fetch(`https://api.stripe.com/v1/subscriptions/${c.stripe_subscription_id}/cancel`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
    }).catch(() => {});
  }
  await env.DB.prepare(
    "UPDATE clients SET status='cancelled', cancelled_at=datetime('now'), exclusive_vertical=NULL WHERE id=?",
  ).bind(sessionId).run();
  return json({ ok: true, mode: "immediate" });
}

async function handleLoginRequest(req: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  if (!isStr(body.email)) return json({ error: "invalid email" }, 400);
  const email = body.email.toLowerCase().trim();
  const c = await env.DB.prepare(
    "SELECT id, language, company FROM clients WHERE email=? AND status != 'cancelled'",
  ).bind(email).first<{ id: string; language: "zh" | "en"; company: string }>();
  // Always claim success (no account enumeration)
  if (c) {
    const token = await createLoginToken(env, c.id, false, 1);
    const link = `${env.SITE_URL}/api-login?token=${token}`;
    await sendEmail(
      env, email,
      c.language === "zh" ? "登入 AuditWave" : "Log in to AuditWave",
      emailShell(env, c.language, c.language === "zh"
        ? `<p>點擊以下連結登入（1 小時內有效）：</p><p><a href="${link}">登入儀表板</a></p>`
        : `<p>Click below to log in (valid for 1 hour):</p><p><a href="${link}">Log in to dashboard</a></p>`),
    );
  }
  return json({ ok: true });
}

async function handleLoginVerify(req: Request, env: Env, url: URL): Promise<Response> {
  const token = url.searchParams.get("token") ?? "";
  if (!/^[a-f0-9]{64}$/.test(token)) return json({ error: "invalid token" }, 400);
  const row = await env.DB.prepare(
    "SELECT token, client_id, expires_at, used, multi_use FROM login_tokens WHERE token=?",
  ).bind(token).first<{ token: string; client_id: string; expires_at: string; used: number; multi_use: number }>();
  if (!row || row.expires_at < new Date().toISOString().replace("T", " ").slice(0, 19)) {
    return Response.redirect(`${env.SITE_URL}/reconnect?error=expired`, 302);
  }
  if (row.multi_use === 0) {
    if (row.used === 1) return Response.redirect(`${env.SITE_URL}/reconnect?error=used`, 302);
    await env.DB.prepare("UPDATE login_tokens SET used=1 WHERE token=?").bind(token).run();
  }
  const session = await signSession(env, row.client_id);
  return new Response(null, {
    status: 302,
    headers: {
      location: `${env.SITE_URL}/dashboard?id=${row.client_id}`,
      "set-cookie": `aw_session=${session}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${SESSION_TTL_S}`,
    },
  });
}

async function handleLeadsCsv(req: Request, env: Env, url: URL): Promise<Response> {
  const sessionId = await verifySession(env, req);
  if (!sessionId) return json({ error: "unauthorized" }, 401);
  const c = await env.DB.prepare(
    "SELECT csv_export_enabled, status FROM clients WHERE id=?",
  ).bind(sessionId).first<{ csv_export_enabled: number; status: string }>();
  if (!c) return json({ error: "not found" }, 404);
  if (c.csv_export_enabled !== 1 || (c.status !== "active" && c.status !== "trial")) {
    return json({ error: "csv export not available on this plan" }, 403);
  }
  const rows = await env.DB.prepare(`
    SELECT b.name_en, b.name_zh, b.address_en, b.address_zh, b.district, b.building_type,
           e.expiry_published, e.deadline_new_regime, e.code_edition, dl.delivered_at
    FROM delivered_leads dl
    JOIN buildings b ON b.id = dl.building_id
    LEFT JOIN eaf_records e ON e.id = dl.eaf_id
    WHERE dl.client_id = ?
    ORDER BY e.deadline_new_regime
  `).bind(sessionId).all();
  const header = "name_en,name_zh,address_en,address_zh,district,building_type,expiry_published,deadline,code_edition,delivered_at";
  const lines = rows.results.map((r: Record<string, unknown>) =>
    [r.name_en, r.name_zh, r.address_en, r.address_zh, r.district, r.building_type,
      r.expiry_published, r.deadline_new_regime, r.code_edition, r.delivered_at]
      .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","),
  );
  return new Response("﻿" + [header, ...lines].join("\r\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="auditwave-leads.csv"',
    },
  });
}

async function handleVerticals(env: Env): Promise<Response> {
  const taken = await env.DB.prepare(
    "SELECT exclusive_vertical FROM clients WHERE exclusive_vertical IS NOT NULL AND status != 'cancelled'",
  ).all<{ exclusive_vertical: string }>();
  const takenSet = new Set(taken.results.map((r) => r.exclusive_vertical));
  return json({
    available: [...BUILDING_TYPES].filter((t) => !takenSet.has(t)),
    taken: [...takenSet],
  });
}

async function handleUnsubscribe(req: Request, env: Env, url: URL): Promise<Response> {
  const email = (url.searchParams.get("email") ?? "").toLowerCase().trim();
  const token = url.searchParams.get("token") ?? "";
  if (!email || !token) return new Response("bad request", { status: 400 });
  const expected = await hmacHex(env, UNSUB_SALT, email);
  if (token !== expected) return new Response("forbidden", { status: 403 });
  if (req.method === "POST") {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO unsubscribed_emails (email, unsubscribed_at) VALUES (?, datetime('now'))",
    ).bind(email).run();
    await env.DB.prepare(
      "UPDATE reas SET outreach_status='opted_out' WHERE email=?",
    ).bind(email).run();
    return new Response("<html><body><p>You have been unsubscribed. 您已取消訂閱。</p></body></html>", {
      headers: { "content-type": "text/html" },
    });
  }
  return new Response(
    `<html><body><p>Unsubscribe ${esc(email)} from AuditWave outreach? 確認取消訂閱？</p>
     <form method="POST"><button type="submit">Confirm 確認</button></form></body></html>`,
    { headers: { "content-type": "text/html" } },
  );
}

// ---------- router ----------

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const cors = corsHeaders(env);
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });

    let res: Response;
    try {
      if (url.pathname === "/api/signup" && req.method === "POST") res = await handleSignup(req, env);
      else if (url.pathname === "/api/status" && req.method === "GET") res = await handleStatus(req, env, url);
      else if (url.pathname === "/api/client" && req.method === "PATCH") res = await handleUpdateClient(req, env);
      else if (url.pathname === "/api/filters" && req.method === "PUT") res = await handlePutFilters(req, env);
      else if (url.pathname === "/api/cancel" && req.method === "POST") res = await handleCancel(req, env);
      else if (url.pathname === "/api/login/request" && req.method === "POST") res = await handleLoginRequest(req, env);
      else if (url.pathname === "/api/login/verify" && req.method === "GET") res = await handleLoginVerify(req, env, url);
      else if (url.pathname === "/api/leads.csv" && req.method === "GET") res = await handleLeadsCsv(req, env, url);
      else if (url.pathname === "/api/verticals" && req.method === "GET") res = await handleVerticals(env);
      else if (url.pathname === "/api/unsubscribe") res = await handleUnsubscribe(req, env, url);
      else res = json({ error: "not found" }, 404);
    } catch (err) {
      console.error(`unhandled ${url.pathname}:`, err);
      res = json({ error: "internal" }, 500);
    }

    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    return new Response(res.body, { status: res.status, headers });
  },
};
