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
let directFails = 0, directOffUntil = 0;
let team: string | null = null;
/** Ask only for this team's counter (keeps every poll ~150 bytes). */
export function setPulseTeam(id: string | null | undefined) { team = id ?? null; }
/** server time − this phone's time (ms). Phones with a wrong clock still count down correctly. */
let skew = 0;
export function serverNow() { return Date.now() + skew; }
let lastOk = 0;
/** true if the last successful check was more than 20 s ago (shown as OFFLINE) */
export function pulseStale() { return !lastOk || Date.now() - lastOk > 20000; }
const withTimeout = (ms: number) => { const ac = new AbortController(); setTimeout(() => ac.abort(), ms); return ac.signal; };
/** Straight from Supabase (cheap, no Vercel usage); falls back to /api/pulse if that fails. */
async function fetchPulse(): Promise<Pulse> {
  // Straight from Supabase normally; if it is slow/failing twice in a row, use the
  // CDN-cached copy on Vercel for a minute (the database then sees ~1 request/second).
  if (direct && Date.now() > directOffUntil) {
    try {
      const r = await fetch(`${SB_URL}/rest/v1/rpc/dh_pulse`, { method: "POST", headers: { apikey: SB_KEY!, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(team ? { p_team: team } : {}), cache: "no-store", signal: withTimeout(5000) });
      if (r.status === 404 || r.status === 401 || r.status === 403) direct = false;   // SQL not run / not granted
      else if (r.ok) { directFails = 0; return (await r.json()) as Pulse; }
      else throw new Error(String(r.status));
    } catch {
      if (++directFails >= 2) { directOffUntil = Date.now() + 60_000 + Math.random() * 30_000; directFails = 0; }
    }
  }
  const r = await fetch(`/api/pulse${team ? `?team=${team}` : ""}`, { cache: "no-store" as RequestCache, signal: withTimeout(8000) });
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()) as Pulse;
}
let fast = 0, last: Pulse | null = null, timer: ReturnType<typeof setTimeout> | null = null, fails = 0, running = false;

async function tick() {
  timer = null;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") { schedule(); return; }
  try {
    const t0 = Date.now();
    const p = await fetchPulse();
    const rtt = Date.now() - t0;
    if (p.at && rtt < 3000) { const est = new Date(p.at).getTime() + rtt / 2 - Date.now(); skew = skew ? skew * 0.7 + est * 0.3 : est; }
    fails = 0; last = p; lastOk = Date.now();
    fns.forEach(f => { try { f(p); } catch {} });
  } catch { fails++; }
  schedule();
}
function schedule() {
  if (timer || !fns.size) return;
  const base = fast > 0 ? 1500 : 6000;
  const wait = fails ? Math.min(30000, base * 2 ** fails) : base;
  timer = setTimeout(tick, wait + Math.random() * (fast > 0 ? 400 : 1500));
}
function start() {
  if (running || typeof window === "undefined") return;
  running = true;
  const now = () => { if (timer) clearTimeout(timer); timer = null; fails = 0; void tick(); };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") now(); });
  window.addEventListener("online", now);   // Wi-Fi came back: check straight away
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
