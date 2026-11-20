"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Full-screen winner celebration. Plays every time a winning team opens (or refreshes) its
 * dashboard after the organisers announce the winners, then fades away by itself.
 * Confetti + fireworks fire in from all four corners; 1st place gets the gold treatment.
 */
const CFG = {
  1: { m: "#f5c542", gold: true, kicker: "Daemon Hour · Champions", title: "You won Daemon Hour!", dur: 12000, power: 1.6,
       msg: "1st place. You out-bid, out-spun and out-built every team in the room. The trophy is yours: congratulations from all of MAD Club NHCE." },
  2: { m: "#d6dcea", gold: false, kicker: "Daemon Hour · Runners-up", title: "You placed 2nd!", dur: 9000, power: 1,
       msg: "Second place overall. A brilliant run from start to finish: congratulations from all of MAD Club NHCE." },
  3: { m: "#d08a52", gold: false, kicker: "Daemon Hour · Third place", title: "You placed 3rd!", dur: 9000, power: 1,
       msg: "Third place overall. You earned your spot on the podium: congratulations from all of MAD Club NHCE." },
} as const;
const COLORS = ["#ffffff", "#2f7bf5", "#7aa7ff", "#ff6b8b", "#4cd9a8", "#c18bff", "#ffd27a"];

type P = { x: number; y: number; vx: number; vy: number; life: number; max: number; c: string; r?: number; w?: number; h?: number; rot?: number; vr?: number; spark: boolean };
type R = { x: number; y: number; vx: number; vy: number; life: number; c: string; big?: boolean };

