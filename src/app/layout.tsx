import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DAEMON HOUR | Auction Management",
  description: "Premium auction and team management workspace."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
