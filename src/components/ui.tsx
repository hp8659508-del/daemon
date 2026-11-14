"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/* ---------- Brass hourglass: the event's mascot, fill = time remaining ---------- */
export function Hourglass({ fill = 0.6, size = 96, spinning = false }: { fill?: number; size?: number; spinning?: boolean }) {
  const f = Math.max(0, Math.min(1, fill));
  const topY = 22 + (1 - f) * 34; // sand line in the upper bulb
  const botY = 106 - f * 0 - (1 - f) * 30; // sand pile in the lower bulb
  return (
    <svg width={size} height={size * 1.25} viewBox="0 0 96 120" aria-hidden className={spinning ? "transition-transform duration-700" : ""}>
      <defs>
        <linearGradient id="brass" x1="0" x2="1"><stop offset="0" stopColor="#8E6F33" /><stop offset=".35" stopColor="#E9D3A0" /><stop offset=".6" stopColor="#B8954F" /><stop offset="1" stopColor="#7A5E2A" /></linearGradient>
        <linearGradient id="glass" x1="0" x2="1"><stop offset="0" stopColor="#ffffff" stopOpacity=".9" /><stop offset=".4" stopColor="#E9EDF2" stopOpacity=".35" /><stop offset="1" stopColor="#C7D1DD" stopOpacity=".55" /></linearGradient>
        <linearGradient id="sandg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#7C93E0" /><stop offset=".5" stopColor="#A6D8D4" /><stop offset="1" stopColor="#E7D9BD" /></linearGradient>
        <clipPath id="topBulb"><path d="M22 18 H74 C74 40 52 52 50 60 H46 C44 52 22 40 22 18Z" /></clipPath>
        <clipPath id="botBulb"><path d="M46 60 H50 C52 68 74 80 74 102 H22 C22 80 44 68 46 60Z" /></clipPath>
      </defs>
      <path d="M22 18 H74 C74 40 52 52 50 60 C52 68 74 80 74 102 H22 C22 80 44 68 46 60 C44 52 22 40 22 18Z" fill="url(#glass)" stroke="#AAB6C4" strokeWidth="1.2" />
      <g clipPath="url(#topBulb)"><rect x="18" y={topY} width="60" height="60" fill="url(#sandg)" /></g>
      <g clipPath="url(#botBulb)"><path d={`M18 104 L18 ${botY + 6} Q48 ${botY - 10} 78 ${botY + 6} L78 104Z`} fill="url(#sandg)" /></g>
      {f > 0 && f < 1 && <rect x="47.2" y="58" width="1.6" height="40" fill="#8FA4E4" opacity=".8"><animate attributeName="opacity" values=".4;.9;.4" dur="1.2s" repeatCount="indefinite" /></rect>}
      <path d="M30 26 C30 36 40 44 44 50" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" fill="none" opacity=".8" />
      <rect x="12" y="8" width="72" height="10" rx="3" fill="url(#brass)" />
      <rect x="12" y="102" width="72" height="10" rx="3" fill="url(#brass)" />
      <rect x="15" y="18" width="4" height="84" rx="2" fill="url(#brass)" />
      <rect x="77" y="18" width="4" height="84" rx="2" fill="url(#brass)" />
    </svg>
  );
}

/* ---------- Live countdown to a (projected) end time ---------- */
export function useNow(ms = 1000) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
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

