"use client";

import { useEffect, useRef, useState } from "react";
import { SandEngine } from "@/lib/sand-engine";

/**
 * First open of the site in a tab — one continuous motion, nothing stops:
 *   rise in on plain dark → radiant sand drains → flip flows straight into flight →
 *   arcs into the header logo slot ([data-dh-logo]) while the sand cools to club violet →
 *   the page appears and the logo gets its one shine.
 * Skipped on later loads in the tab (sessionStorage + a class set before paint).
 */
const s5 = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * t * (t * (t * 6 - 15) + 10));
const sm = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const D: Record<string, [number, number]> = { rise: [0, 900], drain: [350, 2700], flip: [2500, 3350], fly: [3150, 4400], violet: [3250, 4300], veil: [3300, 4500] };
const ph = (t: number, [a, b]: [number, number]) => Math.max(0, Math.min(1, (t - a) / (b - a)));

export default function Splash() {
  const [gone, setGone] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const veilRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (document.documentElement.classList.contains("dh-seen")) { setGone(true); return; }
    try { sessionStorage.setItem("dh-splash", "1"); } catch {}
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setGone(true); return; }

    const BIG = Math.round(Math.min(210, window.innerHeight * 0.33));
    const H = BIG * 170 / 120;
    const e = new SandEngine({ size: BIG, palette: "radiant", glow: true, particles: true, rate: 100 });
    stageRef.current?.replaceChildren(e.el);
    document.documentElement.classList.add("dh-intro");

    let raf = 0; const t0 = performance.now(); let last = t0;
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now; const t = now - t0;
      const cx = window.innerWidth / 2, cy = window.innerHeight * 0.46, float = Math.sin(t / 650) * 4;
      const r = s5(ph(t, D.rise));
      const d = ph(t, D.drain); e.set(1 - sm(d), d > 0 && d < 1);
      const fp = s5(ph(t, D.flip)); let rot = 180 * fp; if (fp >= 1) { e.set(1, false); rot = 0; }
      const fl = s5(ph(t, D.fly));
      const logo = Array.from(document.querySelectorAll<HTMLElement>("[data-dh-logo]")).find(el => el.getBoundingClientRect().width > 0);
      const lr = logo?.getBoundingClientRect();
      const tx = lr ? lr.left + lr.width / 2 : cx, ty = lr ? lr.top + lr.height / 2 : cy;
      const targetScale = lr ? lr.height / H : 0.2;
      const x = cx + (tx - cx) * fl, y = (cy + float * (1 - fl) + (1 - r) * 40) + (ty - cy) * fl - Math.sin(fl * Math.PI) * 110;
      const s = (0.8 + 0.2 * r) * (1 + (targetScale - 1) * fl);
      const st = stageRef.current;
      if (st) { st.style.transform = `translate(${x - BIG / 2}px, ${y - H / 2}px) scale(${s})`; st.style.opacity = String(lr ? r : r * (1 - fl)); }
      e.rotate(rot + Math.sin(fl * Math.PI) * -14 + Math.sin(t / 900) * 1.2 * (1 - fl));
      const v = sm(ph(t, D.violet)); e.toViolet(v); e.setGlow(0.9 * (1 - v * 0.9));
      const vl = sm(ph(t, D.veil)); if (veilRef.current) veilRef.current.style.opacity = String(1 - vl);
      if (titleRef.current) titleRef.current.dataset.state = t < 500 ? "" : t < D.fly[0] ? "on" : "off";
      if (fl > 0.55) document.documentElement.classList.remove("dh-intro");
      e.step(dt);
      if (t < D.veil[1] + 60) { raf = requestAnimationFrame(frame); return; }
      // hand-off: the real logo is already running underneath; give it one shine
      if (logo) { logo.classList.add("dh-shine"); setTimeout(() => logo.classList.remove("dh-shine"), 900); }
      setGone(true);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); document.documentElement.classList.remove("dh-intro"); };
  }, []);

  if (gone) return null;
  return (
    <div id="dh-splash" aria-hidden>
      <div ref={veilRef} className="dh-veil" />
      <div ref={stageRef} className="dh-stage" />
      <div ref={titleRef} className="dh-title"><b>Daemon Hour</b><small>MAD Club · NHCE</small></div>
    </div>
  );
}
