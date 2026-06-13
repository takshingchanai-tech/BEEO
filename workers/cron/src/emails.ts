// System email sending via Resend, with a dry-run mode for the period before the
// production domain's DKIM/SPF/DMARC are verified (EMAIL_DRY_RUN="1").
// Template style ported from NorwayContact: header bar, white card body, grey footer.

import type { Env } from "./types";

export async function sendEmail(
  env: Env,
  to: string,
  subject: string,
  html: string,
  opts: { listUnsubscribe?: boolean } = {},
): Promise<boolean> {
  if (env.EMAIL_DRY_RUN === "1" || !env.RESEND_API_KEY) {
    console.log(`[EMAIL_DRY_RUN] to=${to} subject="${subject}" htmlBytes=${html.length}`);
    return true;
  }
  const headers: Record<string, string> = {};
  if (opts.listUnsubscribe !== false) {
    headers["List-Unsubscribe"] = `<mailto:${env.SYSTEM_FROM_EMAIL}?subject=unsubscribe>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: `AuditWave HK <${env.SYSTEM_FROM_EMAIL}>`,
      to: [to],
      subject,
      html,
      headers,
    }),
  });
  if (!res.ok) {
    console.error(`resend failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    return false;
  }
  return true;
}

export function emailShell(env: Env, lang: "zh" | "en", bodyHtml: string): string {
  const footer = lang === "zh"
    ? `AuditWave HK — 香港能源審核期限情報 · <a href="${env.SITE_URL}" style="color:#888">網站</a>`
    : `AuditWave HK — Hong Kong energy-audit deadline intelligence · <a href="${env.SITE_URL}" style="color:#888">Website</a>`;
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#F5F5F2;font-family:-apple-system,'Segoe UI',Helvetica,Arial,'PingFang TC','Microsoft JhengHei',sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F5F2;padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
<tr><td style="background:#0E3B2E;color:#fff;padding:16px 24px;border-radius:8px 8px 0 0;font-size:18px;font-weight:700;">AuditWave HK</td></tr>
<tr><td style="background:#ffffff;padding:24px;border-radius:0 0 8px 8px;color:#222;font-size:14px;line-height:1.6;">${bodyHtml}</td></tr>
<tr><td style="padding:16px 24px;color:#888;font-size:11px;text-align:center;">${footer}</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

export async function sendAlert(env: Env, subject: string, detail: string): Promise<void> {
  console.error(`[ALERT] ${subject}: ${detail}`);
  await sendEmail(
    env,
    env.ALERT_EMAIL,
    `[AuditWave alert] ${subject}`,
    emailShell(env, "en", `<p><strong>${subject}</strong></p><pre style="font-size:12px;white-space:pre-wrap">${detail}</pre>`),
    { listUnsubscribe: false },
  );
}
