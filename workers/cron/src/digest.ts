// Weekly digest: lead selection + rendering + delivery.
// Two queue stages (Norway pattern): digest_dispatch selects leads per client and
// enqueues digest_email; digest_email renders + sends one email in its own invocation.

import { urgencyBand, addMonths } from "./regulatory";
import { sendEmail, emailShell } from "./emails";
import { todayISO, nowISO, sendBatchChunked, type Env, type PipelineMessage } from "./types";

const MAX_LEADS_PER_DIGEST = 40;

interface Lead {
  eaf_id: string;
  building_id: string;
  name_en: string | null;
  name_zh: string | null;
  address_en: string;
  address_zh: string | null;
  district: string | null;
  building_type: string | null;
  deadline_new_regime: string;
  expiry_published: string;
  code_edition: string;
  memo_en: string | null;
  memo_zh: string | null;
}

/** Kick off the weekly digest fan-out: one dispatch message per receiving client. */
export async function startDigestWeek(env: Env): Promise<number> {
  const today = todayISO();
  const periodStart = addDaysISO(today, -7);
  const clients = await env.DB.prepare(
    "SELECT id FROM clients WHERE status IN ('trial','active') AND pause_digests = 0",
  ).all<{ id: string }>();
  if (clients.results.length === 0) return 0;
  await sendBatchChunked(
    env.PIPELINE_QUEUE,
    clients.results.map((c, i) => ({
      body: {
        type: "digest_dispatch", clientId: c.id, periodStart, periodEnd: today,
      } as PipelineMessage,
      delaySeconds: i * 2, // stagger dispatches
    })),
  );
  return clients.results.length;
}

/** Select this client's new leads and enqueue the send. */
export async function dispatchDigest(
  env: Env,
  clientId: string,
  periodStart: string,
  periodEnd: string,
): Promise<void> {
  const client = await env.DB.prepare(
    "SELECT id, tier, exclusive_vertical, status, pause_digests FROM clients WHERE id = ?",
  ).bind(clientId).first<{
    id: string; tier: string; exclusive_vertical: string | null; status: string; pause_digests: number;
  }>();
  if (!client || client.pause_digests === 1) return;
  if (client.status !== "trial" && client.status !== "active") return;

  const today = todayISO();
  const horizon = addMonths(today, 18);

  // District tier filters by selected districts; territory/exclusive see all districts.
  // Building-type filters apply when the client selected any; exclusive tier is locked
  // to its vertical.
  const leads = await env.DB.prepare(`
    SELECT e.id AS eaf_id, b.id AS building_id, b.name_en, b.name_zh, b.address_en, b.address_zh,
           b.district, b.building_type, e.deadline_new_regime, e.expiry_published,
           e.code_edition, e.memo_en, e.memo_zh
    FROM eaf_records e
    JOIN buildings b ON b.id = e.building_id
    WHERE b.is_demolished = 0
      AND e.deadline_new_regime <= ?1
      AND e.expiry_published = (SELECT MAX(e2.expiry_published) FROM eaf_records e2 WHERE e2.building_id = b.id)
      AND NOT EXISTS (SELECT 1 FROM delivered_leads dl WHERE dl.client_id = ?2 AND dl.building_id = b.id)
      AND (
        ?3 != 'district'
        OR EXISTS (SELECT 1 FROM client_districts cd WHERE cd.client_id = ?2 AND cd.district = b.district)
      )
      AND (
        ?4 IS NOT NULL AND b.building_type = ?4
        OR ?4 IS NULL AND (
          NOT EXISTS (SELECT 1 FROM client_building_types ct WHERE ct.client_id = ?2)
          OR EXISTS (SELECT 1 FROM client_building_types ct WHERE ct.client_id = ?2 AND ct.building_type = b.building_type)
        )
      )
    ORDER BY e.deadline_new_regime
    LIMIT ?5
  `).bind(horizon, clientId, client.tier, client.exclusive_vertical, MAX_LEADS_PER_DIGEST)
    .all<Lead>();

  if (leads.results.length === 0) {
    console.log(`digest_dispatch ${clientId}: no new leads this week`);
    return;
  }

  await env.PIPELINE_QUEUE.send({
    type: "digest_email",
    clientId,
    periodStart,
    periodEnd,
    eafIds: leads.results.map((l) => l.eaf_id),
  });
}