/* ---------- Realtime + polling refresh so screens follow the admin instantly ---------- */
export function LiveSync({ tables, every = 12000 }: { tables: string[]; every?: number }) {
  const router = useRouter();
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, setState] = useState<"live" | "polling">("polling");
  const bump = useCallback(() => {
    if (pending.current) return;
    pending.current = setTimeout(() => { pending.current = null; router.refresh(); }, 350);
  }, [router]);
  useEffect(() => {
    const supabase = createClient();
    const ch = supabase.channel("daemon-live");
    tables.forEach(t => ch.on("postgres_changes" as never, { event: "*", schema: "public", table: t } as never, bump as never));
    ch.subscribe(status => setState(status === "SUBSCRIBED" ? "live" : "polling"));
    const poll = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, every);
    const onFocus = () => router.refresh();
    window.addEventListener("focus", onFocus);
    return () => { supabase.removeChannel(ch); clearInterval(poll); window.removeEventListener("focus", onFocus); };
  }, [tables.join(","), every, bump, router]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <span className="chip" title={state === "live" ? "Realtime connected" : "Refreshing every few seconds"}>
      <span className={`led ${state === "live" ? "led-live" : "led-upcoming"}`} />
      {state === "live" ? "LIVE" : "SYNC"}
    </span>
  );
}

/* ---------- Admin command helper with toast ---------- */
type Toast = { id: number; text: string; bad?: boolean };
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
      router.refresh();
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

/* ---------- Brand mark: glass hourglass with the poster's prismatic "potion" ---------- */
export function LogoGlass({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label="Daemon Hour" className={className}>
      <defs>
        <linearGradient id="lg-potion" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FF8FCB" /><stop offset=".28" stopColor="#FFC98A" /><stop offset=".5" stopColor="#7FEAFF" /><stop offset=".72" stopColor="#7E9BFF" /><stop offset="1" stopColor="#C597FF" />
          <animateTransform attributeName="gradientTransform" type="rotate" from="0 .5 .5" to="360 .5 .5" dur="10s" repeatCount="indefinite" />
        </linearGradient>
        <linearGradient id="lg-cap" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#3A4270" /><stop offset="1" stopColor="#11142A" /></linearGradient>
        <radialGradient id="lg-glass" cx=".3" cy=".25" r=".9"><stop offset="0" stopColor="#fff" stopOpacity=".95" /><stop offset=".5" stopColor="#E8EEFF" stopOpacity=".35" /><stop offset="1" stopColor="#B8C4E8" stopOpacity=".5" /></radialGradient>
        <clipPath id="lg-top"><path d="M20 13 H44 C44 25 35 29 33.5 32 H30.5 C29 29 20 25 20 13Z" /></clipPath>
        <clipPath id="lg-bot"><path d="M30.5 32 H33.5 C35 35 44 39 44 51 H20 C20 39 29 35 30.5 32Z" /></clipPath>
      </defs>
      <g transform="rotate(-22 32 32)">
        <path d="M20 13 H44 C44 25 35 29 33.5 32 C35 35 44 39 44 51 H20 C20 39 29 35 30.5 32 C29 29 20 25 20 13Z" fill="url(#lg-glass)" stroke="#11142A" strokeWidth="1.4" />
        <g clipPath="url(#lg-top)"><rect x="16" y="20" width="32" height="16" fill="url(#lg-potion)" /></g>
        <g clipPath="url(#lg-bot)"><path d="M16 53 L16 44 Q32 36 48 44 L48 53Z" fill="url(#lg-potion)" /></g>
        <rect x="31.3" y="31" width="1.4" height="14" fill="#FFC98A" opacity=".9" />
        <path d="M23.5 16 C24 22 28 26 30 28" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" opacity=".9" />
        <rect x="15" y="8" width="34" height="6" rx="2" fill="url(#lg-cap)" />
        <rect x="15" y="50" width="34" height="6" rx="2" fill="url(#lg-cap)" />
        <rect x="17" y="14" width="2.4" height="36" rx="1" fill="#11142A" /><rect x="44.6" y="14" width="2.4" height="36" rx="1" fill="#11142A" />
      </g>
      <path d="M8 46 C14 40 12 34 18 30" stroke="#C9D2EA" strokeWidth="2" fill="none" strokeLinecap="round" opacity=".9" />
      <path d="M56 18 C50 22 52 28 46 32" stroke="#C9D2EA" strokeWidth="2" fill="none" strokeLinecap="round" opacity=".9" />
    </svg>
  );
}
