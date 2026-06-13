// Daily crawl of the EMSD EAF register.
// The register server-renders the entire list (~2.7K rows) in one page, in EN and TC
// variants. One GET per language per day, snapshot to R2, parse, join, upsert.

import { parseRegisterPage, joinBilingual, normalizeAddress, type RegisterRow } from "./parser";
import { computeDeadlines, parseRegisterDate } from "./regulatory";
import { type Env, todayISO, nowISO, sha256Hex, sendBatchChunked, type PipelineMessage } from "./types";

const UA = "AuditWaveHK-crawler/1.0 (registry intelligence; contact: hello@auditwavehk.com)";

async function fetchRegister(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`register fetch ${url} -> HTTP ${res.status}`);
  const html = await res.text();
  if (html.length < 100_000) {
    // a real register page is ~1.8 MB; small responses mean an error/block page
    throw new Error(`register fetch ${url} -> suspiciously small body (${html.length} bytes)`);
  }
  return html;
}

export async function runCrawl(env: Env): Promise<{ seen: number; newRows: number; changed: number }> {
  const runId = crypto.randomUUID();
  const today = todayISO();
  await env.DB.prepare(
    "INSERT INTO crawl_runs (id, source, started_at, status) VALUES (?, 'eaf_register', ?, 'running')",
  ).bind(runId, nowISO()).run();

  try {
    const [enHtml, tcHtml] = await Promise.all([
      fetchRegister(env.EMSD_EAF_EN_URL),
      fetchRegister(env.EMSD_EAF_TC_URL),
    ]);

    // Snapshot raw HTML (audit trail + re-parse without re-crawl)
    await env.CRAWL_CACHE.put(`eaf/${today}/en.html`, enHtml);
    await env.CRAWL_CACHE.put(`eaf/${today}/tc.html`, tcHtml);

    const enRows = parseRegisterPage(enHtml);
    const tcRows = parseRegisterPage(tcHtml);
    const joined = joinBilingual(enRows, tcRows);

    let newRows = 0;
    let changed = 0;
    const stmts: D1PreparedStatement[] = [];

    const upsertBuilding = env.DB.prepare(`
      INSERT INTO buildings (id, name_en, name_zh, address_en, address_zh, is_demolished, first_seen, last_seen, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8)
      ON CONFLICT(id) DO UPDATE SET
        name_en = COALESCE(NULLIF(excluded.name_en, ''), buildings.name_en),
        name_zh = COALESCE(NULLIF(excluded.name_zh, ''), buildings.name_zh),
        address_zh = COALESCE(excluded.address_zh, buildings.address_zh),
        is_demolished = excluded.is_demolished,
        last_seen = excluded.last_seen
    `);
    const upsertEaf = env.DB.prepare(`
      INSERT INTO eaf_records (id, building_id, expiry_published, issue_date_derived, deadline_new_regime,
                               code_edition, eui_mj, eui_kwh, prev_expiry_published, prev_eui_mj, rea_no,
                               first_seen, last_seen)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)
      ON CONFLICT(building_id, expiry_published) DO UPDATE SET
        issue_date_derived = excluded.issue_date_derived,
        deadline_new_regime = excluded.deadline_new_regime,
        code_edition = excluded.code_edition,
        eui_mj = excluded.eui_mj,
        eui_kwh = excluded.eui_kwh,
        prev_expiry_published = COALESCE(excluded.prev_expiry_published, eaf_records.prev_expiry_published),
        prev_eui_mj = COALESCE(excluded.prev_eui_mj, eaf_records.prev_eui_mj),
        rea_no = COALESCE(excluded.rea_no, eaf_records.rea_no),
        last_seen = excluded.last_seen
    `);

    for (const { en, tc } of joined) {
      if (!en.address) continue;
      const buildingId = await sha256Hex(normalizeAddress(en.address));
      stmts.push(
        upsertBuilding.bind(
          buildingId,
          en.name || null,
          tc?.name || null,
          en.address,
          tc?.address || null,
          en.isDemolished || tc?.isDemolished ? 1 : 0,
          today,
          nowISO(),
        ),
      );
      const expiryISO = parseRegisterDate(en.expiryDate);
      if (expiryISO) {
        const d = computeDeadlines(expiryISO);
        const eafId = await sha256Hex(`${buildingId}|${expiryISO}`);
        stmts.push(
          upsertEaf.bind(
            eafId, buildingId, expiryISO, d.issueDate, d.newRegimeDeadline, d.codeEdition,
            en.euiMj, en.euiKwh, parseRegisterDate(en.prevExpiryDate), en.prevEuiMj, en.reaNo,
            today,
          ),
        );
      }
    }

    // Snapshot counts before, to report new rows
    const before = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM buildings) AS b, (SELECT COUNT(*) FROM eaf_records) AS e",
    ).first<{ b: number; e: number }>();

    for (let i = 0; i < stmts.length; i += 50) {
      await env.DB.batch(stmts.slice(i, i + 50));
    }

    const after = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM buildings) AS b, (SELECT COUNT(*) FROM eaf_records) AS e",
    ).first<{ b: number; e: number }>();
    newRows = (after!.b - before!.b) + (after!.e - before!.e);
    changed = joined.length; // rows touched

    await env.DB.prepare(
      "UPDATE crawl_runs SET finished_at=?, pages_fetched=2, rows_seen=?, rows_new=?, rows_changed=?, status='ok' WHERE id=?",
    ).bind(nowISO(), joined.length, newRows, changed, runId).run();

    // Enqueue memo drafting: classified buildings whose deadline is inside 18 months,
    // no memo yet (budget 20/run to keep Sonnet spend predictable)
    const horizon = addMonthsISO(today, 18);
    const memoTargets = await env.DB.prepare(`
      SELECT e.id FROM eaf_records e
      JOIN buildings b ON b.id = e.building_id
      WHERE e.memo_generated_at IS NULL
        AND b.is_demolished = 0
        AND b.building_type IS NOT NULL AND b.building_type != 'unknown'
        AND e.deadline_new_regime <= ?
        AND e.expiry_published = (SELECT MAX(e2.expiry_published) FROM eaf_records e2 WHERE e2.building_id = e.building_id)
      ORDER BY e.deadline_new_regime LIMIT 20
    `).bind(horizon).all<{ id: string }>();
    if (memoTargets.results.length > 0) {
      await sendBatchChunked(
        env.PIPELINE_QUEUE,
        memoTargets.results.map((r, i) => ({
          body: { type: "memo", eafId: r.id } as PipelineMessage,
          delaySeconds: i * 2,
        })),
      );
    }

    return { seen: joined.length, newRows, changed };
  } catch (err) {
    await env.DB.prepare(
      "UPDATE crawl_runs SET finished_at=?, status='error', error_detail=? WHERE id=?",
    ).bind(nowISO(), String(err), runId).run();
    throw err;
  }
}

function addMonthsISO(iso: string, months: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}
