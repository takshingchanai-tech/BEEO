// All site copy lives here with {zh, en} keys (norgeconnect pattern).
// 繁體中文 is the default language for the HK market.

export const DISTRICTS: { key: string; zh: string; en: string }[] = [
  { key: "central_western", zh: "中西區", en: "Central & Western" },
  { key: "wan_chai", zh: "灣仔區", en: "Wan Chai" },
  { key: "eastern", zh: "東區", en: "Eastern" },
  { key: "southern", zh: "南區", en: "Southern" },
  { key: "yau_tsim_mong", zh: "油尖旺區", en: "Yau Tsim Mong" },
  { key: "sham_shui_po", zh: "深水埗區", en: "Sham Shui Po" },
  { key: "kowloon_city", zh: "九龍城區", en: "Kowloon City" },
  { key: "wong_tai_sin", zh: "黃大仙區", en: "Wong Tai Sin" },
  { key: "kwun_tong", zh: "觀塘區", en: "Kwun Tong" },
  { key: "kwai_tsing", zh: "葵青區", en: "Kwai Tsing" },
  { key: "tsuen_wan", zh: "荃灣區", en: "Tsuen Wan" },
  { key: "tuen_mun", zh: "屯門區", en: "Tuen Mun" },
  { key: "yuen_long", zh: "元朗區", en: "Yuen Long" },
  { key: "north", zh: "北區", en: "North" },
  { key: "tai_po", zh: "大埔區", en: "Tai Po" },
  { key: "sha_tin", zh: "沙田區", en: "Sha Tin" },
  { key: "sai_kung", zh: "西貢區", en: "Sai Kung" },
  { key: "islands", zh: "離島區", en: "Islands" },
];

export const BUILDING_TYPES: { key: string; zh: string; en: string }[] = [
  { key: "commercial_office", zh: "商業辦公樓", en: "Commercial office" },
  { key: "retail_mall", zh: "商場零售", en: "Retail / mall" },
  { key: "hotel", zh: "酒店", en: "Hotel" },
  { key: "composite_commercial", zh: "綜合用途（商住）", en: "Composite commercial" },
  { key: "educational", zh: "教育設施", en: "Educational" },
  { key: "hospital_healthcare", zh: "醫院及醫療", en: "Hospital / healthcare" },
  { key: "data_centre", zh: "數據中心", en: "Data centre" },
  { key: "airport_terminal", zh: "機場客運大樓", en: "Airport terminal" },
  { key: "government", zh: "政府建築物", en: "Government" },
  { key: "community_cultural", zh: "社區文化設施", en: "Community / cultural" },
  { key: "industrial", zh: "工業建築物", en: "Industrial" },
  { key: "transport_facility", zh: "運輸設施", en: "Transport facility" },
  { key: "residential_common_area", zh: "住宅公用地方", en: "Residential common areas" },
];

export const PLANS = [
  {
    key: "district",
    priceHkd: 2500,
    zh: { name: "分區方案", desc: "自選一至數個地區，每週期限線索摘要連雙語聯絡函稿" },
    en: { name: "District", desc: "Your chosen districts — weekly deadline pipeline with bilingual outreach memos" },
    features: {
      zh: ["自選地區篩選", "每週一線索摘要", "雙語聯絡函稿", "14 天免費試用"],
      en: ["District filters", "Weekly Monday digest", "Bilingual outreach memos", "14-day free trial"],
    },
  },
  {
    key: "territory",
    priceHkd: 5000,
    zh: { name: "全港方案", desc: "覆蓋全港十八區，建築物類別篩選，CSV 匯出" },
    en: { name: "Territory", desc: "All 18 districts, building-type filters, CSV export" },
    features: {
      zh: ["全港覆蓋", "建築物類別篩選", "CSV 匯出", "14 天免費試用"],
      en: ["Full territory coverage", "Building-type filters", "CSV export", "14-day free trial"],
    },
  },
  {
    key: "exclusive",
    priceHkd: 9000,
    zh: { name: "獨家類別方案", desc: "獨家擁有一個建築物類別（如數據中心）— 每類別只售一家" },
    en: { name: "Exclusive vertical", desc: "Exclusive rights to one building category (e.g. data centres) — one buyer per vertical" },
    features: {
      zh: ["全港覆蓋", "類別獨家（每類別限一家）", "CSV 匯出", "優先支援"],
      en: ["Full territory coverage", "Vertical exclusivity (one buyer max)", "CSV export", "Priority support"],
    },
  },
];

