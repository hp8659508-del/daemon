"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { onPulse, setPulseTeam, serverNow, pulseStale } from "@/lib/pulse";
import SandClock, { SyncedSand, type SandTone } from "@/components/sand-clock";
import { onRefreshPulse, onHubReady, sendRefreshPulse } from "@/lib/realtime";

/* ---------- Hourglass: the shared sand clock (see sand-clock.tsx) ---------- */
export function Hourglass({ fill = 1, size = 96, running = true, tone = "violet", mode = "timer" }: { fill?: number; size?: number; running?: boolean; tone?: SandTone; mode?: "timer" | "loader" | "idle"; spinning?: boolean }) {
  return <SandClock fill={fill} size={size} running={running} tone={tone} mode={mode} />;
}

/* ---------- Live countdown to a (projected) end time ---------- */
/** "now" by the SERVER's clock (corrected for phones whose clock is wrong). */
export function useNow(ms = 1000) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { setNow(serverNow()); const t = setInterval(() => setNow(serverNow()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}
export function fmtClock(msLeft: number) {
  const neg = msLeft < 0; const s = Math.floor(Math.abs(msLeft) / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${neg ? "−" : ""}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
export function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}
export function fmtMins(m: number) { return `${m > 0 ? "+" : m < 0 ? "−" : "±"}${Math.abs(m)} min`; }

/* ---------- Keeping screens current ----------
 * Team screens (and anything passed `pulse`) use the shared /api/pulse counters: no realtime
 * socket, no database subscription, reload only when their team or the event changed.
 * That is what lets 1000+ screens stay live. Admin screens (a handful) keep realtime. */
export function LiveSync(props: { tables: string[]; every?: number; jitter?: number; teamId?: string; pulse?: boolean }) {
  return props.teamId || props.pulse ? <PulseSync teamId={props.teamId} /> : <RealtimeSync {...props} />;
}

function PulseSync({ teamId }: { teamId?: string }) {
  const router = useRouter();
  const seen = useRef<{ g?: number; t?: number }>({});
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRefresh = useRef(0);
  const [ok, setOk] = useState(false);
  const [offline, setOffline] = useState(false);
  useEffect(() => { setPulseTeam(teamId); }, [teamId]);
  useEffect(() => { const t = setInterval(() => setOffline(pulseStale() && ok), 3000); return () => clearInterval(t); }, [ok]);
  useEffect(() => onPulse(p => {
    setOk(true); setOffline(false);
    const g = p.v?.global ?? 0, t = teamId ? p.v?.[teamId] ?? 0 : 0;
    const prev = seen.current;
    seen.current = { g, t };
    if (prev.g === undefined) return;                      // first sample: just remember
    const mine = t !== prev.t, all = g !== prev.g;
    if (!mine && !all) return;
    if (pending.current) return;
    // own team changed → quickly; whole event changed → spread 1000 screens over ~6 s
    const since = Date.now() - lastRefresh.current;
    const wait = Math.max(mine ? 150 : 400, 2500 - since) + Math.random() * (mine ? 900 : 6000);
    pending.current = setTimeout(() => { pending.current = null; lastRefresh.current = Date.now(); router.refresh(); }, wait);
  }), [router, teamId]);
  useEffect(() => () => { if (pending.current) clearTimeout(pending.current); }, []);
  return (
    <span className="chip" title={offline ? "No connection: reconnecting by itself" : ok ? "Up to date: changes arrive within a few seconds" : "Connecting…"}>
      <span className={`led ${offline ? "led-offline" : ok ? "led-live" : "led-upcoming"}`} />
      {offline ? "OFFLINE · RETRYING" : ok ? "LIVE" : "SYNC"}
    </span>
  );
}

function RealtimeSync({ tables, every = 12000, jitter = 0, teamId }: { tables: string[]; every?: number; jitter?: number; teamId?: string }) {
  const router = useRouter();
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRefresh = useRef(0);
  const [state, setState] = useState<"live" | "polling">("polling");
  const bump = useCallback(() => {
    if (pending.current) return;
    // jitter spreads 40 screens' refreshes over a short window instead of one spike
    const since = Date.now() - lastRefresh.current;
    pending.current = setTimeout(() => { pending.current = null; lastRefresh.current = Date.now(); router.refresh(); }, Math.max(350, 4000 - since) + Math.random() * Math.max(jitter, 3000));
  }, [router, jitter]);
  const liveRef = useRef(false);
  // Instant path: the admin's refresh pulse arrives over the broadcast hub (~100 ms).
  useEffect(() => onRefreshPulse(p => {
    if (teamId && p?.teams && !p.teams.includes(teamId)) return;
    bump();
  }), [bump, teamId]);
  useEffect(() => onHubReady(ok => { if (ok) { liveRef.current = true; setState("live"); } }), []);
  useEffect(() => {
    const supabase = createClient();
    const ch = supabase.channel(`daemon-live-${teamId ?? "staff"}-${Math.random().toString(36).slice(2, 8)}`);
    // Team screens only listen to their own rows; global tables stay unfiltered.
    const GLOBAL = new Set(["event_settings", "auction_items", "powerups", "bingo_cells"]);
    tables.forEach(t => {
      const cfg: Record<string, string> = { event: "*", schema: "public", table: t };
      if (teamId && !GLOBAL.has(t)) cfg.filter = t === "teams" ? `id=eq.${teamId}` : `team_id=eq.${teamId}`;
      ch.on("postgres_changes" as never, cfg as never, bump as never);
    });
    ch.subscribe(status => { const ok = status === "SUBSCRIBED"; liveRef.current = ok || liveRef.current; setState(ok ? "live" : liveRef.current ? "live" : "polling"); });
    // Safety net: poll slowly while realtime is healthy, faster if it drops.
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
      // Safety net only: realtime + pulses do the real work. 20 s when healthy, `every` (≈6 s) if not.
      timer = setTimeout(tick, (liveRef.current ? Math.max(every * 5, 30000) : Math.max(every * 2, 15000)) + Math.random() * Math.max(jitter, 5000));
    };
    timer = setTimeout(tick, every + Math.random() * jitter);
    const onFocus = () => bump();
    window.addEventListener("focus", onFocus);
    return () => { supabase.removeChannel(ch); clearTimeout(timer); window.removeEventListener("focus", onFocus); };
  }, [tables.join(","), every, bump, router, jitter, teamId]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <span className="chip" title={state === "live" ? "Realtime connected" : "Refreshing every few seconds"}>
      <span className={`led ${state === "live" ? "led-live" : "led-upcoming"}`} />
      {state === "live" ? "LIVE" : "SYNC"}
    </span>
  );
}

/* ---------- Admin command helper with toast ---------- */
type Toast = { id: number; text: string; bad?: boolean };
const READ_ONLY = new Set(["cert_link", "cert_upload_url", "quiz_admin", "health", "live_lot", "staff_list", "secrets"]);

export function useCommand() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = (text: string, bad = false) => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, text, bad }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), bad ? 6000 : 3200);
  };
  const run = async (payload: Record<string, unknown>, opts: { quiet?: boolean } = {}) => {
    setBusy(true);
    try {
      const r = await fetch("/api/control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Action failed");
      if (!opts.quiet) push(j.message || "Done");
      // read-only lookups change nothing: don't refresh this page or wake any team screens
      if (READ_ONLY.has(String(payload.action))) return j;
      router.refresh();
      // Tell every screen right away. Team-scoped actions only wake those teams.
      const ids = Array.isArray(payload.team_ids) ? payload.team_ids as string[]
        : typeof payload.team_id === "string" ? [payload.team_id as string, ...(typeof payload.target_team_id === "string" ? [payload.target_team_id as string] : [])]
        : null;
      sendRefreshPulse(payload.action === "sell" || payload.action === "undo_sale" ? null : ids);
      return j;
    } catch (e) {
      push(e instanceof Error ? e.message : "Action failed", true);
      return null;
    } finally { setBusy(false); }
  };
  const view = (
    <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2">
      {toasts.map(t => (
        <div key={t.id} className={`panel-tight animate-rise px-4 py-3 text-sm font-medium ${t.bad ? "text-err" : ""}`}>
          <span className={`led mr-2 ${t.bad ? "" : "led-live"}`} style={t.bad ? { background: "#B4442F" } : undefined} />{t.text}
        </div>
      ))}
    </div>
  );
  return { run, busy, toast: push, toasts: view };
}

export function StatusLed({ status }: { status: "upcoming" | "live" | "closed" }) {
  return <span className={`led led-${status}`} />;
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="well grid place-items-center px-6 py-12 text-center">
      <p className="font-display text-lg font-bold">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm text-muted">{children}</p>}
    </div>
  );
}

/* ---------- Brand mark: the synced sand clock (header uses logo=true so the splash lands there) ---------- */
export function LogoGlass({ size = 40, logo = false }: { size?: number; className?: string; logo?: boolean }) {
  return <SyncedSand size={Math.round(size * 0.62)} logo={logo} />;
}
