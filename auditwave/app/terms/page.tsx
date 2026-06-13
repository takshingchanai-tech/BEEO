import Link from "next/link";

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 text-sm leading-relaxed text-stone-700">
      <Link href="/" className="font-bold text-emerald-950">AuditWave HK</Link>
      <h1 className="mt-8 text-2xl font-bold text-emerald-950">Terms of Service 服務條款</h1>
      <p className="mt-2 text-stone-400">Last updated: 12 June 2026</p>

      <h2 className="mt-8 font-bold">1. The service 服務內容</h2>
      <p className="mt-2">AuditWave provides information about statutory energy-audit deadlines for Hong Kong buildings, compiled from public registers and computed under our reading of the Buildings Energy Efficiency Ordinance (Cap. 610) and its amendments. AuditWave 提供根據公開紀錄及《建築物能源效益條例》編算的香港建築物法定能源審核期限資訊。</p>

      <h2 className="mt-6 font-bold">2. Not legal advice 並非法律意見</h2>
      <p className="mt-2">Deadlines and classifications are computed estimates provided for business-intelligence purposes only. They are not legal advice. Verify against official EMSD records before acting or advising clients. 期限及分類為估算資訊，並非法律意見。採取行動或向客戶提供意見前，請以機電工程署官方紀錄為準。</p>

      <h2 className="mt-6 font-bold">3. Subscriptions & cancellation 訂閱及取消</h2>
      <p className="mt-2">Plans are billed monthly in HKD via Stripe. New accounts include a 14-day free trial (one per company/email). Active subscriptions may be cancelled at any time and run to the end of the paid period; trial accounts cancel immediately. 方案以港幣按月經 Stripe 收費。新帳戶享 14 天免費試用（每公司／電郵一次）。活躍訂閱隨時可取消並於付款週期結束時停止；試用帳戶即時取消。</p>

      <h2 className="mt-6 font-bold">4. Acceptable use 合理使用</h2>
      <p className="mt-2">Digest content and exports are licensed to the subscribing firm for its own business development. Resale or redistribution of the data feed is not permitted. 摘要內容及匯出資料授權訂閱公司作自身業務發展之用，不得轉售或再分發。</p>

      <h2 className="mt-6 font-bold">5. Liability 責任限制</h2>
      <p className="mt-2">To the maximum extent permitted by law, our liability is limited to the subscription fees paid in the preceding three months. 在法律允許的最大範圍內，我們的責任以前三個月已付訂閱費為限。</p>

      <h2 className="mt-6 font-bold">6. Contact 聯絡</h2>
      <p className="mt-2">hello@auditwavehk.com</p>
    </main>
  );
}
