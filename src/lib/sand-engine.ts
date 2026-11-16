/**
 * Daemon Hour sand clock engine (browser only).
 * Draws a realistic hourglass in SVG and animates sand with simple physics:
 * grains leave the neck at a fixed rate, fall under gravity, land on the cone
 * and roll down it. Grain colour follows the sand: they leave the upper bulb
 * warm (amber-gold) and cool to the lower bulb's purple as they fall.
 *
 * Imperative on purpose: one rAF loop per instance updates the DOM directly,
 * so React never re-renders 60× a second.
 */

export type SandPalette = "radiant" | "violet";

const GLASS = "M27 22 C27 22 93 22 93 22 C93 52 70 70 64 85 C70 100 93 118 93 148 L27 148 C27 118 50 100 56 85 C50 70 27 52 27 22 Z";

// Poster colours: warm molten top, cool electric bottom. Club violet for the logo.
// top runs vertically: pink at the surface → amber at the neck, so the stream leaves in the colour it touches
const RADIANT_TOP = ["#FF4FD8", "#FF5F86", "#FF9A5C", "#FFC46B"];
const RADIANT_BOT = ["#3FD8FF", "#3A5BFF", "#9B5CFF", "#C27BFF"];
const VIOLET = ["#C9B8FF", "#9D85FF", "#6B4BFF", "#5136E0"];
// grain colour: leaves the neck in the top bulb's neck colour, lands in the bottom bulb's colour
const GRAIN_FROM: Record<SandPalette, string> = { radiant: "#FFC46B", violet: "#5A40E8" };
const GRAIN_TO: Record<SandPalette, string> = { radiant: "#8C6BFF", violet: "#6B4BFF" };

/* area-exact surface heights for this glass (top bulb y 22..85), 41 samples */
const TOPY: number[] = (() => {
  const P = [[93, 22], [93, 52], [70, 70], [64, 85]], pts: number[][] = [];
  for (let i = 0; i <= 2000; i++) {
    const t = i / 2000, u = 1 - t;
    pts.push([u * u * u * P[0][0] + 3 * u * u * t * P[1][0] + 3 * u * t * t * P[2][0] + t * t * t * P[3][0],
              u * u * u * P[0][1] + 3 * u * u * t * P[1][1] + 3 * u * t * t * P[2][1] + t * t * t * P[3][1]]);
  }
  const area = (L: number) => { let a = 0; for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; if (y1 <= L) continue; a += (y1 - Math.max(y0, L)) * 2 * ((x0 + x1) / 2 - 60); } return a; };
  const A = area(22), out: number[] = [];
  for (let k = 0; k <= 40; k++) { const f = k / 40; let lo = 22, hi = 85; for (let j = 0; j < 36; j++) { const m = (lo + hi) / 2; if (area(m) / A > f) lo = m; else hi = m; } out.push((lo + hi) / 2); }
  return out;
})();
const levelFor = (f: number) => { const x = Math.max(0, Math.min(1, f)) * 40, i = Math.min(39, Math.floor(x)); return TOPY[i] + (TOPY[i + 1] - TOPY[i]) * (x - i); };

const hex = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
export const mixHex = (a: string, b: string, t: number) => {
  const A = hex(a), B = hex(b), k = Math.max(0, Math.min(1, t));
  return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * k).toString(16).padStart(2, "0")).join("");
};

let uid = 0;
type Grain = { k: "fall" | "roll" | "creep"; x: number; y: number; vx?: number; vy?: number; r: number; a: number; dir?: number; v?: number; life?: number; side?: number; s?: number };

export type SandOptions = { size: number; palette?: SandPalette; particles?: boolean; glow?: boolean; rate?: number };

