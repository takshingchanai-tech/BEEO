// Trial lifecycle + housekeeping (ported from NorwayContact, simplified).
// Order matters: pause step runs BEFORE expiry step so a missed-cron backlog can't
// move a client trial -> awaiting -> paused in one run (Norway CodeChecking #77).

import { sendEmail, emailShell } from "./emails";
import { todayISO, nowISO, type Env } from "./types";

const TRIAL_REMINDER_DAY_BEFORE_END = 2; // day 12 of 14
const PAUSE_AFTER_AWAITING_DAYS = 3;

export async function runTrialManagement(env: Env): Promise<void> {
  const today = todayISO();

  // 1) Pause: awaiting clients whose trial ended PAUSE_AFTER_AWAITING_DAYS+ ago and unpaid
  await env.DB.prepare(`
    UPDATE clients SET status='paused'
    WHERE status='awaiting' AND trial_end < '9999'
      AND date(trial_end, '+${PAUSE_AFTER_AWAITING_DAYS} days') <= date(?)
  `).bind(today).run();

  // 2) Expiry: trial_end <= today -> awaiting (exactly N trial days, Norway #74)
  const expired = await env.DB.prepare(`
    SELECT id, email, company, language FROM clients
    WHERE status='trial' AND trial_end <= ? AND trial_end < '9999'
  `).bind(today).all<{ id: string; email: string; company: string; language: "zh" | "en" }>();
  for (const c of expired.results) {
    await env.DB.prepare("UPDATE clients SET status='awaiting' WHERE id=?").bind(c.id).run();
    const lang = c.language;
    await sendEmail(
      env, c.email,
      lang === "zh" ? "試用期已結束 — 啟用訂閱以繼續接收線索" : "Your trial has ended — activate to keep receiving leads",
      emailShell(env, lang, lang === "zh"
        ? `<p>${esc(c.company)} 的 14 天試用已結束。前往儀表板選擇方案後，每週線索摘要將立即恢復。</p><p><a href="${env.SITE_URL}/dashboard">前往儀表板</a></p>`
        : `<p>The 14-day trial for ${esc(c.company)} has ended. Pick a plan from your dashboard and your weekly lead digest resumes immediately.</p><p><a href="${env.SITE_URL}/dashboard">Go to dashboard</a></p>`),
    );
  }

  // 3) Day-12 payment reminder (once)
  const reminders = await env.DB.prepare(`
    SELECT id, email, company, language FROM clients
    WHERE status='trial' AND payment_reminder_sent=0 AND trial_end < '9999'
      AND date(trial_end, '-${TRIAL_REMINDER_DAY_BEFORE_END} days') <= date(?)
  `).bind(today).all<{ id: string; email: string; company: string; language: "zh" | "en" }>();
  for (const c of reminders.results) {
    await env.DB.prepare("UPDATE clients SET payment_reminder_sent=1 WHERE id=?").bind(c.id).run();
    const lang = c.language;
    await sendEmail(
      env, c.email,
      lang === "zh" ? "試用期即將結束" : "Your trial ends soon",
      emailShell(env, lang, lang === "zh"
        ? `<p>${esc(c.company)} 的試用將於兩天後結束。選擇方案以免中斷每週線索。</p><p><a href="${env.SITE_URL}/dashboard">選擇方案</a></p>`
        : `<p>The trial for ${esc(c.company)} ends in two days. Choose a plan to keep your weekly leads coming.</p><p><a href="${env.SITE_URL}/dashboard">Choose a plan</a></p>`),
    );
  }

  // 4) Login token cleanup
  await env.DB.prepare(
    "DELETE FROM login_tokens WHERE expires_at < datetime('now', '-1 day')",
  ).run();

  // 5) PDPO 90-day cleanup of cancelled clients (anonymise; keep invoices)
  const stale = await env.DB.prepare(`
    SELECT id FROM clients WHERE status='cancelled' AND cancelled_at IS NOT NULL
      AND cancelled_at < datetime('now', '-90 days') AND email NOT LIKE 'anon-%'
  `).all<{ id: string }>();
  for (const c of stale.results) {
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE clients SET email='anon-'||id, company='[removed]', contact_name=NULL, stripe_customer_id=NULL, stripe_subscription_id=NULL WHERE id=?",
      ).bind(c.id),
      env.DB.prepare("DELETE FROM client_districts WHERE client_id=?").bind(c.id),
      env.DB.prepare("DELETE FROM client_building_types WHERE client_id=?").bind(c.id),
      env.DB.prepare("DELETE FROM delivered_leads WHERE client_id=?").bind(c.id),
      env.DB.prepare("DELETE FROM login_tokens WHERE client_id=?").bind(c.id),
    ]);
  }
}

/** Crawl-health watchdog: alert if the last 2 daily runs failed (or none ran). */
export async function checkCrawlHealth(env: Env): Promise<string | null> {
  const recent = await env.DB.prepare(
    "SELECT status, started_at, error_detail FROM crawl_runs WHERE source='eaf_register' ORDER BY started_at DESC LIMIT 2",
  ).all<{ status: string; started_at: string; error_detail: string | null }>();
  const rows = recent.results;
  if (rows.length >= 2 && rows.every((r) => r.status === "error" || r.status === "blocked")) {
    return `Last 2 crawl runs failed. Latest: ${rows[0].started_at} ${rows[0].status} ${rows[0].error_detail ?? ""}`;
  }
  return null;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
