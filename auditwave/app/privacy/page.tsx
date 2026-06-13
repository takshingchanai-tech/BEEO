import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 text-sm leading-relaxed text-stone-700">
      <Link href="/" className="font-bold text-emerald-950">AuditWave HK</Link>
      <h1 className="mt-8 text-2xl font-bold text-emerald-950">Privacy Policy 私隱政策</h1>
      <p className="mt-2 text-stone-400">Last updated: 12 June 2026</p>

      <h2 className="mt-8 font-bold">1. What we collect 我們收集甚麼</h2>
      <p className="mt-2">We collect the information you provide at signup: company name, contact name (optional) and email address, together with your selected filters and service-usage records (digests sent, leads delivered). 我們收集您登記時提供的公司名稱、聯絡人（可選）及電郵地址，以及您的篩選設定和服務使用紀錄。</p>

      <h2 className="mt-6 font-bold">2. How we use it 用途</h2>
      <p className="mt-2">Your data is used solely to deliver the AuditWave service: weekly digests, account emails, and billing through Stripe. We do not sell or share personal data with third parties for marketing. 資料僅用於提供 AuditWave 服務：每週摘要、帳戶電郵及透過 Stripe 處理付款。我們不會出售或與第三方分享個人資料作推廣用途。</p>

      <h2 className="mt-6 font-bold">3. Building data 建築物資料</h2>
      <p className="mt-2">Building and deadline information in our digests derives from public registers maintained by the Electrical and Mechanical Services Department (EMSD) and other open government data. 摘要中的建築物及期限資料來自機電工程署等政府公開紀錄。</p>

      <h2 className="mt-6 font-bold">4. Retention 保留期</h2>
      <p className="mt-2">Personal data of cancelled accounts is anonymised 90 days after cancellation. Invoice records are retained as required for accounting. 已取消帳戶的個人資料於取消後 90 日匿名化處理；發票紀錄按會計要求保留。</p>

      <h2 className="mt-6 font-bold">5. PDPO & contact 查詢</h2>
      <p className="mt-2">We handle personal data in accordance with the Personal Data (Privacy) Ordinance (Cap. 486). For access or correction requests, contact hello@auditwavehk.com. 我們按《個人資料（私隱）條例》處理個人資料。查閱或更正請電郵 hello@auditwavehk.com。</p>
    </main>
  );
}