export class SandEngine {
  el: SVGSVGElement;
  private f = 1; private flowing = false; private acc = 0; private parts: Grain[] = [];
  private violetMix = 0; private cool = 0; private clock = 0; private wasOn = false; private jetOn = -1e9; private jetOff = -1e9; private shift = Math.random() * 6; private geo = { ty: 22, dip: 0, half: 0, peak: 148, m: 0, on: false };
  private opts: Required<SandOptions>;
  private q: Record<string, Element[]> = {};
  private id: string;

  constructor(o: SandOptions) {
    this.opts = { palette: "violet", particles: true, glow: false, rate: 100, ...o };
    this.id = "sand" + (uid++);
    const id = this.id, { size, glow } = this.opts;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 120 170"); svg.setAttribute("width", String(size)); svg.setAttribute("height", String(size * 170 / 120));
    svg.style.overflow = "visible"; svg.setAttribute("aria-hidden", "true");
    const stops = (arr: string[]) => arr.map((c, i) => `<stop offset="${(i / (arr.length - 1)).toFixed(2)}" stop-color="${c}"/>`).join("");
    const caps = [10, 147].map(y => `
      <rect x="15" y="${y}" width="90" height="13" rx="3.5" fill="url(#mV${id})"/>
      <rect x="15" y="${y}" width="90" height="13" rx="3.5" fill="url(#br${id})"/>
      <rect x="15" y="${y}" width="90" height="13" rx="3.5" fill="url(#mH${id})"/>
      <rect x="16.5" y="${y + .7}" width="87" height="1.1" rx=".55" fill="#fff" opacity=".75"/>
      <rect x="16.5" y="${y + 11.4}" width="87" height=".9" rx=".45" fill="#000" opacity=".45"/>
      <rect x="15" y="${y + 5.6}" width="90" height=".6" fill="#fff" opacity=".22"/>
      <rect x="15" y="${y + 6.4}" width="90" height=".5" fill="#000" opacity=".3"/>`).join("");
    const sand = (cls: string) => `<g class="sp"><path class="${cls}top" fill="url(#sT${id})"/><path class="${cls}top ${cls}ctop" fill="url(#sB${id})" opacity="0"/><path class="${cls}pile" fill="url(#sB${id})"/></g><g class="vv" opacity="0"><path class="${cls}top" fill="url(#vi${id})"/><path class="${cls}pile" fill="url(#vi${id})"/></g>`;
    svg.innerHTML = `
    <defs>
      <clipPath id="cl${id}"><path d="${GLASS}"/></clipPath>
      <linearGradient id="sT${id}" x1="0" y1="0" x2="0" y2="1">${stops(this.opts.palette === "radiant" ? RADIANT_TOP : VIOLET)}</linearGradient>
      <linearGradient id="sB${id}" x1="0" y1="0" x2="1" y2="1">${stops(this.opts.palette === "radiant" ? RADIANT_BOT : VIOLET)}</linearGradient>
      <linearGradient id="vi${id}" x1="0" y1="0" x2="0" y2="1">${stops(VIOLET)}</linearGradient>
      <linearGradient id="jt${id}" gradientUnits="userSpaceOnUse" x1="60" x2="60" y1="85" y2="148"><stop offset="0" stop-color="${GRAIN_FROM[this.opts.palette]}"/><stop offset="1" stop-color="${GRAIN_TO[this.opts.palette]}"/></linearGradient>
      <linearGradient id="sh${id}" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity=".35"/><stop offset=".25" stop-color="#fff" stop-opacity="0"/><stop offset=".45" stop-color="#fff" stop-opacity=".26"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".3"/></linearGradient>
      <filter id="gr${id}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="2.3" numOctaves="2" seed="4" result="n"/><feColorMatrix in="n" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .55 -.2" result="w"/><feComposite in="w" in2="SourceGraphic" operator="in" result="g"/><feBlend in="SourceGraphic" in2="g" mode="screen"/></filter>
      <filter id="bl${id}" x="-60%" y="-40%" width="220%" height="180%"><feGaussianBlur stdDeviation="5"/></filter>
      <filter id="so${id}"><feGaussianBlur stdDeviation=".7"/></filter>
      <linearGradient id="fr${id}" x1="0" x2="1"><stop offset="0" stop-color="#C9B8FF" stop-opacity=".32"/><stop offset=".15" stop-color="#fff" stop-opacity=".07"/><stop offset=".5" stop-color="#fff" stop-opacity=".02"/><stop offset=".85" stop-color="#fff" stop-opacity=".07"/><stop offset="1" stop-color="#C9B8FF" stop-opacity=".36"/></linearGradient>
      <linearGradient id="mV${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E9E2FF"/><stop offset=".08" stop-color="#9C88FF"/><stop offset=".22" stop-color="#3C29A8"/><stop offset=".48" stop-color="#150E45"/><stop offset=".62" stop-color="#2B1F80"/><stop offset=".8" stop-color="#5440D0"/><stop offset=".92" stop-color="#1A1250"/><stop offset="1" stop-color="#07051A"/></linearGradient>
      <linearGradient id="mH${id}" x1="0" x2="1"><stop offset="0" stop-color="#07051A" stop-opacity=".6"/><stop offset=".12" stop-color="#fff" stop-opacity="0"/><stop offset=".3" stop-color="#fff" stop-opacity=".3"/><stop offset=".36" stop-color="#fff" stop-opacity="0"/><stop offset=".72" stop-color="#fff" stop-opacity=".1"/><stop offset=".9" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#07051A" stop-opacity=".6"/></linearGradient>
      <pattern id="br${id}" width="120" height="1.2" patternUnits="userSpaceOnUse"><rect width="120" height=".5" fill="#fff" opacity=".07"/></pattern>
      <linearGradient id="rd${id}" x1="0" x2="1"><stop offset="0" stop-color="#0C0830"/><stop offset=".35" stop-color="#8F7BFF"/><stop offset=".5" stop-color="#F0EAFF"/><stop offset=".65" stop-color="#5A44D8"/><stop offset="1" stop-color="#0C0830"/></linearGradient>
      <linearGradient id="gl${id}" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    </defs>
    <g class="body" style="transform-origin:60px 85px">
      ${glow ? `<g class="glow" filter="url(#bl${id})" opacity=".9"><g clip-path="url(#cl${id})">${sand("g")}<path class="gstream" fill="url(#jt${id})"/></g></g>` : ""}
      <path d="${GLASS}" fill="rgba(160,140,255,.06)"/>
      <g clip-path="url(#cl${id})">
        <g filter="url(#gr${id})">${sand("")}<path class="stream" fill="url(#jt${id})"/></g>
        <rect x="0" y="0" width="120" height="170" fill="url(#sh${id})" opacity=".8"/><g class="strands" stroke="url(#jt${id})" stroke-linecap="round" fill="none"><path stroke-width=".38" stroke-dasharray="1.6 1.1"/><path stroke-width=".3" stroke-dasharray=".9 1.7"/><path stroke-width=".34" stroke-dasharray="2.2 1.4"/><path stroke-width=".26" stroke-dasharray=".6 2.2"/></g>
        <g class="grains"></g>
        <rect class="glint" x="-60" y="-10" width="26" height="190" fill="url(#gl${id})" transform="skewX(-16)" opacity="0"/>
      </g>
      <path d="${GLASS}" fill="url(#fr${id})"/>
      <path d="${GLASS}" fill="none" stroke="#0E0B2B" stroke-opacity=".3" stroke-width="2.4"/>
      <path d="${GLASS}" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width=".9"/>
      <path d="M32.5 27 C32.5 50 46 66 54.5 79" stroke="#fff" stroke-width="3.6" stroke-linecap="round" fill="none" opacity=".6" filter="url(#so${id})"/>
      <path d="M36.5 27 C36.5 43 43 55 48.5 63" stroke="#fff" stroke-width="1" stroke-linecap="round" fill="none" opacity=".7"/>
      <path d="M32.5 143 C32.5 121 46 104 54.5 91" stroke="#fff" stroke-width="3.6" stroke-linecap="round" fill="none" opacity=".45" filter="url(#so${id})"/>
      <path d="M87.5 30 C86.5 48 78 61 70 71" stroke="#fff" stroke-width="1.4" stroke-linecap="round" fill="none" opacity=".35"/>
      ${caps}
      <rect x="19" y="22" width="3.6" height="126" rx="1.8" fill="url(#rd${id})"/>
      <rect x="97.4" y="22" width="3.6" height="126" rx="1.8" fill="url(#rd${id})"/>
    </g>`;
    this.el = svg;
    for (const k of ["body", "top", "pile", "gtop", "gpile", "stream", "gstream", "grains", "strands", "glint", "glow", "sp", "vv", "ctop", "gctop"]) this.q[k] = Array.from(svg.querySelectorAll("." + k));
    this.draw();
  }

