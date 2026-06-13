// auditwave-stripe — Stripe webhook handler (ported from norgeconnect-stripe).
// Events: customer.subscription.created, invoice.paid, invoice.payment_failed,
// customer.subscription.deleted. Currency HKD; tiers district/territory/exclusive.

export interface Env {
  DB: D1Database;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_SECRET_KEY: string;
  RESEND_API_KEY?: string;

  SITE_URL: string;
  SYSTEM_FROM_EMAIL: string;
  EMAIL_DRY_RUN: string;
  STRIPE_PRICE_ID_DISTRICT?: string;
  STRIPE_PRICE_ID_TERRITORY?: string;
  STRIPE_PRICE_ID_EXCLUSIVE?: string;
}

interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

// ---------- signature verification (incl. Norway #79 NaN guard) ----------

async function verifyStripeSignature(req: Request, env: Env, payload: string): Promise<boolean> {
  const sigHeader = req.headers.get("stripe-signature");
  if (!sigHeader) return false;
  const parts = Object.fromEntries(
    sigHeader.split(",").map((p) => p.split("=", 2) as [string, string]),
  );
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return false;
  const ts = Number(t);
  if (Number.isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`));
  const expected = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return expected.length === v1.length && expected === v1;
}

// ---------- helpers ----------

function tierForPrice(env: Env, priceId: string | undefined): { tier: string; csv: number } {
  if (priceId && priceId === env.STRIPE_PRICE_ID_EXCLUSIVE) return { tier: "exclusive", csv: 1 };
  if (priceId && priceId === env.STRIPE_PRICE_ID_TERRITORY) return { tier: "territory", csv: 1 };
  return { tier: "district", csv: 0 };
}

async function stripeGet(env: Env, path: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as Record<string, unknown>;
}

interface Client {
  id: string; email: string; company: string; language: "zh" | "en"; status: string;
}

/** Find by stripe_customer_id; fall back to Stripe-customer email match and backfill the ID. */
async function findClient(env: Env, customerId: string): Promise<Client | null> {
  let c = await env.DB.prepare(
    "SELECT id, email, company, language, status FROM clients WHERE stripe_customer_id = ?",
  ).bind(customerId).first<Client>();
  if (c) return c;
  const customer = await stripeGet(env, `customers/${customerId}`);
  const email = typeof customer?.email === "string" ? customer.email.toLowerCase().trim() : null;
  if (!email) return null;
  c = await env.DB.prepare(
    "SELECT id, email, company, language, status FROM clients WHERE email = ?",
  ).bind(email).first<Client>();
  if (c) {
    await env.DB.prepare("UPDATE clients SET stripe_customer_id=? WHERE id=?").bind(customerId, c.id).run();
  }
  return c;
}

function customerIdOf(obj: Record<string, unknown>): string | null {
  const c = obj.customer;
  if (typeof c === "string") return c;
  if (c && typeof c === "object" && typeof (c as Record<string, unknown>).id === "string") {
    return (c as Record<string, unknown>).id as string;
  }
  return null;
}

async function sendEmail(env: Env, to: string, subject: string, html: string): Promise<void> {
  if (env.EMAIL_DRY_RUN === "1" || !env.RESEND_API_KEY) {
    console.log(`[EMAIL_DRY_RUN] to=${to} subject="${subject}"`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.RESEND_API_KEY}` },
    body: JSON.stringify({ from: `AuditWave HK <${env.SYSTEM_FROM_EMAIL}>`, to: [to], subject, html }),
  });
  if (!res.ok) console.error(`resend ${res.status}`);
}

