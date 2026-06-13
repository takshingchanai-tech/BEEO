"use client";

import Link from "next/link";
import { useLang } from "../lib/useLang";
import { T, PLANS } from "../lib/content";

export default function HomePage() {
  const [lang, setLang] = useLang();
  const t = <K extends keyof typeof T>(k: K) => (T[k] as Record<string, unknown>)[lang] as string;

  return (
    <main>
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <div className="text-xl font-bold text-emerald-950">AuditWave HK</div>
          <nav className="flex items-center gap-4 text-sm">
            <a href="#how" className="hidden text-stone-600 hover:text-stone-900 sm:block">{t("nav_how")}</a>
            <a href="#pricing" className="hidden text-stone-600 hover:text-stone-900 sm:block">{t("nav_pricing")}</a>
            <Link href="/reconnect" className="text-stone-600 hover:text-stone-900">{t("nav_login")}</Link>
            <button
              onClick={() => setLang(lang === "zh" ? "en" : "zh")}
              className="rounded border border-stone-300 px-2 py-1 text-xs"
            >
              {lang === "zh" ? "EN" : "中"}
            </button>
            <Link href="/signup" className="rounded-md bg-emerald-900 px-3 py-2 text-white hover:bg-emerald-800">
              {t("nav_signup")}
            </Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-4 py-16 text-center">
        <h1 className="mx-auto max-w-3xl text-3xl font-bold leading-tight text-emerald-950 sm:text-4xl">
          {t("hero_title")}
        </h1>
        <p className="mx-auto mt-6 max-w-3xl text-stone-600">{t("hero_sub")}</p>
        <Link
          href="/signup"
          className="mt-8 inline-block rounded-md bg-emerald-900 px-6 py-3 font-semibold text-white hover:bg-emerald-800"
        >
          {t("hero_cta")}
        </Link>
        <p className="mt-3 text-sm text-stone-500">{t("hero_note")}</p>

        <div className="mx-auto mt-12 grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            ["2,500+", t("stat_buildings")],
            ["1,000+", t("stat_due")],
            ["1,900+", t("stat_accel")],
          ].map(([n, label]) => (
            <div key={label} className="rounded-lg border border-stone-200 bg-white p-6">
              <div className="text-3xl font-bold text-emerald-900">{n}</div>
              <div className="mt-1 text-sm text-stone-600">{label}</div>
            </div>
          ))}
        </div>
      </section>

      <section id="how" className="bg-white py-16">
        <div className="mx-auto max-w-5xl px-4">
          <h2 className="text-center text-2xl font-bold text-emerald-950">{t("how_title")}</h2>
          <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {T.how_steps[lang].map(([title, desc], i) => (
              <div key={title} className="rounded-lg border border-stone-200 p-5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-900 font-bold text-white">
                  {i + 1}
                </div>
                <h3 className="mt-3 font-semibold">{title}</h3>
                <p className="mt-2 text-sm text-stone-600">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="py-16">
        <div className="mx-auto max-w-5xl px-4">
          <h2 className="text-center text-2xl font-bold text-emerald-950">{t("pricing_title")}</h2>
          <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-3">
            {PLANS.map((p) => (
              <div key={p.key} className="flex flex-col rounded-lg border border-stone-200 bg-white p-6">
                <h3 className="text-lg font-bold">{p[lang].name}</h3>
                <div className="mt-2 text-3xl font-bold text-emerald-900">
                  HK${p.priceHkd.toLocaleString()}
                  <span className="text-base font-normal text-stone-500">/{lang === "zh" ? "月" : "mo"}</span>
                </div>
                <p className="mt-2 text-sm text-stone-600">{p[lang].desc}</p>
                <ul className="mt-4 flex-1 space-y-2 text-sm">
                  {p.features[lang].map((f) => (
                    <li key={f} className="flex gap-2">
                      <span className="text-emerald-700">✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  href={`/signup?tier=${p.key}`}
                  className="mt-6 rounded-md border border-emerald-900 px-4 py-2 text-center font-semibold text-emerald-900 hover:bg-emerald-900 hover:text-white"
                >
                  {t("pricing_choose")}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white py-16">
        <div className="mx-auto max-w-3xl px-4">
          <h2 className="text-center text-2xl font-bold text-emerald-950">{t("faq_title")}</h2>
          <div className="mt-8 space-y-4">
            {T.faq[lang].map(([q, a]) => (
              <details key={q} className="rounded-lg border border-stone-200 p-4">
                <summary className="cursor-pointer font-semibold">{q}</summary>
                <p className="mt-2 text-sm text-stone-600">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-stone-200 py-8 text-center text-xs text-stone-500">
        <p>{t("footer_disclaimer")}</p>
        <p className="mt-2">
          <Link href="/privacy" className="underline">Privacy 私隱政策</Link>
          {" · "}
          <Link href="/terms" className="underline">Terms 服務條款</Link>
        </p>
        <p className="mt-2">© {new Date().getFullYear()} AuditWave HK</p>
      </footer>
    </main>
  );
}