  set(fill: number, flowing: boolean) { if (this.f < .05 && fill > .95) this.cool = 1; this.f = Math.max(0, Math.min(1, fill)); this.flowing = flowing; if (!flowing) this.parts = this.parts.filter(p => p.k !== "creep"); }
  rotate(deg: number) { (this.q.body[0] as SVGGElement).style.transform = `rotate(${deg}deg)`; }
  /** 0 = palette colours, 1 = club violet (used as the splash lands in the header) */
  toViolet(t: number) { this.violetMix = Math.max(0, Math.min(1, t)); }
  setGlow(o: number) { this.q.glow[0]?.setAttribute("opacity", String(o)); }
  glint(p: number) { const g = this.q.glint[0]; g.setAttribute("opacity", String(p > 0 && p < 1 ? Math.sin(p * Math.PI) : 0)); g.setAttribute("x", String(-60 + p * 200)); }
  clear() { this.parts = []; this.acc = 0; }

  private surf(x: number) { const d = Math.min(1, Math.abs(x - 60) / 38); return this.geo.peak + 1.3 * this.geo.m * Math.pow(d, 1.25); }

  private draw() {
    const f = this.f, ty = levelFor(f), dip = Math.min(9, 2 + (1 - f) * 14) * (f > 0.02 ? 1 : 0), nb = Math.max(0, 85 - ty), half = 26 * Math.min(1, nb / 40);
    const top = f > 0.003 ? `M0 ${ty} L${60 - half} ${ty} Q60 ${ty + dip * 1.6} ${60 + half} ${ty} L120 ${ty} L120 84.4 L0 84.4 Z` : "M0 0Z";
    // the pile's peak never pokes up through the neck (that was the 'slab' when the bottom is full)
    const py = 170 - ty, h = 148 - py, m = Math.max(0, Math.min(10, h * .55, (py - 86.5) / .7)), peak = py - m * .7;
    const pile = h > 0.4 ? `M0 150 L0 ${py + m * .6} L22 ${py + m * .6} C45 ${py + m * .4} 52 ${py - m * .55} 60 ${peak} C68 ${py - m * .55} 75 ${py + m * .4} 98 ${py + m * .6} L120 ${py + m * .6} L120 150 Z` : "M0 0Z";
    [...this.q.top, ...this.q.gtop].forEach(e => e.setAttribute("d", top));
    [...this.q.pile, ...this.q.gpile].forEach(e => e.setAttribute("d", pile));
    const on = this.flowing && f > 0.004 && f < 0.998;
    // The stream is a falling column, not a switch. When flow starts, its front falls from the neck
    // under gravity (y = ½gt²). When flow stops, its tail detaches and falls after it.
    const clk = this.clock;
    if (on && !this.wasOn) this.jetOn = clk; if (!on && this.wasOn) this.jetOff = clk; this.wasOn = on;
    const fallY = (t: number) => 84.4 + 260 * t * t + 9 * t;
    const head = Math.min(peak, fallY(clk - this.jetOn)), tail = on ? 84.4 : fallY(clk - this.jetOff);
    const vis = tail < peak - .3 && head > 84.6;
    const now = clk;
    // Physics of the jet. Sand pours out of the funnel, following the glass walls inward.
    // It pinches to the throat (vena contracta) just below the neck, then free-falls.
    // Continuity keeps width·v constant, and v² = vc² + 2g·h, so width ∝ (vc² / (vc² + 2g·h))^¼.
    // It thins as it accelerates, then breaks up into separate strands of grains near the pile.
    const yC = 88.2, wN = 4.4, wC = 0.85, vc2 = 380, solid = yC + (peak - yC) * .62;
    const jw = (y: number) => {
      if (y <= yC) { const u = (y - 84.4) / (yC - 84.4); const e = 1 - Math.pow(u, 1.7); return wC + (wN - wC) * e * e; }
      return wC * Math.pow(vc2 / (vc2 + 2 * 520 * (y - yC)), .25) * (1 + .06 * Math.sin(now * 31 + y));
    };
    const y0 = Math.max(84.4, tail), y1 = Math.min(solid, head);
    let taper = "M0 0Z";
    if (vis && y1 > y0 + .2) {
      const N = 18, L: string[] = [], Rr: string[] = [];
      for (let i = 0; i <= N; i++) {
        const y = y0 + (y1 - y0) * Math.pow(i / N, 1.6), w = jw(y), sway = Math.sin(now * 9 + y * .4) * .05 * (y - 84.4) / 20;
        L.push(`${(60 - w + sway).toFixed(2)} ${y.toFixed(2)}`); Rr.unshift(`${(60 + w + sway).toFixed(2)} ${y.toFixed(2)}`);
      }
      const tip = y1 >= solid - .01 ? solid + 3 : y1 + 1.2;
      taper = `M${L.join(" L")} L${(60 + Math.sin(now * 17) * .1).toFixed(2)} ${tip.toFixed(2)} L${Rr.join(" L")} Z`;
    }
    for (const el of [...this.q.stream, ...this.q.gstream]) { (el as SVGElement).style.display = vis ? "" : "none"; el.setAttribute("d", taper); }
    const st = this.q.strands[0] as SVGGElement | undefined;
    if (st) {
      const s0 = Math.max(solid - 4, tail), s1 = Math.min(peak, head);
      st.style.display = vis && s1 > s0 + .5 ? "" : "none";
      const spread = [-.55, .35, -.15, .7];
      Array.from(st.children).forEach((c, i) => {
        const x0 = 60 + spread[i] * .2, x1 = 60 + spread[i] * (1.3 + .3 * Math.sin(now * 3 + i)) * (s1 - s0) / Math.max(1, peak - solid + 4);
        c.setAttribute("d", `M${x0.toFixed(2)} ${s0.toFixed(1)} Q${(x0 + (x1 - x0) * .3).toFixed(2)} ${((s0 + s1) / 2).toFixed(1)} ${x1.toFixed(2)} ${s1.toFixed(1)}`);
        c.setAttribute("stroke-dashoffset", String((-now * (38 + i * 7)) % 40));
      });
    }
    this.el.querySelector(`#jt${this.id}`)?.setAttribute("y2", String(Math.max(90, peak)));
    // liquid light: the gradients drift slowly
    this.shift += .004; const a = Math.sin(this.shift) * .5 + .5;
    this.el.querySelector(`#sT${this.id}`)?.setAttribute("gradientTransform", `rotate(${(a * 24 - 12).toFixed(1)} .5 .5)`);
    this.el.querySelector(`#sB${this.id}`)?.setAttribute("gradientTransform", `rotate(${(-a * 70 + 35).toFixed(1)} .5 .5)`);
    this.q.sp.forEach(e => e.setAttribute("opacity", String(1 - this.violetMix)));
    this.q.vv.forEach(e => e.setAttribute("opacity", String(this.violetMix)));
    // after a flip the (former bottom) sand is on top: it starts in the bottom colours and warms up gradually
    const c = this.cool * this.cool * (3 - 2 * this.cool);
    [...this.q.ctop, ...this.q.gctop].forEach(e => e.setAttribute("opacity", c.toFixed(3)));
    this.geo = { ty, dip, half, peak, m, on };
    // grains: colour by how far they've fallen (warm at the neck → purple at the pile)
    const to0 = mixHex(GRAIN_TO[this.opts.palette], GRAIN_TO.violet, this.violetMix);
    const from = mixHex(mixHex(GRAIN_FROM[this.opts.palette], GRAIN_FROM.violet, this.violetMix), to0, c), to = mixHex(GRAIN_TO[this.opts.palette], GRAIN_TO.violet, this.violetMix);
    const sg = this.el.querySelector(`#jt${this.id}`); sg?.children[0]?.setAttribute("stop-color", from); sg?.children[1]?.setAttribute("stop-color", to);
    const span = Math.max(1, peak - 85);
    (this.q.grains[0] as SVGGElement).innerHTML = this.parts.map(p => {
      const t = p.k === "creep" ? 0 : p.k === "roll" ? 1 : (p.y - 85) / span;
      return `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="${p.r}" fill="${mixHex(from, to, t)}" opacity="${p.a.toFixed(2)}"/>`;
    }).join("");
  }

