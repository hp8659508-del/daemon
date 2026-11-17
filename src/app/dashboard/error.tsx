"use client";

import { useEffect, useState } from "react";

/**
 * If loading the dashboard fails (e.g. the database is busy for a moment under load),
 * show a calm "reconnecting" screen and retry by itself, instead of crashing the app.
 */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [tries, setTries] = useState(0);
  useEffect(() => {
    console.error("Dashboard load failed:", error);
    const wait = Math.min(15000, 2000 * 2 ** tries) + Math.random() * 2000;
    const t = setTimeout(() => { setTries(n => n + 1); reset(); }, wait);
    return () => clearTimeout(t);
  }, [tries, error, reset]);
  return (
    <section className="panel mx-auto mt-10 grid max-w-lg place-items-center p-10 text-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#ECEEFF] border-t-[#6B4BFF]" />
      <p className="eyebrow mt-6">Reconnecting</p>
      <h1 className="font-display mt-2 text-3xl">One moment…</h1>
      <p className="mt-3 text-sm text-muted">Lots of teams are online right now. This screen will come back by itself. You don&apos;t need to refresh.</p>
      <button className="key mt-6" onClick={() => { setTries(0); reset(); }}>Try now</button>
    </section>
  );
}
