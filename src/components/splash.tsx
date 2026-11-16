"use client";

import { useEffect, useState } from "react";
import SandClock from "@/components/sand-clock";

/**
 * First open of the site in a tab: a full-screen sand clock drains and flips,
 * then glides into the header logo slot ([data-dh-logo]) and the page appears.
 * Later navigations skip it (sessionStorage + a class set before paint).
 */
export default function Splash() {
  const [phase, setPhase] = useState<"show" | "fly" | "gone">("show");
  const [pos, setPos] = useState<{ left: number; top: number; scale: number } | null>(null);

  useEffect(() => {
    if (document.documentElement.classList.contains("dh-seen")) { setPhase("gone"); return; }
    try { sessionStorage.setItem("dh-splash", "1"); } catch {}
    const BIG = 120;
    // start centred
    setPos({ left: window.innerWidth / 2 - BIG / 2, top: window.innerHeight / 2 - BIG * 0.7 - 30, scale: 1 });
    const t1 = setTimeout(() => {
      const logo = Array.from(document.querySelectorAll<HTMLElement>("[data-dh-logo]")).find(el => el.getBoundingClientRect().width > 0);
      if (logo) {
        const r = logo.getBoundingClientRect();
        const scale = r.height / (BIG * 1.4);
        setPos({ left: r.left + r.width / 2 - BIG / 2, top: r.top + r.height / 2 - (BIG * 1.4) / 2, scale });
      }
      setPhase("fly");
    }, 2250);
    const t2 = setTimeout(() => setPhase("gone"), 2250 + 800);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  if (phase === "gone") return null;
  return (
    <div id="dh-splash" className={phase === "fly" ? "leaving" : ""} aria-hidden>
      <div className="dh-mark" style={pos ? { left: pos.left, top: pos.top, transform: `scale(${pos.scale})`, transformOrigin: "50% 50%" } : { left: "50%", top: "40%", transform: "translate(-50%,-50%)" }}>
        <SandClock mode="loader" size={120} tone="ink" />
        <div className="dh-word" style={{ opacity: phase === "fly" ? 0 : 1 }}>DAEMON HOUR<small>MAD CLUB · NHCE</small></div>
      </div>
    </div>
  );
}