function shell(env: Env, lang: "zh" | "en", body: string): string {
  return `<!DOCTYPE html><html><body style="margin:0;background:#F5F5F2;font-family:-apple-system,'Segoe UI',Arial,'PingFang TC',sans-serif;">
<table role="presentation" width="100%"><tr><td align="center" style="padding:24px 0;">
<table role="presentation" width="560" style="max-width:560px;width:100%;">
<tr><td style="background:#0E3B2E;color:#fff;padding:16px 24px;border-radius:8px 8px 0 0;font-weight:700;">AuditWave HK</td></tr>
<tr><td style="background:#fff;padding:24px;border-radius:0 0 8px 8px;font-size:14px;line-height:1.6;">${body}</td></tr>
</table></td></tr></table></body></html>`;
}

// ---------- event handlers ----------

async function onSubscriptionCreated(env: Env, obj: Record<string, unknown>): Promise<void> {
  const customerId = customerIdOf(obj);
  if (!customerId) return;
  const client = await findClient(env, customerId);
  if (!client) {
    console.error(`subscription.created: no client for customer ${customerId}`);
    return;
  }
  const items = (obj.items as { data?: { id: string; price?: { id: string }; current_period_end?: number }[] })?.data ?? [];
  const priceId = items[0]?.price?.id;
  const periodEnd = items[0]?.current_period_end;
  const { tier, csv } = tierForPrice(env, priceId);

  await env.DB.prepare(`
    UPDATE clients SET status='active', tier=?, csv_export_enabled=?,
      stripe_subscription_id=?, stripe_price_id=?, next_billing_date=?
    WHERE id=?
  `).bind(
    tier, csv, obj.id as string, priceId ?? null,
    periodEnd ? new Date(periodEnd * 1000).toISOString().slice(0, 10) : null,
    client.id,
  ).run();

  const lang = client.language;
  await sendEmail(env, client.email,
    lang === "zh" ? "訂閱已啟用" : "Subscription activated",
    shell(env, lang, lang === "zh"
      ? `<p>${client.company} 的訂閱已啟用（${tier}）。每逢星期一您將收到期限線索摘要。</p><p><a href="${env.SITE_URL}/dashboard">前往儀表板</a></p>`
      : `<p>The subscription for ${client.company} is now active (${tier} plan). Your deadline-lead digest arrives every Monday.</p><p><a href="${env.SITE_URL}/dashboard">Go to dashboard</a></p>`));
}

async function onInvoicePaid(env: Env, obj: Record<string, unknown>): Promise<void> {
  const customerId = customerIdOf(obj);
  if (!customerId) return;
  const client = await findClient(env, customerId);
  if (!client) return;

  const stripeInvoiceId = obj.id as string;
  const dup = await env.DB.prepare("SELECT 1 FROM invoices WHERE stripe_invoice_id=?")
    .bind(stripeInvoiceId).first();
  if (dup) return;

  const lines = (obj.lines as { data?: { period?: { start: number; end: number } }[] })?.data ?? [];
  const period = lines[0]?.period;
  const amountHkd = Math.round(((obj.amount_paid as number) ?? 0) / 100);
  const year = new Date().getFullYear();

  // atomic numbering: AW-YYYY-NNN via MAX()+1 inside the INSERT (Norway pattern)
  await env.DB.prepare(`
    INSERT INTO invoices (id, client_id, stripe_invoice_id, amount_hkd, period_start, period_end, issued_at)
    SELECT 'AW-' || ?1 || '-' || printf('%03d',
        COALESCE((SELECT MAX(CAST(substr(id, -3) AS INTEGER)) FROM invoices WHERE id LIKE 'AW-' || ?1 || '-%'), 0) + 1),
      ?2, ?3, ?4, ?5, ?6, datetime('now')
  `).bind(
    String(year), client.id, stripeInvoiceId, amountHkd,
    period ? new Date(period.start * 1000).toISOString().slice(0, 10) : "",
    period ? new Date(period.end * 1000).toISOString().slice(0, 10) : "",
  ).run();

  // keep client active + billing date current
  const periodEndIso = period ? new Date(period.end * 1000).toISOString().slice(0, 10) : null;
  await env.DB.prepare(
    "UPDATE clients SET status=CASE WHEN status IN ('paused','awaiting') THEN 'active' ELSE status END, next_billing_date=COALESCE(?, next_billing_date) WHERE id=?",
  ).bind(periodEndIso, client.id).run();

  const pdf = typeof obj.invoice_pdf === "string" ? obj.invoice_pdf : null;
  const lang = client.language;
  await sendEmail(env, client.email,
    lang === "zh" ? "付款確認" : "Payment confirmed",
    shell(env, lang, (lang === "zh"
      ? `<p>已收到 HK$${amountHkd} 付款，多謝。</p>`
      : `<p>We've received your payment of HK$${amountHkd}. Thank you.</p>`)
      + (pdf ? `<p><a href="${pdf}">${lang === "zh" ? "下載發票 (PDF)" : "Download invoice (PDF)"}</a></p>` : "")));
}