/** Render and send one digest email; log delivery. */
export async function sendDigestEmail(
  env: Env,
  clientId: string,
  periodStart: string,
  periodEnd: string,
  eafIds: string[],
): Promise<void> {
  const client = await env.DB.prepare(
    "SELECT id, email, company, language, status FROM clients WHERE id = ?",
  ).bind(clientId).first<{ id: string; email: string; company: string; language: "zh" | "en"; status: string }>();
  if (!client || (client.status !== "trial" && client.status !== "active")) return;

  if (eafIds.length === 0) return;
  const placeholders = eafIds.map(() => "?").join(",");
  const leads = (await env.DB.prepare(`
    SELECT e.id AS eaf_id, b.id AS building_id, b.name_en, b.name_zh, b.address_en, b.address_zh,
           b.district, b.building_type, e.deadline_new_regime, e.expiry_published,
           e.code_edition, e.memo_en, e.memo_zh
    FROM eaf_records e JOIN buildings b ON b.id = e.building_id
    WHERE e.id IN (${placeholders})
    ORDER BY e.deadline_new_regime
  `).bind(...eafIds).all<Lead>()).results;

  const lang = client.language;
  const html = emailShell(env, lang, renderDigestBody(lang, leads, periodEnd));
  const subject = lang === "zh"
    ? `本週能源審核期限線索 — ${leads.length} 幢建築物`
    : `Your weekly energy-audit deadline pipeline — ${leads.length} buildings`;

  const ok = await sendEmail(env, client.email, subject, html);

  const digestId = crypto.randomUUID();
  const stmts = [
    env.DB.prepare(
      "INSERT INTO sent_digests (id, client_id, sent_at, period_start, period_end, lead_count, status) VALUES (?,?,?,?,?,?,?)",
    ).bind(digestId, clientId, nowISO(), periodStart, periodEnd, leads.length, ok ? "sent" : "failed"),
  ];
  if (ok) {
    const ins = env.DB.prepare(
      "INSERT OR IGNORE INTO delivered_leads (client_id, building_id, eaf_id, delivered_at) VALUES (?,?,?,?)",
    );
    for (const l of leads) stmts.push(ins.bind(clientId, l.building_id, l.eaf_id, nowISO()));
  }
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
}

const BAND_LABELS: Record<string, { zh: string; en: string; color: string }> = {
  overdue: { zh: "已逾期", en: "Overdue", color: "#B3261E" },
  due_6m: { zh: "6 個月內到期", en: "Due within 6 months", color: "#B3691E" },
  due_18m: { zh: "18 個月內到期", en: "Due within 18 months", color: "#5B6B1E" },
  later: { zh: "稍後到期", en: "Due later", color: "#555" },
};

function renderDigestBody(lang: "zh" | "en", leads: Lead[], today: string): string {
  const groups = new Map<string, Lead[]>();
  for (const l of leads) {
    const band = urgencyBand(l.deadline_new_regime, today);
    const g = groups.get(band);
    if (g) g.push(l);
    else groups.set(band, [l]);
  }
  const intro = lang === "zh"
    ? `<p>以下是貴公司篩選範圍內、本週新增的法定能源審核期限線索（共 ${leads.length} 項）。期限按《建築物能源效益（修訂）條例》計算。</p>`
    : `<p>${leads.length} new statutory energy-audit deadline leads matching your filters this week. Deadlines are computed under the amended Buildings Energy Efficiency Ordinance.</p>`;

  let html = intro;
  for (const band of ["overdue", "due_6m", "due_18m", "later"]) {
    const g = groups.get(band);
    if (!g) continue;
    const label = BAND_LABELS[band];
    html += `<h3 style="color:${label.color};margin:20px 0 8px;font-size:15px;">${lang === "zh" ? label.zh : label.en} (${g.length})</h3>`;
    for (const l of g) {
      const name = lang === "zh" ? (l.name_zh || l.name_en || l.address_zh || l.address_en) : (l.name_en || l.name_zh || l.address_en);
      const addr = lang === "zh" ? (l.address_zh || l.address_en) : l.address_en;
      const memo = lang === "zh" ? l.memo_zh : l.memo_en;
      html += `<div style="border:1px solid #e5e5e0;border-radius:6px;padding:12px;margin-bottom:10px;">
        <div style="font-weight:700;">${esc(name ?? "")}</div>
        <div style="color:#555;font-size:13px;">${esc(addr ?? "")}</div>
        <div style="font-size:13px;margin-top:6px;">
          ${lang === "zh" ? "審核期限" : "Audit deadline"}: <strong>${l.deadline_new_regime}</strong>
          · ${lang === "zh" ? "守則版本" : "Code edition"}: ${l.code_edition}
          ${l.building_type ? `· ${esc(l.building_type)}` : ""}
        </div>
        ${memo ? `<details style="margin-top:8px;"><summary style="cursor:pointer;font-size:13px;color:#0E3B2E;">${lang === "zh" ? "建議聯絡函稿" : "Suggested outreach memo"}</summary><div style="font-size:13px;color:#333;white-space:pre-wrap;margin-top:6px;">${esc(memo)}</div></details>` : ""}
      </div>`;
    }
  }
  html += lang === "zh"
    ? `<p style="font-size:12px;color:#888;margin-top:16px;">資料來源：機電工程署能源審核表格紀錄冊。期限為本服務根據條例計算之估算，採取行動前請以官方紀錄為準。</p>`
    : `<p style="font-size:12px;color:#888;margin-top:16px;">Source: EMSD register of Energy Audit Forms. Deadlines are our computed estimates under the Ordinance — verify against official records before acting.</p>`;
  return html;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