  /** advance by dt seconds */
  step(dt: number) {
    this.cool = Math.max(0, this.cool - dt / 2.4); this.clock += dt;
    this.draw();
    if (!this.opts.particles) return;
    const g = this.geo, G = 520, R = Math.random, N = () => (R() + R() + R() - 1.5) / 1.5;
    if (g.on) {
      this.acc += dt * this.opts.rate;
      while (this.acc >= 1) { this.acc--; this.parts.push({ k: "fall", x: 60 + N() * .5, y: 84.4 + 3.8 * R(), vx: N() * 1.1, vy: 9 + R() * 4, r: +(.42 + R() * .34).toFixed(2), a: 1 }); }
      if (R() < dt * 14 && g.half > 2) { const s = R() < .5 ? -1 : 1; this.parts.push({ k: "creep", x: 60 + s * g.half * (.35 + R() * .55), y: g.ty, side: s, s: 0, r: +(.4 + R() * .25).toFixed(2), a: 1 }); }
    }
    for (const p of this.parts) {
      if (p.k === "fall") {
        p.vy! += G * dt; p.x += p.vx! * dt * (1 + (p.y - 85) / 12); p.y += p.vy! * dt; p.vx! *= .98;
        const land = this.surf(p.x);
        if (p.y >= land) { p.y = land; p.k = "roll"; p.dir = Math.abs(p.x - 60) < .2 ? (R() < .5 ? -1 : 1) : Math.sign(p.x - 60); p.v = 6 + R() * 10; p.life = .35 + R() * .35; }
      } else if (p.k === "roll") {
        p.x += p.dir! * p.v! * dt; p.v! *= Math.pow(.08, dt); p.y = this.surf(p.x); p.life! -= dt; p.a = Math.max(0, Math.min(1, p.life! * 3)); if (p.life! <= 0) p.a = -1;
      } else {
        p.s! += dt * (4 + p.s! * 30); p.x += (60 - p.x) * Math.min(1, dt * p.s! * 1.8);
        const d = Math.abs(p.x - 60) / Math.max(1, g.half); p.y = g.ty + g.dip * 1.6 * (1 - d * d) * .9; if (Math.abs(p.x - 60) < .8) p.a = -1;
      }
    }
    this.parts = this.parts.filter(p => p.a >= 0).slice(-220);
  }
}
