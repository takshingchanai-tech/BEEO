// auditwave-cron — crawl engine, LLM pipeline, weekly digests, trial lifecycle.
//
// Cron triggers:
//   0 18 * * *  (= 02:00 HKT)  daily: crawl -> classify -> memo pipeline + housekeeping
//   0 0  * * 1  (= 08:00 HKT Monday)  weekly digest fan-out
//
// Queue (auditwave-queue) message types: crawl, classify, memo, digest_dispatch, digest_email.
// Manual triggers (guarded by CRON_TRIGGER_KEY): /trigger-crawl /trigger-digest
//   /classify-batch /health

import { runCrawl } from "./crawl";
import { classifyBuilding } from "./classify";
import { draftMemo } from "./memo";
import { startDigestWeek, dispatchDigest, sendDigestEmail } from "./digest";
import { runTrialManagement, checkCrawlHealth } from "./trials";
import { sendAlert } from "./emails";
import { sendBatchChunked, type Env, type PipelineMessage } from "./types";

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (controller.cron === "0 0 * * 1") {
      const n = await startDigestWeek(env);
      console.log(`weekly digest: dispatched ${n} clients`);
      return;
    }
    // daily 18:00 UTC
    await env.PIPELINE_QUEUE.send({ type: "crawl" });
    ctx.waitUntil(
      (async () => {
        await runTrialManagement(env);
        const unhealthy = await checkCrawlHealth(env);
        if (unhealthy) await sendAlert(env, "EAF crawl failing", unhealthy);
      })(),
    );
  },

  async queue(batch: MessageBatch<PipelineMessage>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      const m = msg.body;
      try {
        switch (m.type) {
          case "crawl": {
            const r = await runCrawl(env);
            console.log(`crawl ok: seen=${r.seen} new=${r.newRows}`);
            break;
          }
          case "classify": {
            const provider = env.LLM_PROVIDER ?? "anthropic";
            const hasKey = provider === "openai" ? !!env.OPENAI_API_KEY : !!env.ANTHROPIC_API_KEY;
            if (!hasKey) {
              console.log(`classify skipped: ${provider.toUpperCase()}_API_KEY not set`);
              break;
            }
            await classifyBuilding(env, m.buildingId);
            break;
          }
          case "memo": {
            const provider = env.LLM_PROVIDER ?? "anthropic";
            const hasKey = provider === "openai" ? !!env.OPENAI_API_KEY : !!env.ANTHROPIC_API_KEY;
            if (!hasKey) {
              console.log(`memo skipped: ${provider.toUpperCase()}_API_KEY not set`);
              break;
            }
            await draftMemo(env, m.eafId);
            break;
          }
          case "digest_dispatch":
            await dispatchDigest(env, m.clientId, m.periodStart, m.periodEnd);
            break;
          case "digest_email":
            await sendDigestEmail(env, m.clientId, m.periodStart, m.periodEnd, m.eafIds);
            break;
        }
        msg.ack();
      } catch (err) {
        console.error(`queue ${m.type} failed:`, err);
        if (m.type === "crawl") {
          // crawl failures already recorded in crawl_runs; alert on repeat via watchdog
          msg.ack();
          await sendAlert(env, "EAF crawl run failed", String(err));
        } else {
          msg.retry({ delaySeconds: 60 });
        }
      }
    }
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.searchParams.get("key") !== env.CRON_TRIGGER_KEY) {
      return new Response("forbidden", { status: 403 });
    }

    switch (url.pathname) {
      case "/trigger-crawl": {
        await env.PIPELINE_QUEUE.send({ type: "crawl" });
        return json({ queued: "crawl" });
      }
      case "/trigger-digest": {
        const n = await startDigestWeek(env);
        return json({ dispatched: n });
      }
      case "/classify-batch": {
        // backfill helper: enqueue N unclassified buildings at optional OFFSET
        // Use offset to fan out parallel calls over non-overlapping slices, e.g.:
        //   /classify-batch?n=200&offset=0
        //   /classify-batch?n=200&offset=200  ...
        const limit = Math.min(Number(url.searchParams.get("n") ?? 200), 500);
        const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);
        const rows = await env.DB.prepare(
          "SELECT id FROM buildings WHERE building_type IS NULL AND is_demolished=0 LIMIT ? OFFSET ?",
        ).bind(limit, offset).all<{ id: string }>();
        await sendBatchChunked(
          env.PIPELINE_QUEUE,
          rows.results.map((r) => ({
            body: { type: "classify", buildingId: r.id } as PipelineMessage,
          })),
        );
        return json({ queued_classify: rows.results.length, offset });
      }
      case "/trigger-trials": {
        await runTrialManagement(env);
        return json({ ok: true });
      }
      case "/health": {
        const stats = await env.DB.prepare(`
          SELECT
            (SELECT COUNT(*) FROM buildings) AS buildings,
            (SELECT COUNT(*) FROM buildings WHERE building_type IS NOT NULL) AS classified,
            (SELECT COUNT(*) FROM buildings WHERE is_new_scope=1) AS new_scope,
            (SELECT COUNT(*) FROM eaf_records) AS eafs,
            (SELECT COUNT(*) FROM eaf_records WHERE memo_generated_at IS NOT NULL) AS memos,
            (SELECT COUNT(*) FROM clients) AS clients,
            (SELECT COUNT(*) FROM sent_digests) AS digests
        `).first();
        const lastRun = await env.DB.prepare(
          "SELECT * FROM crawl_runs ORDER BY started_at DESC LIMIT 1",
        ).first();
        return json({ stats, lastRun });
      }
      default:
        return new Response("not found", { status: 404 });
    }
  },
};

function json(o: unknown): Response {
  return new Response(JSON.stringify(o, null, 2), {
    headers: { "content-type": "application/json" },
  });
}
