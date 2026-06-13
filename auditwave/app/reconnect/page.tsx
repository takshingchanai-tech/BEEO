"use client";

import { useState } from "react";
import Link from "next/link";
import { useLang } from "../../lib/useLang";
import { T } from "../../lib/content";
import { API_BASE } from "../../lib/config";

export default function ReconnectPage() {
  const [lang, setLang] = useLang();
  const t = <K extends keyof typeof T>(k: K) => (T[k] as Record<string, unknown>)[lang] as string;
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await fetch(`${API_BASE}/api/login/request`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setSent(true);
  }

  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-lg font-bold text-emerald-950">AuditWave HK</Link>
        <button onClick={() => setLang(lang === "zh" ? "en" : "zh")} className="rounded border border-stone-300 px-2 py-1 text-xs">
          {lang === "zh" ? "EN" : "中"}
        </button>
      </div>
      <h1 className="mt-10 text-2xl font-bold text-emerald-950">{t("login_title")}</h1>
      {sent ? (
        <p className="mt-6 text-stone-700">{t("login_sent")}</p>
      ) : (
        <>
          <p className="mt-3 text-sm text-stone-600">{t("login_desc")}</p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-stone-300 px-3 py-2" placeholder="email@company.com" />
            <button type="submit" className="w-full rounded-md bg-emerald-900 px-4 py-2.5 font-semibold text-white">
              {t("login_send")}
            </button>
          </form>
        </>
      )}
    </main>
  );
}