async function onPaymentFailed(env: Env, obj: Record<string, unknown>): Promise<void> {
  const customerId = customerIdOf(obj);
  if (!customerId) return;
  const client = await findClient(env, customerId);
  if (!client) return;
  if (client.status === "cancelled") return; // orphaned-subscription guard (Norway #98)
  if (client.status === "paused") return;    // dedup: Stripe retries fire repeatedly

  await env.DB.prepare("UPDATE clients SET status='paused' WHERE id=?").bind(client.id).run();
  const lang = client.language;
  await sendEmail(env, client.email,
    lang === "zh" ? "付款失敗 — 線索摘要已暫停" : "Payment failed — your digest is paused",
    shell(env, lang, lang === "zh"
      ? `<p style="color:#B3261E;font-weight:700;">付款未能完成。</p><p>請更新付款資料以恢復每週線索摘要。</p><p><a href="${env.SITE_URL}/dashboard">前往儀表板</a></p>`
      : `<p style="color:#B3261E;font-weight:700;">Your payment could not be processed.</p><p>Update your payment details to resume the weekly digest.</p><p><a href="${env.SITE_URL}/dashboard">Go to dashboard</a></p>`));
}

async function onSubscriptionDeleted(env: Env, obj: Record<string, unknown>): Promise<void> {
  const customerId = customerIdOf(obj);
  if (!customerId) return;
  const client = await findClient(env, customerId);
  if (!client) return;

  await env.DB.prepare(`
    UPDATE clients SET status='cancelled', exclusive_vertical=NULL,
      cancelled_at=COALESCE(cancelled_at, datetime('now'))
    WHERE id=?
  `).bind(client.id).run();

  const lang = client.language;
  await sendEmail(env, client.email,
    lang === "zh" ? "訂閱已取消" : "Subscription cancelled",
    shell(env, lang, lang === "zh"
      ? `<p>${client.company} 的訂閱已取消。歡迎隨時重新登記。</p>`
      : `<p>The subscription for ${client.company} has been cancelled. You're welcome back any time.</p>`));
}

// ---------- entry ----------

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const payload = await req.text();
    if (!(await verifyStripeSignature(req, env, payload))) {
      return new Response("invalid signature", { status: 400 });
    }
    let event: StripeEvent;
    try {
      event = JSON.parse(payload) as StripeEvent;
    } catch {
      return new Response("bad payload", { status: 400 });
    }

    try {
      switch (event.type) {
        case "customer.subscription.created":
          await onSubscriptionCreated(env, event.data.object);
          break;
        case "invoice.paid":
          await onInvoicePaid(env, event.data.object);
          break;
        case "invoice.payment_failed":
          await onPaymentFailed(env, event.data.object);
          break;
        case "customer.subscription.deleted":
          await onSubscriptionDeleted(env, event.data.object);
          break;
        default:
          console.log(`ignored event ${event.type}`);
      }
    } catch (err) {
      console.error(`webhook ${event.type} failed:`, err);
      return new Response("handler error", { status: 500 }); // Stripe will retry
    }
    return new Response("ok");
  },
};
