"use client";

/**
 * One poller per browser tab for /api/pulse (see the route for why).
 * - polls every 5 s, every 1.5 s while someone on the page asked for "fast" (live auction)
 * - pauses while the tab is hidden, checks immediately when it comes back
 * - backs off (up to 30 s) if the server is struggling, so a busy moment can't snowball
 */
export type Pulse = { v: Record<string, number>; lots: Record<string, { item_id: string; price: number } | null>; at: string };
type Fn = (p: Pulse) => void;

const fns = new Set<Fn>();
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL, SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
let direct = !!(SB_URL && SB_KEY);
/** Straight from Supabase (cheap, no Vercel usage); falls back to /api/pulse if that fails. */
async function fetchPulse(): Promise<Pulse> {
  if (direct) {
    try {
      const r = await fetch(`${SB_URL}/rest/v1/rpc/dh_pulse`, { method: "POST", headers: { apikey: SB_KEY!, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" }, body: "{}", cache: "no-store" });
      if (r.status === 404 || r.status === 401 || r.status === 403) direct = false;   // SQL not run / not granted
      else if (r.ok) return (await r.json()) as Pulse;
      else throw new Error(String(r.status));
    } catch (e) { if (!direct) { /* fall through */ } else throw e; }
  }
  const r = await fetch("/api/pulse", { cache: "no-store" as RequestCache });
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()) as Pulse;
}
let fast = 0, last: Pulse | null = null, timer: ReturnType<typeof setTimeout> | null = null, fails = 0, running = false;

async function tick() {
  timer = null;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") { schedule(); return; }
  try {
    const p = await fetchPulse();
    fails = 0; last = p;
    fns.forEach(f => { try { f(p); } catch {} });
  } catch { fails++; }
  schedule();
}
function schedule() {
  if (timer || !fns.size) return;
  const base = fast > 0 ? 1500 : 5000;
  const wait = fails ? Math.min(30000, base * 2 ** fails) : base;
  timer = setTimeout(tick, wait + Math.random() * (fast > 0 ? 400 : 1500));
}
function start() {
  if (running || typeof window === "undefined") return;
  running = true;
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { if (timer) clearTimeout(timer); timer = null; void tick(); } });
}

export function onPulse(fn: Fn) {
  start(); fns.add(fn);
  if (last) fn(last);
  if (!timer) timer = setTimeout(tick, Math.random() * 1200);   // spread the first poll of 1000 screens
  return () => { fns.delete(fn); };
}
/** ask for 1.5 s polling while mounted (e.g. a live auction screen) */
export function wantFastPulse() {
  fast++;
  if (timer) { clearTimeout(timer); timer = null; schedule(); }
  return () => { fast = Math.max(0, fast - 1); };
}
