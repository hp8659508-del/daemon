"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Daemon Hour sand clock — flat, two caps, faint glass, bright sand.
 *
 *  mode="timer"  : sand level = `fill` (share of the team's time left), stream runs while `running`.
 *                  Whenever fill jumps UP (time was added), the glass does a quick flip.
 *  mode="loader" : drains, flips 180°, repeats (page loading / splash).
 *  mode="idle"   : full and still (clock not started yet).
 *
 * Geometry is area-correct: the bulbs are close to triangles, so the sand
 * height uses a square-root curve and "50 % left" really looks half full.
 */
/** Surface height in the top bulb for each 5 % of sand left, integrated from the glass curve (area-exact). */
const TOP_Y = [70.0, 60.5, 55.6, 52.0, 49.0, 46.2, 43.8, 41.5, 39.4, 37.4, 35.4, 33.5, 31.7, 29.9, 28.1, 26.4, 24.7, 23.0, 21.4, 19.6, 18.0];
function levelFor(f: number) {
  const x = Math.max(0, Math.min(1, f)) * 20, i = Math.min(19, Math.floor(x)), t = x - i;
  return TOP_Y[i] + (TOP_Y[i + 1] - TOP_Y[i]) * t;
}

export type SandTone = "violet" | "glass" | "ink";
const TONES: Record<SandTone, { sandTop: string; sandBot: string; cap: string; glass: string; glassStroke: string; stream: string }> = {
  violet: { sandTop: "#9D85FF", sandBot: "#6B4BFF", cap: "#0E0B2B", glass: "rgba(107,75,255,.07)", glassStroke: "rgba(14,11,43,.28)", stream: "#7E62FF" },
  glass:  { sandTop: "#E2D9FF", sandBot: "#B9A6FF", cap: "#D6CCFF", glass: "rgba(214,204,255,.06)", glassStroke: "rgba(214,204,255,.35)", stream: "#D6CCFF" },
  ink:    { sandTop: "#6B4BFF", sandBot: "#4B2FE0", cap: "#0E0B2B", glass: "rgba(14,11,43,.05)", glassStroke: "rgba(14,11,43,.35)", stream: "#6B4BFF" },
};

export default function SandClock({
  fill = 1, mode = "timer", running = true, size = 96, tone = "violet", className = "", title,
}: { fill?: number; mode?: "timer" | "loader" | "idle"; running?: boolean; size?: number; tone?: SandTone; className?: string; title?: string }) {
  const uid = useId().replace(/:/g, "");
  const c = TONES[tone];

  // ----- loader cycle: 0..1.6 s drain, 1.6..2.25 s flip -----
  const [lf, setLf] = useState(1);
  const [rot, setRot] = useState(0);
  useEffect(() => {
    if (mode !== "loader") return;
    let raf = 0; const start = performance.now(); const DRAIN = 1600, FLIP = 650, CYCLE = DRAIN + FLIP;
    const ease = (t: number) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const tick = (now: number) => {
      const t = (now - start) % CYCLE;
      if (t < DRAIN) { setLf(1 - t / DRAIN); setRot(0); }
      else { setLf(0); setRot(180 * ease((t - DRAIN) / FLIP)); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode]);

  // ----- timer: flip when time is added -----
  const prev = useRef(fill);
  const [flipping, setFlipping] = useState(false);
  useEffect(() => {
    if (mode === "timer" && fill > prev.current + 0.004) { setFlipping(true); const t = setTimeout(() => setFlipping(false), 750); prev.current = fill; return () => clearTimeout(t); }
    prev.current = fill;
  }, [fill, mode]);

  const f = Math.max(0, Math.min(1, mode === "loader" ? lf : mode === "idle" ? 1 : fill));
  const flowing = mode === "loader" ? lf > 0.01 && lf < 0.99 : mode === "timer" && running && f > 0.002 && f < 0.999;

  // bulbs: top y 18..70, bottom 70..122, neck at y 70. Levels come from the bulb's real area.
  const NECK = 70;
  const topY = levelFor(f);                         // flat surface in the top bulb
  const baseY = 122, pileY = 140 - topY;            // the bottom bulb is a mirror: same sand, mirrored level
  const pileH = baseY - pileY;
  const mound = Math.min(6, pileH * 0.4);           // a soft cone on the pile
  const glassPath = "M22 18 L78 18 C78 42 57 57 52.5 70 C57 83 78 98 78 122 L22 122 C22 98 43 83 47.5 70 C43 57 22 42 22 18 Z";

  return (
    <svg width={size} height={size * 1.4} viewBox="0 0 100 140" className={className} role="img" aria-label={title ?? "Sand clock"}
      style={{ overflow: "visible" }}>
      <defs>
        <clipPath id={`g-${uid}`}><path d={glassPath} /></clipPath>
        <linearGradient id={`s-${uid}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={c.sandTop} /><stop offset="1" stopColor={c.sandBot} /></linearGradient>
      </defs>
      <g style={{ transformOrigin: "50px 70px", transform: `rotate(${mode === "loader" ? rot : 0}deg)`, transition: mode === "timer" ? "transform .7s cubic-bezier(.65,0,.35,1)" : undefined }}
         className={flipping ? "sand-flip" : undefined}>
        <path d={glassPath} fill={c.glass} stroke={c.glassStroke} strokeWidth="1.6" />
        <g clipPath={`url(#g-${uid})`}>
          {/* top sand */}
          {f > 0.001 && <rect x="0" y={topY} width="100" height={NECK - topY + 0.5} fill={`url(#s-${uid})`} />}
          {/* bottom pile with a soft mound */}
          {pileH > 0.3 && <path d={`M0 ${baseY + 2} L0 ${pileY + mound} Q50 ${pileY - mound} 100 ${pileY + mound} L100 ${baseY + 2} Z`} fill={`url(#s-${uid})`} />}
          {/* falling stream */}
          {flowing && (
            <line x1="50" x2="50" y1={NECK - 1} y2={pileY} stroke={c.stream} strokeWidth="1.7" strokeDasharray="3 2.5" className="sand-stream" />
          )}
        </g>
        {/* caps */}
        <rect x="12" y="8" width="76" height="9" rx="4.5" fill={c.cap} />
        <rect x="12" y="123" width="76" height="9" rx="4.5" fill={c.cap} />
      </g>
    </svg>
  );
}

/* ---------- global sync: every hourglass on the page shows the same time-left ---------- */
type Sand = { fill: number; running: boolean };
declare global { interface Window { __dhSand?: Sand } }

/** Call from the screen that owns the clock (team arena / control room). */
export function useBroadcastSand(fill: number, running: boolean) {
  useEffect(() => {
    const detail = { fill, running };
    window.__dhSand = detail;
    window.dispatchEvent(new CustomEvent("dh-sand", { detail }));
  }, [fill, running]);
}
/** Any hourglass (e.g. the header logo) can follow it. */
export function useSand(): Sand | null {
  const [s, setS] = useState<Sand | null>(null);
  useEffect(() => {
    if (window.__dhSand) setS(window.__dhSand);
    const on = (e: Event) => setS((e as CustomEvent<Sand>).detail);
    window.addEventListener("dh-sand", on);
    return () => window.removeEventListener("dh-sand", on);
  }, []);
  return s;
}

/** Any hourglass that should show the page's time-left (header logo, bingo centre…). */
export function SyncedSand({ size = 26, logo = false, tone = "ink" }: { size?: number; logo?: boolean; tone?: SandTone }) {
  const s = useSand();
  return (
    <span {...(logo ? { "data-dh-logo": "" } : {})} className="inline-grid place-items-center" style={{ width: size * 1.15, height: size * 1.4 }}>
      <SandClock size={size} tone={tone} mode={s ? "timer" : "idle"} fill={s?.fill ?? 1} running={s?.running ?? false} title="Daemon Hour" />
    </span>
  );
}
