import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AuditWave HK — 香港能源審核期限情報 | Energy-audit deadline intelligence",
  description:
    "每幢香港建築物的法定能源審核期限，每週送達。Hong Kong statutory energy-audit deadline leads for REA firms, delivered weekly.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant-HK">
      <body className="bg-stone-50 text-stone-900 antialiased">{children}</body>
    </html>
  );
}
