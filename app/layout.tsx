import type { Metadata } from "next";
import { Barlow, Barlow_Semi_Condensed } from "next/font/google";
import "./globals.css";

const barlow = Barlow({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-barlow" });
const barlowSemi = Barlow_Semi_Condensed({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-barlow-semi" });

export const metadata: Metadata = {
  title: "AI Podcast Studio",
  description: "Turn a topic, article or notes into a multi-host podcast episode with AI scripts and AI voices.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${barlow.variable} ${barlowSemi.variable}`}>
      <body className="min-h-screen font-sans text-[15px] antialiased">{children}</body>
    </html>
  );
}
