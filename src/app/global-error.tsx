"use client";

import { useEffect } from "react";

/** Last-resort screen: reload the page by itself after a short pause. */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error("App error:", error);
    const t = setTimeout(() => window.location.reload(), 4000 + Math.random() * 3000);
    return () => clearTimeout(t);
  }, [error]);
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#ECEEFF", fontFamily: "Inter, system-ui, sans-serif", color: "#0E0B2B", textAlign: "center" }}>
        <div>
          <p style={{ fontSize: 12, letterSpacing: ".3em", textTransform: "uppercase", color: "#6B4BFF", fontWeight: 700 }}>Daemon Hour</p>
          <h1 style={{ fontSize: 28, margin: "10px 0" }}>Reconnecting…</h1>
          <p style={{ color: "#5A5590" }}>The page will reload by itself in a few seconds.</p>
          <button onClick={() => window.location.reload()} style={{ marginTop: 16, padding: "10px 18px", border: "1.5px solid #0E0B2B", background: "#fff", fontWeight: 700, cursor: "pointer" }}>Reload now</button>
        </div>
      </body>
    </html>
  );
}
