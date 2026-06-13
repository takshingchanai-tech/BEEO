"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLang } from "../lib/useLang";
import { T, DISTRICTS, BUILDING_TYPES, PLANS } from "../lib/content";
import { API_BASE } from "../lib/config";

export default function SignupPage() {
  const [lang, setLang] = useLang();
  const t = <K extends keyof typeof T>(k: K) => (T[k] as Record<string, unknown>)[lang] as string;

  const [tier, setTier] = useState("district");
  const [company, setCompany] = useState("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [districts, setDistricts] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [vertical, setVertical] = useState("");
  const [availableVerticals, setAvailableVerticals] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("tier");
    if (q === "territory" || q === "exclusive" || q === "district") setTier(q);
    fetch(`${API_BASE}/api/verticals`)
      .then((r) => r.json())
      .then((d: { available: string[] }) => setAvailableVerticals(d.available))
      .catch(() => setAvailableVerticals(BUILDING_TYPES.map((b) => b.key)));
  }, []);

  function toggle(list: string[], set: (v: string[]) => void, key: string) {
    set(list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/signup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          company,
          contact_name: contact || null,
          email,
          language: lang,
          tier,
          districts: tier === "district" ? districts : [],
          building_types: tier === "exclusive" ? [] : types,
          ...(tier === "exclusive" ? { exclusive_vertical: vertical } : {}),
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "error");
        return;
      }
      setDone(true);
    } catch {
      setError("network error");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <main className="mx-auto max-w-xl px-4 py-20 text-center">
        <div className="text-5xl">✓</div>
        <h1 className="mt-4 text-2xl font-bold text-emerald-950">{t("signup_success")}</h1>
        <Link href="/" className="mt-8 inline-block text-emerald-900 underline">← AuditWave HK</Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-lg font-bold text-emerald-950">AuditWave HK</Link>
        <button onClick={() => setLang(lang === "zh" ? "en" : "zh")} className="rounded border border-stone-300 px-2 py-1 text-xs">
          {lang === "zh" ? "EN" : "中"}
        </button>
      </div>
      <h1 className="mt-8 text-2xl font-bold text-emerald-950">{t("signup_title")}</h1>

      <form onSubmit={submit} className="mt-8 space-y-6">
        <div>
          <label className="block text-sm font-semibold">{t("signup_tier")}</label>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {PLANS.map((p) => (
              <button
                type="button"
                key={p.key}
                onClick={() => setTier(p.key)}
                className={`rounded-lg border p-3 text-left text-sm ${tier === p.key ? "border-emerald-900 bg-emerald-50" : "border-stone-200 bg-white"}`}
              >
                <div className="font-bold">{p[lang].name}</div>
                <div className="text-stone-600">HK${p.priceHkd.toLocaleString()}/{lang === "zh" ? "月" : "mo"}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold">{t("signup_company")}</label>
          <input required maxLength={200} value={company} onChange={(e) => setCompany(e.target.value)}
            className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" />
        </div>
        <div>
          <label className="block text-sm font-semibold">{t("signup_contact")}</label>
          <input maxLength={150} value={contact} onChange={(e) => setContact(e.target.value)}
            className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" />
        </div>
        <div>
          <label className="block text-sm font-semibold">{t("signup_email")}</label>
          <input required type="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" />
        </div>

        {tier === "district" && (
          <div>
            <label className="block text-sm font-semibold">{t("signup_districts")}</label>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {DISTRICTS.map((d) => (
                <button type="button" key={d.key} onClick={() => toggle(districts, setDistricts, d.key)}
                  className={`rounded border px-2 py-1.5 text-sm ${districts.includes(d.key) ? "border-emerald-900 bg-emerald-50" : "border-stone-200 bg-white"}`}>
                  {d[lang]}
                </button>
              ))}
            </div>
          </div>
        )}

        {tier !== "exclusive" && (
          <div>
            <label className="block text-sm font-semibold">{t("signup_types")}</label>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {BUILDING_TYPES.map((b) => (
                <button type="button" key={b.key} onClick={() => toggle(types, setTypes, b.key)}
                  className={`rounded border px-2 py-1.5 text-sm ${types.includes(b.key) ? "border-emerald-900 bg-emerald-50" : "border-stone-200 bg-white"}`}>
                  {b[lang]}
                </button>
              ))}
            </div>
          </div>
        )}

        {tier === "exclusive" && (
          <div>
            <label className="block text-sm font-semibold">{t("signup_vertical")}</label>
            <select required value={vertical} onChange={(e) => setVertical(e.target.value)}
              className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2">
              <option value="">—</option>
              {BUILDING_TYPES.filter((b) => availableVerticals.includes(b.key)).map((b) => (
                <option key={b.key} value={b.key}>{b[lang]}</option>
              ))}
            </select>
          </div>
        )}

        {error && <p className="text-sm text-red-700">{error}</p>}
        <button disabled={busy} type="submit"
          className="w-full rounded-md bg-emerald-900 px-4 py-3 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
          {busy ? "…" : t("signup_submit")}
        </button>
      </form>
    </main>
  );
}
