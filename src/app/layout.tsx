import type { Metadata, Viewport } from "next";
import "./globals.css";
import Splash from "@/components/splash";

export const metadata: Metadata = {
  title: "DAEMON HOUR · MAD Club NHCE",
  description: "Bid it. Spin it. Bingo it. The DAEMON HOUR team console by the Mobile App Development Club, NHCE.",
};
export const viewport: Viewport = { themeColor: "#ECEEFF", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* skip the splash on later page loads in this tab, before first paint */}
        <script dangerouslySetInnerHTML={{ __html: "try{if(sessionStorage.getItem('dh-splash'))document.documentElement.classList.add('dh-seen')}catch(e){}" }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Inter+Tight:wght@500;600;700;800;900&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet" />
      </head>
      <body><Splash />{children}</body>
    </html>
  );
}
