"use client";

import { useEffect, useRef, useState } from "react";
import { SandEngine, type SandPalette } from "@/lib/sand-engine";

/**
 * Daemon Hour sand clock (React wrapper around SandEngine).
 *
 *  mode="timer"  : sand level = `fill` (share of the team's time left), grains fall while `running`.
 *                  When fill jumps UP (time was added) the glass flips once.
 *  mode="loader" : drains, flips 180°, repeats (loading screens).
 *  mode="idle"   : full and still (clock not started).
 *
 *  tone="glass"  : radiant poster sand with glow, for dark glass panels.
 *  tone="violet" / "ink" : club violet, for light surfaces (logo, bingo centre).
 */
export type SandTone = "violet" | "glass" | "ink";

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * t * (t * (t * 6 - 15) + 10));

export default function SandClock({
  fill = 1, mode = "timer", running = true, size = 96, tone = "violet", className = "", title, particles, drainMs = 1900,
}: { fill?: number; mode?: "timer" | "loader" | "idle"; running?: boolean; size?: number; tone?: SandTone; className?: string; title?: string; particles?: boolean; drainMs?: number }) {
  const host = useRef<HTMLSpanElement>(null);
  const state = useRef({ fill, running, mode, flipAt: -1e9, drainMs });
  state.current.drainMs = drainMs; state.current.fill = fill; state.current.running = running; state.current.mode = mode;

  // time added → one flip
  const prev = useRef(fill);
  useEffect(() => {
    if (mode === "timer" && fill > prev.current + 0.004) state.current.flipAt = performance.now();
    prev.current = fill;
  }, [fill, mode]);

  useEffect(() => {
    const palette: SandPalette = tone === "glass" ? "radiant" : "violet";
    const e = new SandEngine({ size, palette, glow: tone === "glass", particles: particles ?? size >= 40, rate: size >= 80 ? 100 : 60 });
    host.current?.replaceChildren(e.el);
    let raf = 0, last = performance.now(); const t0 = last;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // Battery: phones run this all day. Big glasses draw at ~30 fps, small ones (logo) at ~15 fps,
    // weak phones lower still, and nothing is drawn while the glass is off-screen.
    const weak = (navigator.hardwareConcurrency ?? 8) <= 4;
    const frameMs = (size >= 80 ? 33 : 66) * (weak ? 1.5 : 1);
    let visible = true;
    const io = typeof IntersectionObserver !== "undefined" && host.current
      ? new IntersectionObserver(([en]) => { visible = !!en?.isIntersecting; }, { rootMargin: "50px" }) : null;
    if (io && host.current) io.observe(host.current);
    const tick = (now: number) => {
      if (!visible || now - last < frameMs) { raf = requestAnimationFrame(tick); return; }
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      const s = state.current;
      if (s.mode === "loader") {
        // constant-rate drain (real sand flows at a steady rate), then a flip that hands over
        // seamlessly at horizontal, so pouring resumes with no pause
        const DRAIN = state.current.drainMs, t = (now - t0) % (DRAIN + 700 + Math.min(800, DRAIN * .06));
        const FLIP = 700 + Math.min(800, DRAIN * .06);
        if (t < DRAIN) { e.set(1 - t / DRAIN, true); e.rotate(0); }
        else { const p = smooth((t - DRAIN) / FLIP), r = 180 * p; if (r < 90) { e.set(0, false); e.rotate(r); } else { e.set(1, r > 165); e.rotate(r - 180); } }
      } else if (s.mode === "idle") { e.set(1, false); e.rotate(0); }
      else {
        e.set(s.fill, s.running);
        const fp = (now - s.flipAt) / 800;
        e.rotate(fp >= 0 && fp < 1 ? 360 * smooth(fp) : 0);
      }
      e.step(reduce ? 0 : dt);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); io?.disconnect(); };
  }, [size, tone, particles]);

  return <span ref={host} className={className} role="img" aria-label={title ?? "Sand clock"} style={{ display: "inline-block", width: size, height: size * 170 / 120, lineHeight: 0 }} />;
}

/* ---------- global sync: every hourglass on the page shows the same time-left ---------- */
type Sand = { fill: number; running: boolean };
declare global { interface Window { __dhSand?: Sand } }

export function useBroadcastSand(fill: number, running: boolean) {
  useEffect(() => {
    const detail = { fill, running };
    window.__dhSand = detail;
    window.dispatchEvent(new CustomEvent("dh-sand", { detail }));
  }, [fill, running]);
}
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
export function SyncedSand({ size = 26, logo = false, tone = "violet" }: { size?: number; logo?: boolean; tone?: SandTone }) {
  const s = useSand();
  return (
    <span {...(logo ? { "data-dh-logo": "" } : {})} className="inline-grid place-items-center" style={{ width: size * 1.05, height: size * 1.45 }}>
      <SandClock size={size} tone={tone} mode={s ? "timer" : "idle"} fill={s?.fill ?? 1} running={s?.running ?? false} title="Daemon Hour" particles={size >= 30} />
    </span>
  );
}
