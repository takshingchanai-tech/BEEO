"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useLang } from "../lib/useLang";
import { T, DISTRICTS, BUILDING_TYPES, PLANS } from "../lib/content";
import { API_BASE } from "../lib/config";

interface Status {
  id: string;
  company: string;
  language: "zh" | "en";
  tier: string;
  exclusive_vertical: string | null;
  status: string;
  trial_end: string;
  next_billing_date: string | null;
  pause_digests: number;
  csv_export_enabled: number;
  districts: string[];
  building_types: string[];
  recent_digests: { sent_at: string; lead_count: number; status: string }[];
  leads_delivered: number;
}

export default function DashboardPage() {
  const [lang, setLang] = useLang();
  const t = <K extends keyof typeof T>(k: K) => (T[k] as Record<string, unknown>)[lang] as string;

  const [data, setData] = useState<Status | null>(null);
  const [err, setErr] = useState("");
  const [districts, setDistricts] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const load = useCallback(async () => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (!id) {
      window.location.href = "/reconnect";
      return;
    }
    const res = await fetch(`${API_BASE}/api/status?id=${id}`, { credentials: "include" });
    if (!res.ok) {
      setErr("not found");
      return;
    }
    const d = (await res.json()) as Status;
    setData(d);
    setDistricts(d.districts);
    setTypes(d.building_types);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (err) return <main className="p-12 text-center">{err} — <Link className="underline" href="/reconnect">{t("nav_login")}</Link></main>;
  if (!data) return <main className="p-12 text-center">…</main>;

  const plan = PLANS.find((p) => p.key === data.tier);
  const trialDaysLeft = data.trial_end < "9999"
    ? Math.max(0, Math.ceil((new Date(data.trial_end + "T12:00:00Z").getTime() - Date.now()) / 86400000))
    : null;

  async function saveFilters() {
    setSaving(true);
    await fetch(`${API_BASE}/api/filters`, {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ districts, building_types: types }),
    }).then(async (r) => {
      if (r.status === 401) window.location.href = "/reconnect?error=session_expired";
    });
    setSaving(false);
  }

  async function togglePause() {
    await fetch(`${API_BASE}/api/client`, {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pause_digests: data!.pause_digests === 1 ? 0 : 1 }),
    });
    await load();
  }

  async function doCancel() {
    await fetch(`${API_BASE}/api/cancel`, { method: "POST", credentials: "include" });
    setConfirmCancel(false);
    await load();
  }

  function toggle(list: string[], set: (v: string[]) => void, key: string) {
    set(list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-lg font-bold text-emerald-950">AuditWave HK</Link>
        <button onClick={() => setLang(lang === "zh" ? "en" : "zh")} className="rounded border border-stone-300 px-2 py-1 text-xs">
          {lang === "zh" ? "EN" : "中"}
        </button>
      </div>
      <h1 className="mt-6 text-2xl font-bold text-emerald-950">{data.company}</h1>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Tile label={t("dash_leads")} value={String(data.leads_delivered)} />
        <Tile label={t("dash_plan")} value={plan ? plan[lang].name : data.tier} />
        <Tile label={t("dash_status")} value={data.status} />
        {trialDaysLeft !== null && <Tile label={t("dash_trial_left")} value={String(trialDaysLeft)} />}
      </div>

      <section className="mt-8 rounded-lg border border-stone-200 bg-white p-5">
        <h2 className="font-semibold">{t("dash_filters")}</h2>
        {data.tier === "district" && (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {DISTRICTS.map((d) => (
              <button key={d.key} onClick={() => toggle(districts, setDistricts, d.key)}
                className={`rounded border px-2 py-1.5 text-sm ${districts.includes(d.key) ? "border-emerald-900 bg-emerald-50" : "border-stone-200"}`}>
                {d[lang]}
              </button>
            ))}
          </div>
        )}
        {data.tier !== "exclusive" && (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {BUILDING_TYPES.map((b) => (
              <button key={b.key} onClick={() => toggle(types, setTypes, b.key)}
                className={`rounded border px-2 py-1.5 text-sm ${types.includes(b.key) ? "border-emerald-900 bg-emerald-50" : "border-stone-200"}`}>
                {b[lang]}
              </button>
            ))}
          </div>
        )}
        {data.tier === "exclusive" && (
          <p className="mt-3 text-sm text-stone-600">
            {BUILDING_TYPES.find((b) => b.key === data.exclusive_vertical)?.[lang] ?? data.exclusive_vertical}
          </p>
        )}
        <button onClick={saveFilters} disabled={saving}
          className="mt-4 rounded-md bg-emerald-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {t("dash_save")}
        </button>
      </section>

      <section className="mt-6 rounded-lg border border-stone-200 bg-white p-5">
        <h2 className="font-semibold">{t("dash_digests")}</h2>
        <ul className="mt-3 space-y-1 text-sm text-stone-700">
          {data.recent_digests.length === 0 && <li className="text-stone-400">—</li>}
          {data.recent_digests.map((d) => (
            <li key={d.sent_at}>
              {d.sent_at.slice(0, 10)} · {d.lead_count} leads · {d.status}
            </li>
          ))}
        </ul>
        {data.csv_export_enabled === 1 && (
          <a href={`${API_BASE}/api/leads.csv`} className="mt-3 inline-block text-sm text-emerald-900 underline">
            {t("dash_csv")}
          </a>
        )}
      </section>

      <section className="mt-6 flex flex-wrap gap-3">
        <button onClick={togglePause} className="rounded-md border border-stone-300 px-4 py-2 text-sm">
          {data.pause_digests === 1 ? t("dash_resume") : t("dash_pause")}
        </button>
        <button onClick={() => setConfirmCancel(true)} className="rounded-md border border-red-300 px-4 py-2 text-sm text-red-700">
          {t("dash_cancel")}
        </button>
      </section>

      {confirmCancel && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/40 p-4">
          <div className="max-w-sm rounded-lg bg-white p-6">
            <p className="text-sm">
              {data.status === "active" ? t("dash_cancel_confirm_active") : t("dash_cancel_confirm_other")}
            </p>
            <div className="mt-4 flex justify-end gap-3">
              <button onClick={() => setConfirmCancel(false)} className="rounded border border-stone-300 px-3 py-1.5 text-sm">
                ✕
              </button>
              <button onClick={doCancel} className="rounded bg-red-700 px-3 py-1.5 text-sm text-white">
                {t("dash_cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4">
      <div className="text-xl font-bold text-emerald-900">{value}</div>
      <div className="text-xs text-stone-500">{label}</div>
    </div>
  );
}