export default function WinnerOverlay({ place, team }: { place: 1 | 2 | 3; team: string }) {
  const c = CFG[place];
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const cv = useRef<HTMLCanvasElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => { setMounted(true); const t = setTimeout(() => setOpen(true), 60); return () => clearTimeout(t); }, []);
  useEffect(() => {
    if (!open) return;
    btn.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    addEventListener("keydown", onKey);
    const t = setTimeout(close, c.dur);
    return () => { clearTimeout(t); removeEventListener("keydown", onKey); };
  }, [open, c.dur, close]);

  // fireworks engine
  useEffect(() => {
    if (!open || !cv.current || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = cv.current, cx = canvas.getContext("2d")!;
    let W = 0, H = 0, raf = 0, dead = false;
    const parts: P[] = [], rockets: R[] = [], timers: ReturnType<typeof setTimeout>[] = [];
    const palette = [c.m, c.m, ...COLORS];
    const size = () => { const d = Math.min(devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight; canvas.width = W * d; canvas.height = H * d; cx.setTransform(d, 0, 0, d, 0, 0); };
    size(); addEventListener("resize", size);
    const rnd = (a: number, b: number) => a + Math.random() * (b - a), pick = <T,>(a: T[]) => a[(Math.random() * a.length) | 0];
    const rocket = (k: number, big = false) => {
      const L = k === 0 || k === 2, T = k < 2, x = L ? 0 : W, y = T ? 0 : H;
      const tx = W * (L ? rnd(.15, .45) : rnd(.55, .85)), ty = H * (T ? rnd(.18, .4) : rnd(.25, .55)), t = rnd(40, 58);
      rockets.push({ x, y, vx: (tx - x) / t, vy: (ty - y) / t, life: t, c: pick(palette), big });
    };
    const burst = (x: number, y: number, col: string, big?: boolean) => {
      const n = (big ? 120 : 75) + ((Math.random() * 40) | 0), c2 = pick(palette);
      for (let i = 0; i < n; i++) { const a = i / n * 6.283 + rnd(-.05, .05), s = rnd(1.6, big ? 6.4 : 5);
        parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(55, 95), max: 95, c: Math.random() < .7 ? col : c2, r: rnd(1.2, 2.5), spark: true }); }
    };
    const confetti = (k: number, n: number) => {
      const L = k === 0 || k === 2, T = k < 2;
      for (let i = 0; i < n; i++) { const a = (L ? 0 : Math.PI) + (T ? 1 : -1) * (L ? 1 : -1) * rnd(.25, 1.15), s = rnd(7, 15);
        parts.push({ x: L ? 0 : W, y: T ? 0 : H, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(150, 230), max: 230, c: pick(palette), w: rnd(6, 11), h: rnd(3, 6), rot: rnd(0, 6.3), vr: rnd(-.25, .25), spark: false }); }
    };
    const tick = () => {
      if (dead) return;
      cx.clearRect(0, 0, W, H);
      for (let i = rockets.length - 1; i >= 0; i--) { const r = rockets[i]; r.x += r.vx; r.y += r.vy; r.life--;
        cx.globalCompositeOperation = "lighter"; cx.fillStyle = r.c; cx.beginPath(); cx.arc(r.x, r.y, 2.4, 0, 7); cx.fill();
        cx.globalAlpha = .35; cx.strokeStyle = r.c; cx.beginPath(); cx.moveTo(r.x, r.y); cx.lineTo(r.x - r.vx * 6, r.y - r.vy * 6); cx.stroke(); cx.globalAlpha = 1;
        if (r.life <= 0) { burst(r.x, r.y, r.c, r.big); rockets.splice(i, 1); } }
      for (let i = parts.length - 1; i >= 0; i--) { const p = parts[i]; p.life--;
        if (p.spark) { p.vx *= .965; p.vy = p.vy * .965 + .045; } else { p.vx *= .985; p.vy = p.vy * .985 + .16; p.rot! += p.vr!; }
        p.x += p.vx; p.y += p.vy; cx.globalAlpha = Math.max(0, Math.min(1, p.life / (p.max * .45))); cx.fillStyle = p.c;
        if (p.spark) { cx.globalCompositeOperation = "lighter"; cx.beginPath(); cx.arc(p.x, p.y, p.r!, 0, 7); cx.fill(); }
        else { cx.globalCompositeOperation = "source-over"; cx.save(); cx.translate(p.x, p.y); cx.rotate(p.rot!); cx.fillRect(-p.w! / 2, -p.h! / 2, p.w!, p.h! * Math.abs(Math.cos(p.rot! * 2)) + 1); cx.restore(); }
        if (p.life <= 0 || p.y > H + 40) parts.splice(i, 1); }
      cx.globalAlpha = 1;
      raf = parts.length || rockets.length ? requestAnimationFrame(tick) : 0;
    };
    const go = () => { if (!raf) raf = requestAnimationFrame(tick); };
    [0, 1, 2, 3].forEach((k, i) => timers.push(setTimeout(() => { confetti(k, Math.round(55 * c.power)); go(); }, 250 + i * 110)));
    const rounds = Math.round(12 * c.power);
    for (let k = 0; k < rounds; k++) timers.push(setTimeout(() => { rocket(k % 4, c.gold && k % 3 === 2); go(); }, 700 + k * Math.round(560 / c.power)));
    timers.push(setTimeout(() => { [0, 1, 2, 3].forEach(k => confetti(k, Math.round(40 * c.power))); go(); }, 2400));
    if (c.gold) timers.push(setTimeout(() => { [0, 1, 2, 3].forEach(k => confetti(k, 60)); for (let k = 0; k < 6; k++) rocket(k % 4); go(); }, 5200));
    return () => { dead = true; timers.forEach(clearTimeout); cancelAnimationFrame(raf); removeEventListener("resize", size); };
  }, [open, c]);

  if (!mounted) return null;
  return createPortal(
    <div className={`wov${open ? " on" : ""}${c.gold ? " gold" : ""}`} role="dialog" aria-modal="true" aria-labelledby="wov-title" aria-hidden={!open}
      style={{ ["--m" as string]: c.m, ["--dur" as string]: `${c.dur}ms` }}>
      <canvas ref={cv} aria-hidden="true" />
      <div className="wov-sweep" />
      <div className="wov-box">
        <div className="wov-badge"><div className="wov-ring" /><div className="wov-disc">
          {place === 1 ? (
            <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M20 10h24v14a12 12 0 0 1-24 0z" fill="#fff8d8" stroke="#7a5408" strokeWidth="2" /><path d="M20 14H11a9 9 0 0 0 10 13M44 14h9a9 9 0 0 1-10 13" fill="none" stroke="#7a5408" strokeWidth="3" /><path d="M28 36h8v8h-8z" fill="#7a5408" /><path d="M20 48h24v6H20z" fill="#7a5408" /><path d="M32 15l2.4 4.8 5.3.8-3.8 3.7.9 5.3-4.8-2.5-4.8 2.5.9-5.3-3.8-3.7 5.3-.8z" fill="#c8901d" /></svg>
          ) : (
            <svg viewBox="0 0 64 64" aria-hidden="true"><text x="32" y="45" textAnchor="middle" fontSize="40" fontWeight="800" fontFamily="Segoe UI,system-ui,sans-serif" fill="#1c1607" fillOpacity=".85">{place}</text></svg>
          )}
        </div></div>
        <div className="wov-kicker">{c.kicker}</div>
        <h1 id="wov-title">{c.title}</h1>
        <div className="wov-team"><span>{team}</span></div>
        <p className="wov-msg">{c.msg}</p>
        <div className="wov-act">
          <button ref={btn} type="button" onClick={close}>Continue to dashboard</button>
          <div className="wov-timer" aria-hidden="true"><i /></div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