export const T = {
  nav_pricing: { zh: "收費", en: "Pricing" },
  nav_how: { zh: "運作方式", en: "How it works" },
  nav_login: { zh: "登入", en: "Log in" },
  nav_signup: { zh: "免費試用", en: "Start free trial" },

  hero_title: {
    zh: "每幢建築物的法定能源審核期限，先於同行掌握。",
    en: "Every building's statutory energy-audit deadline. Before your competitors see it.",
  },
  hero_sub: {
    zh: "《建築物能源效益（修訂）條例》於 2026 年 9 月 20 日生效：九類建築物新納入規管，審核週期由十年縮短至五年。AuditWave 每日追蹤機電工程署紀錄冊，計算每幢建築物的確實期限，逢星期一將合資格線索連雙語聯絡函稿送到您的收件箱。",
    en: "The Buildings Energy Efficiency (Amendment) Ordinance takes effect on 20 September 2026: nine new building types enter the regime and the audit interval halves from 10 to 5 years. AuditWave tracks the EMSD register daily, computes every building's exact deadline, and delivers qualified leads with bilingual outreach memos to your inbox every Monday.",
  },
  hero_cta: { zh: "開始 14 天免費試用", en: "Start your 14-day free trial" },
  hero_note: { zh: "毋須信用卡 · 隨時取消", en: "No card required · cancel anytime" },

  stat_buildings: { zh: "幢建築物受監測", en: "buildings tracked" },
  stat_due: { zh: "幢於 18 個月內到期", en: "due within 18 months" },
  stat_accel: { zh: "幢期限因修訂條例提前", en: "deadlines accelerated by the Amendment" },

  how_title: { zh: "運作方式", en: "How it works" },
  how_steps: {
    zh: [
      ["每日追蹤官方紀錄冊", "系統每日讀取機電工程署能源審核表格紀錄冊，偵測新發表格、續期及變動。"],
      ["計算法定期限", "根據《修訂條例》的五年週期及過渡安排，計算每幢建築物下次審核的確實限期及適用守則版本。"],
      ["AI 分類及函稿", "AI 將建築物歸入條例附表類別，並為每個線索草擬中英雙語聯絡函稿。"],
      ["逢星期一送達", "按您選擇的地區及類別篩選，每週一將新線索摘要送到您的收件箱。"],
    ],
    en: [
      ["Daily register tracking", "We read the EMSD Energy Audit Form register every day, detecting new forms, renewals and changes."],
      ["Statutory deadline computation", "Each building's exact next-audit deadline and governing code edition, computed under the Amendment's 5-year regime and transitional rules."],
      ["AI classification & memos", "Buildings are classified into Schedule categories, and a bilingual outreach memo is drafted for every lead."],
      ["Delivered every Monday", "Filtered to your chosen districts and building types, the weekly digest lands in your inbox."],
    ],
  },

  pricing_title: { zh: "收費（月費，港幣）", en: "Pricing (monthly, HKD)" },
  pricing_choose: { zh: "選擇此方案", en: "Choose this plan" },

  faq_title: { zh: "常見問題", en: "FAQ" },
  faq: {
    zh: [
      ["資料來源是甚麼？", "機電工程署的公開能源審核表格紀錄冊及法定文件。期限為本服務根據條例計算之估算，採取行動前請以官方紀錄為準。"],
      ["試用包括甚麼？", "14 天免費試用包含完整功能：每週線索摘要、雙語函稿。毋須信用卡。"],
      ["可以隨時取消嗎？", "可以。活躍訂閱於付款週期結束時停止；試用期內取消即時生效。"],
      ["獨家類別如何運作？", "每個建築物類別（例如數據中心）只售予一家公司。該類別的所有線索只供您一家接收。"],
    ],
    en: [
      ["What is the data source?", "The EMSD's public register of Energy Audit Forms and statutory instruments. Deadlines are our computed estimates under the Ordinance — verify against official records before acting."],
      ["What does the trial include?", "The 14-day free trial is full-featured: weekly digests and bilingual memos. No card required."],
      ["Can I cancel anytime?", "Yes. Active subscriptions run to the end of the paid period; trial cancellations are immediate."],
      ["How does the exclusive vertical work?", "Each building category (e.g. data centres) is sold to one firm only. Every lead in that vertical goes to you alone."],
    ],
  },

  signup_title: { zh: "開始免費試用", en: "Start your free trial" },
  signup_company: { zh: "公司名稱", en: "Company name" },
  signup_contact: { zh: "聯絡人（可選）", en: "Contact name (optional)" },
  signup_email: { zh: "電郵地址", en: "Email address" },
  signup_tier: { zh: "方案", en: "Plan" },
  signup_districts: { zh: "選擇地區", en: "Select districts" },
  signup_types: { zh: "建築物類別（可選，不選即全部）", en: "Building types (optional — empty means all)" },
  signup_vertical: { zh: "獨家類別", en: "Exclusive vertical" },
  signup_submit: { zh: "建立帳戶", en: "Create account" },
  signup_success: {
    zh: "帳戶已建立！歡迎電郵已發送（如未見請查垃圾郵件箱）。首份線索摘要將於下星期一送達。",
    en: "Account created! A welcome email is on its way (check spam if missing). Your first digest arrives next Monday.",
  },

  dash_title: { zh: "儀表板", en: "Dashboard" },
  dash_leads: { zh: "已收線索", en: "Leads delivered" },
  dash_trial_left: { zh: "試用剩餘日數", en: "Trial days left" },
  dash_plan: { zh: "方案", en: "Plan" },
  dash_status: { zh: "狀態", en: "Status" },
  dash_digests: { zh: "最近摘要", en: "Recent digests" },
  dash_filters: { zh: "篩選設定", en: "Filters" },
  dash_save: { zh: "儲存", en: "Save" },
  dash_pause: { zh: "暫停摘要", en: "Pause digests" },
  dash_resume: { zh: "恢復摘要", en: "Resume digests" },
  dash_csv: { zh: "匯出 CSV", en: "Export CSV" },
  dash_cancel: { zh: "取消訂閱", en: "Cancel subscription" },
  dash_cancel_confirm_active: {
    zh: "確認取消？服務將持續至本付款週期結束。",
    en: "Confirm cancellation? Service continues until the end of the current billing period.",
  },
  dash_cancel_confirm_other: {
    zh: "確認取消？帳戶將即時取消。",
    en: "Confirm cancellation? Your account will be cancelled immediately.",
  },

  login_title: { zh: "登入", en: "Log in" },
  login_desc: { zh: "輸入登記電郵，我們會發送登入連結。", en: "Enter your registered email and we'll send a login link." },
  login_send: { zh: "發送登入連結", en: "Send login link" },
  login_sent: { zh: "如該電郵已登記，登入連結已發出。", en: "If that email is registered, a login link is on its way." },

  footer_disclaimer: {
    zh: "AuditWave 為資訊服務，並非法律意見。資料來源：機電工程署公開紀錄冊。",
    en: "AuditWave is an intelligence service, not legal advice. Source: public EMSD registers.",
  },
} as const;
