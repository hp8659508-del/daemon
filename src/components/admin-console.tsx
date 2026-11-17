"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Users, Building2, UserPlus, KeyRound, Shield, MoveRight, History, Play, Pause, RotateCcw, Timer, XCircle, CheckSquare, Gavel, Disc3, Grid3x3, Coins, Sparkles, Layers, Settings2, Minus, Plus, Hammer, Undo2, Search, Check, Eye, EyeOff, Pencil, Trash2, Radio, Swords, Copy, Ban, ScrollText, FileDown, Printer, Zap } from "lucide-react";
import type { World, Activity, StageStatus, Team } from "@/lib/game";
import { useCommand, LiveSync, StatusLed, fmtTime, fmtMins, Empty, useNow, fmtClock } from "@/components/ui";
import BingoBoard from "@/components/bingo-board";
import { useBroadcastSand } from "@/components/sand-clock";
import MemberTiles from "@/components/member-tiles";
import Picker from "@/components/picker";
import RapidFireAdmin from "@/components/rapid-fire-admin";
import RoundLedgers from "@/components/round-ledger";
import { buildLedger } from "@/lib/ledger";
import { HistoryFeed } from "@/components/team-arena";
import { LETTERS } from "@/lib/bingo-shared";
import { KINDS, PHASES, PERKS, effectText, kindLabel, boxName, type CardKind, type CardEffect } from "@/lib/cards";
import { sendLotFeed } from "@/lib/realtime";
import { VENUES, UNASSIGNED, scopeWorld, venueKey, venueLabel } from "@/lib/venues";

type Tab = "stages" | "quiz" | "cards" | "auction" | "spin" | "bingo" | "points" | "powerups" | "history" | "teams" | "event" | "staff";
const TABS: { key: Tab; label: string; icon: typeof Gavel }[] = [
  { key: "stages", label: "Rounds", icon: Layers },
  { key: "quiz", label: "Rapid Fire", icon: Zap },
  { key: "auction", label: "Auction", icon: Gavel },
  { key: "spin", label: "Spin", icon: Disc3 },
  { key: "bingo", label: "Bingo", icon: Grid3x3 },
  { key: "points", label: "Points", icon: Coins },
  { key: "powerups", label: "Power-ups", icon: Sparkles },
  { key: "history", label: "History", icon: History },
  { key: "teams", label: "Teams", icon: Building2 },
  { key: "event", label: "Clock & event", icon: Settings2 },
  { key: "staff", label: "Staff", icon: Shield },
];

type Cmd = ReturnType<typeof useCommand>;
export type StaffInfo = { isHost: boolean; venue: string | null; email: string };
type Ctx = { w: World; full: World; cmd: Cmd; paddle: Record<string, number>; stageOf: (t: string, a: Activity) => StageStatus; staff: StaffInfo; scope: string | null; vkey: string };

export default function AdminConsole({ w: full, staff }: { w: World; staff: StaffInfo }) {
  const cmd = useCommand();
  const [tab, setTab] = useState<Tab>("stages");
  // Hosts can look at one venue at a time; venue admins are already scoped by the server.
  const [scope, setScope] = useState<string | null>(staff.venue);
  useEffect(() => { try { const s = localStorage.getItem("dh-scope"); if (staff.isHost && s !== null) setScope(s || null); } catch {} }, [staff.isHost]);
  const pickScope = (v: string | null) => { setScope(v); try { localStorage.setItem("dh-scope", v ?? ""); } catch {} };
  const w = useMemo(() => (staff.isHost ? scopeWorld(full, scope) : full), [full, scope, staff.isHost]);
  const vkey = venueKey(scope);
  const paddle = useMemo(() => Object.fromEntries(full.teams.map((t, i) => [t.id, t.paddle ?? i + 1])), [full.teams]);
  const visibleTabs = TABS.filter(t => staff.isHost || t.key !== "staff");

  const stageOf = (t: string, a: Activity) => (w.stages.find(s => s.team_id === t && s.activity === a)?.status ?? "upcoming") as StageStatus;
  const ctx: Ctx = { w, full, cmd, paddle, stageOf, staff, scope, vkey };
  const liveCount = (a: Activity) => w.stages.filter(s => s.activity === a && s.status === "live").length;

  // Keyboard: 1–8 switch tabs (ignored while typing)
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,select")) return;
      const list = TABS.filter(t => staff.isHost || t.key !== "staff"); const n = Number(e.key); if (n >= 1 && n <= list.length) setTab(list[n - 1].key);
    };
    window.addEventListener("keydown", on); return () => window.removeEventListener("keydown", on);
  }, [staff.isHost]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Control room · {venueLabel(scope)} · {w.teams.length} teams · {staff.isHost ? "host" : "venue admin"}</p>
          <h1 className="font-display text-5xl">Daemon Hour <span className="text-faint">/ Live</span></h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(["quiz", "auction", "spin", "bingo"] as Activity[]).map(a => <span key={a} className="chip"><StatusLed status={liveCount(a) ? "live" : "closed"} /> {a} · {liveCount(a)}</span>)}
          <LiveSync tables={["team_ledger", "team_cards", "penalties", "teams", "auction_items", "transactions", "purchases", "team_stages", "team_powerups", "team_bingo", "activity_log", "event_settings", "team_members", "help_requests"]} every={20000} />
        </div>
      </header>

      {staff.isHost && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow mr-1">Venue</span>
          {[null, ...VENUES, UNASSIGNED].map(v => {
            const n = v === null ? full.teams.length : full.teams.filter(t => (v === UNASSIGNED ? !t.bay : t.bay === v)).length;
            return <button key={v ?? "all"} className="key key-sm" data-on={scope === v} onClick={() => pickScope(v)}>{venueLabel(v)} <span className="num opacity-60">{n}</span></button>;
          })}
        </div>
      )}
      {w.help.length > 0 && (
        <div className="panel foil flex flex-wrap items-center gap-2 p-3">
          <span className="chip"><span className="led led-live" style={{ background: "#C23B22" }} /> {w.help.length} team{w.help.length > 1 ? "s" : ""} need help</span>
          {w.help.map(h => {
            const t = full.teams.find(x => x.id === h.team_id);
            const mins = Math.max(0, Math.round((Date.now() - new Date(h.created_at).getTime()) / 60000));
            return (
              <span key={h.id} className="flex items-center gap-2 border border-graphite bg-white px-2 py-1 text-xs">
                <b>#{String(paddle[h.team_id] ?? "?").padStart(2, "0")} {t?.team_name}</b>{t?.bay && <span className="text-faint">{t.bay}</span>}
                {h.message && <span className="max-w-[220px] truncate text-muted">“{h.message}”</span>}
                <span className="num text-faint">{mins}m</span>
                <button className="key key-sm !py-0.5" onClick={() => cmd.run({ action: "help_resolve", id: h.id })}>Done</button>
              </span>
            );
          })}
        </div>
      )}
      <div className="rail" role="tablist">
        {visibleTabs.map((t, i) => { const I = t.icon; return (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} title={`Shortcut: ${i + 1}`}><I size={15} />{t.label}</button>
        ); })}
      </div>

      <div key={tab} className="animate-rise">
        {tab === "stages" && <Stages {...ctx} />}
        {tab === "quiz" && <RapidFireAdmin w={w} cmd={cmd} paddle={paddle} isHost={staff.isHost} />}
        {tab === "auction" && <Auction {...ctx} />}
        {tab === "spin" && <Spin {...ctx} />}
        {tab === "bingo" && <Bingo {...ctx} />}
        {tab === "points" && <Points {...ctx} />}
        {tab === "powerups" && <Powerups {...ctx} />}
        {tab === "history" && <HistoryTab {...ctx} />}
        {tab === "teams" && <TeamsTab {...ctx} />}
        {tab === "event" && <EventPanel {...ctx} />}
        {tab === "staff" && staff.isHost && <StaffTab {...ctx} />}
      </div>
      <SandSync s={full.settings} />
      {cmd.toasts}
    </div>
  );
}

/* ============================ shared pickers ============================ */
function TeamPicker({ w, paddle, value, onChange, filter, balanceOf, wallet }: { w: World; paddle: Record<string, number>; value: string; onChange: (id: string) => void; filter?: (t: Team) => boolean; balanceOf?: boolean; wallet?: "auction" }) {
  const [q, setQ] = useState("");
  const list = w.teams.filter(t => (!filter || filter(t)) && (q === "" || t.team_name.toLowerCase().includes(q.toLowerCase()) || String(paddle[t.id]) === q.trim()));
  return (
    <div>
      <div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" /><input className="field pl-9" placeholder="Search a team or type a paddle number" value={q} onChange={e => setQ(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && list[0]) { onChange(list[0].id); setQ(""); } }} /></div>
      <div className="mt-2 grid max-h-64 gap-1.5 overflow-auto pr-1 sm:grid-cols-2">
        {list.map(t => (
          <button key={t.id} onClick={() => onChange(t.id)} className="key key-sm justify-start" data-on={value === t.id}>
            <span className="num w-6 text-left text-faint">{String(paddle[t.id]).padStart(2, "0")}</span>
            <span className="min-w-0 flex-1 truncate text-left">{t.team_name}</span>
            {balanceOf && <span className="num text-faint" title={wallet === "auction" ? "Auction points left" : "Points"}>{wallet === "auction" ? (w.auctionBalances[t.id] ?? w.auctionBudget) : (w.balances[t.id] ?? 0)}</span>}
            {value === t.id && <Check size={13} className="text-cobalt-ink" />}
          </button>
        ))}
        {list.length === 0 && <p className="text-sm text-muted">No teams match.</p>}
      </div>
    </div>
  );
}

function MultiTeams({ w, paddle, selected, setSelected, stageFilter }: { w: World; paddle: Record<string, number>; selected: Set<string>; setSelected: (s: Set<string>) => void; stageFilter?: (t: Team) => React.ReactNode }) {
  const bays = Array.from(new Set(w.teams.map(t => t.bay).filter(Boolean))) as string[];
  const toggle = (id: string) => { const n = new Set(selected); n.has(id) ? n.delete(id) : n.add(id); setSelected(n); };
  const lastClick = useRef<number | null>(null);
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        <button className="key key-sm" onClick={() => setSelected(new Set(w.teams.map(t => t.id)))}><CheckSquare size={12} /> Select all ({w.teams.length})</button>
        <button className="key key-sm" disabled={!selected.size} onClick={() => setSelected(new Set())}><XCircle size={12} /> Clear selection</button>
        {bays.map(b => <button key={b} className="key key-sm" onClick={() => setSelected(new Set(w.teams.filter(t => t.bay === b).map(t => t.id)))}>{b}</button>)}
        <span className="ml-auto self-center text-xs text-muted"><b className="num text-graphite">{selected.size}</b> selected · shift-click selects a range</span>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
        {w.teams.map((t, i) => (
          <button key={t.id} className="key key-sm justify-start" data-on={selected.has(t.id)} onClick={e => {
            if (e.shiftKey && lastClick.current != null) {
              const [a, b] = [lastClick.current, i].sort((x, y) => x - y); const n = new Set(selected);
              w.teams.slice(a, b + 1).forEach(x => n.add(x.id)); setSelected(n);
            } else toggle(t.id);
            lastClick.current = i;
          }}>
            <span className={`grid h-4 w-4 place-items-center rounded border ${selected.has(t.id) ? "border-cobalt-ink bg-cobalt text-white" : "border-silver bg-white"}`}>{selected.has(t.id) && <Check size={10} />}</span>
            <span className="num w-5 text-faint">{String(paddle[t.id]).padStart(2, "0")}</span>
            <span className="min-w-0 flex-1 truncate text-left">{t.team_name}</span>
            {t.bay && <span className="text-[10px] text-faint">{t.bay}</span>}
            {stageFilter?.(t)}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ============================ ROUNDS ============================ */
function Stages({ w, cmd, paddle, stageOf }: Ctx) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [act, setAct] = useState<Activity | "all">("auction");
  const [amount, setAmount] = useState("100");
  const [reason, setReason] = useState("");
  const set = (status: StageStatus) => {
    if (status === "closed" && !confirm(`Close ${act === "all" ? "ALL rounds" : act} for ${sel.size} team(s)? Their tab freezes into a read-only record.`)) return;
    if (status === "upcoming" && !confirm(`Reset ${act === "all" ? "ALL rounds" : act} to upcoming for ${sel.size} team(s)? Closed records for that round are cleared (points stay).`)) return;
    cmd.run({ action: "stage", team_ids: [...sel], activity: act, status });
  };
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
      <div className="panel p-5">
        <div className="mb-4 flex items-center justify-between"><h2 className="font-display text-lg font-bold">Who is playing what</h2>
          <div className="flex gap-3 text-xs text-muted"><span className="flex items-center gap-1"><StatusLed status="upcoming" />upcoming</span><span className="flex items-center gap-1"><StatusLed status="live" />live</span><span className="flex items-center gap-1"><StatusLed status="closed" />closed</span></div></div>
        <MultiTeams w={w} paddle={paddle} selected={sel} setSelected={setSel}
          stageFilter={t => <span className="flex gap-1">{(["quiz", "auction", "spin", "bingo"] as Activity[]).map(a => <StatusLed key={a} status={stageOf(t.id, a)} />)}</span>} />
        <p className="mt-3 text-[11px] text-faint">The three lights on each team show auction · spin · bingo, in that order.</p>
      </div>
      <div className="space-y-5">
        <div className="panel foil p-5">
          <p className="eyebrow">Apply to {sel.size} selected</p>
          <div className="rail mt-3">{(["quiz", "auction", "spin", "bingo", "all"] as const).map(a => <button key={a} aria-selected={act === a} onClick={() => setAct(a)}>{a === "all" ? "All of round 2" : a === "quiz" ? "Rapid Fire" : a}</button>)}</div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <button className="key" disabled={!sel.size || cmd.busy} onClick={() => set("upcoming")}><RotateCcw size={13} /> Reset</button>
            <button className="key-primary" disabled={!sel.size || cmd.busy} onClick={() => set("live")}>Open</button>
            <button className="key" disabled={!sel.size || cmd.busy} onClick={() => set("closed")}>Close</button>
          </div>
          <p className="mt-3 text-xs leading-5 text-muted">Open makes the round live. Close freezes it into a record with points and deadline. Reset puts it back to upcoming. Pick <b>All rounds</b> to do all three at once.</p>
        </div>
        <div className="panel p-5">
          <p className="eyebrow">Give points to {sel.size} selected</p>
          <div className="mt-3 grid grid-cols-4 gap-2">{[-50, 50, 100, 250].map(n => <button key={n} className="key key-sm num" data-on={String(n) === amount} onClick={() => setAmount(String(n))}>{n > 0 ? "+" : ""}{n}</button>)}</div>
          <div className="mt-2 grid grid-cols-[96px_1fr] gap-2"><input className="field num" type="number" value={amount} onChange={e => setAmount(e.target.value)} /><input className="field" placeholder="Reason (teams see this)" value={reason} onChange={e => setReason(e.target.value)} /></div>
          <button className="key-primary mt-3 w-full" disabled={!sel.size || !Number(amount) || cmd.busy} onClick={() => {
            const n = Number(amount); if (!confirm(`${n > 0 ? "Give" : "Deduct"} ${Math.abs(n)} pts ${n > 0 ? "to" : "from"} ${sel.size} team(s)?`)) return;
            cmd.run({ action: "grant", team_ids: [...sel], amount: n, reason: reason || (n > 0 ? "Organiser bonus" : "Organiser deduction") });
          }}><Coins size={15} /> Apply to {sel.size} team(s)</button>
        </div>
        <div className="panel p-5">
          <p className="eyebrow">Round board</p>
          <div className="mt-3 space-y-2 text-sm">{(["quiz", "auction", "spin", "bingo"] as Activity[]).map(a => {
            const c = (s: StageStatus) => w.teams.filter(t => stageOf(t.id, a) === s).length;
            return <div key={a} className="well flex items-center justify-between px-3 py-2"><span className="capitalize font-semibold">{a}</span><span className="num text-xs text-muted">{c("upcoming")} up · <b className="text-ok">{c("live")} live</b> · {c("closed")} done</span></div>;
          })}</div>
        </div>
      </div>
    </div>
  );
}

/* ============================ AUCTION ============================ */
function Auction({ w, cmd, paddle, stageOf, vkey, scope }: Ctx) {
  const myLot = w.settings.live_lots?.[vkey] ?? null;
  const items = w.items.filter(i => i.pool !== "spin");
  const soldOf = (id: string) => w.lotSales.filter(p => p.item_id === id).length;
  const buyersOf = (id: string) => w.lotSales.filter(p => p.item_id === id).map(p => p.team_name);
  const [cell, setCell] = useState<number | null>(null);
  const [itemId, setItemId] = useState<string>(myLot?.item_id ?? items.find(i => i.is_active)?.id ?? "");
  const item = items.find(i => i.id === itemId) ?? null;
  const min = item?.min_price ?? 0, max = item?.max_price ?? Math.max(item?.base_points ?? 0, 1) * 10, step = item?.price_step ?? 10;
  const [price, setPrice] = useState<number>(myLot?.item_id === itemId ? myLot.price : item?.base_points ?? min);
  const [team, setTeam] = useState("");
  const [onlyLive, setOnlyLive] = useState(true);
  const [editing, setEditing] = useState<Partial<World["items"][number]> | null>(null);
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  // Push the lot + price to team screens (debounced)
  const pushT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveTeams = w.teams.filter(t => stageOf(t.id, "auction") === "live").map(t => t.id);
  // 1) instant: websocket feed to every screen in this venue (~100 ms)
  // 2) durable: quiet DB save 250 ms after the last change (for screens that load later)
  const persistLot = (lot: { item_id: string; price: number } | null) =>
    fetch("/api/control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "live_lot", venue: vkey === "all" ? "" : vkey, lot }) }).catch(() => null);
  const broadcast = (id: string, p: number) => {
    sendLotFeed({ venue: vkey, item_id: id, price: p });
    if (pushT.current) clearTimeout(pushT.current);
    pushT.current = setTimeout(() => persistLot({ item_id: id, price: p }), 250);
  };
  const choose = (id: string) => { const it = items.find(i => i.id === id); setItemId(id); const p = it?.min_price ?? it?.base_points ?? 0; setPrice(p); setTeam(""); setCell(null); broadcast(id, p); };
  const bump = (d: number) => { const p = clamp(price + d); setPrice(p); if (item) broadcast(item.id, p); };
  const bal = team ? (w.auctionBalances[team] ?? w.auctionBudget) : 0;   // auction wallet, not main points
  const needsCell = item?.kind === "bingo" && item.effect?.mode !== "column";
  const teamMarks = new Set(w.marks.filter(m => m.team_id === team).map(m => m.idx));
  const sell = async () => {
    if (!item || !team) return;
    const t = w.teams.find(x => x.id === team);
    if (needsCell && cell === null) { cmd.toast("Pick the bingo box first"); return; }
    if (!confirm(`SOLD: ${item.item_name} to ${t?.team_name} for ${price} pts?${needsCell && cell !== null ? `\nCovers box ${boxName(cell)}.` : ""}`)) return;
    const r = await cmd.run({ action: "sell", item_id: item.id, team_id: team, price, cell });
    if (r) { setTeam(""); setCell(null); }
  };
  const sales = w.purchases.slice(0, 12);
  const name = (id: string) => w.teams.find(t => t.id === id)?.team_name ?? "?";

  return (
    <div className="grid gap-5 xl:grid-cols-[300px_1fr_360px]">
      {/* Lots */}
      <div className="panel p-4">
        <div className="mb-3 flex items-center justify-between"><h2 className="font-display font-bold">Cards</h2><button className="key key-sm" onClick={() => setEditing({ price_step: 10, quantity: 1, is_active: true, kind: "note", effect: { phase: "other", perk: "none" } })}><Plus size={13} />New</button></div>
        <div className="space-y-1.5">
          {items.length === 0 && <Empty title="No lots">Create the first one.</Empty>}
          {items.map(i => { const s = soldOf(i.id); const by = buyersOf(i.id); return (
            <div key={i.id} className={`flex items-center gap-1 ${i.is_active ? "" : "opacity-50"}`}>
              <button className="key key-sm min-w-0 flex-1 !justify-start !normal-case !tracking-normal" data-on={itemId === i.id} onClick={() => choose(i.id)} title={effectText(i.kind, i.effect)}>
                <span className="min-w-0 flex-1 truncate text-left">{i.item_name}</span>
                {s >= i.quantity ? <span className="max-w-[90px] shrink-0 truncate text-[10px] font-bold text-ok">{by.join(", ")}</span> : null}
              </button>
              <button className="key key-sm" title="Edit / copy / delete" onClick={() => setEditing(i)}><Pencil size={12} /></button>
            </div>); })}
        </div>
      </div>

      {/* The block */}
      <div className="panel foil p-6">
        {!item ? <Empty title="Pick a lot">Choose a lot on the left. It appears on the screens of teams whose auction is live.</Empty> : <>
          <div className="flex items-start justify-between gap-3">
            <div><p className="eyebrow">On the block</p><h2 className="font-display mt-1 text-3xl font-black">{item.item_name}</h2>
              <p className="mt-1 text-sm text-muted"><b className="text-graphite">{kindLabel(item.kind)}</b> · {effectText(item.kind, item.effect)} · range <span className="num">{min}–{max}</span> · step <span className="num">{step}</span></p>
              {soldOf(item.id) >= item.quantity && <p className="mt-1 text-sm font-semibold text-ok">Sold to {buyersOf(item.id).join(", ")} — use Copy for another slot</p>}</div>
            <span className="chip"><Radio size={11} className="text-ok" /> {venueLabel(scope)} screens</span>
          </div>
          <div className="mt-6 grid items-center gap-4 sm:grid-cols-[auto_1fr_auto]">
            <div className="flex flex-col gap-2"><button className="key" onClick={() => bump(-step * 5)}>−{step * 5}</button><button className="key key-lg" onClick={() => bump(-step)}><Minus size={18} /></button></div>
            <div className="lcd px-6 py-5 text-center"><p className="text-[10px] font-bold uppercase tracking-[.25em] opacity-70">Current price</p><p className="text-7xl font-bold leading-none">{price}</p></div>
            <div className="flex flex-col gap-2"><button className="key" onClick={() => bump(step * 5)}>+{step * 5}</button><button className="key key-lg" onClick={() => bump(step)}><Plus size={18} /></button></div>
          </div>
          <input type="range" className="mt-5 w-full accent-[#5878D8]" min={min} max={max} step={step} value={price} onChange={e => { const p = Number(e.target.value); setPrice(p); broadcast(item.id, p); }} />
          <div className="mt-1 flex justify-between text-[10px] text-faint num"><span>{min}</span><span>{max}</span></div>
          {needsCell && (
            <div className="mt-5">
              <p className="eyebrow mb-2">Box this card covers {team ? `on ${name(team)}'s sheet` : "(pick the winner first)"}</p>
              <div className="grid max-w-[260px] grid-cols-5 gap-1">
                {Array.from({ length: 25 }, (_, i) => { const c = w.cells.find(x => x.idx === i); const off = !team || c?.is_free || teamMarks.has(i); return (
                  <button key={i} type="button" disabled={off} title={c?.label} onClick={() => setCell(i)} className="key key-sm !px-0 num" data-on={cell === i}>{c?.is_free ? "★" : teamMarks.has(i) ? "✓" : boxName(i)}</button>); })}
              </div>
            </div>
          )}
          <div className="mt-6 flex items-center gap-3">
            <div className="well flex-1 px-4 py-3 text-sm">{team ? <>Winner <b>#{paddle[team]} {name(team)}</b> · auction wallet <span className={`num font-bold ${bal >= price ? "text-ok" : "text-err"}`}>{bal}</span></> : <span className="text-muted">Select the winning paddle →</span>}</div>
            <button className="key-primary key-lg" disabled={!team || cmd.busy || bal < price || soldOf(item.id) >= item.quantity || (needsCell && cell === null)} onClick={sell}><Hammer size={18} /> Sold</button>
          </div>
          <button className="key key-sm mt-3" onClick={() => { sendLotFeed({ venue: vkey, item_id: null, price: 0 }); if (pushT.current) clearTimeout(pushT.current); persistLot(null); cmd.toast("Lot cleared from screens"); }}>Clear lot from {venueLabel(scope)} screens</button>
        </>}
      </div>

      {/* Winner + sales */}
      <div className="space-y-5">
        <div className="panel p-4">
          <div className="mb-2 flex items-center justify-between"><h3 className="font-display font-bold">Winning paddle</h3>
            <label className="flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" checked={onlyLive} onChange={e => setOnlyLive(e.target.checked)} /> live only</label></div>
          <TeamPicker w={w} paddle={paddle} value={team} onChange={id => { setTeam(id); setCell(null); }} balanceOf wallet="auction" filter={onlyLive ? t => stageOf(t.id, "auction") === "live" : undefined} />
        </div>
        <div className="panel p-4">
          <h3 className="font-display mb-2 font-bold">Recent sales</h3>
          {sales.length === 0 ? <p className="text-sm text-muted">No sales yet.</p> : sales.map(s => (
            <div key={s.id} className="table-row flex items-center gap-2 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate"><b>{name(s.team_id)}</b> · {items.find(i => i.id === s.item_id)?.item_name}</span>
              <span className="num">{s.purchase_price}</span>
              <button className="key key-sm" title="Void sale: refund points and undo the card's effects" onClick={() => confirm("Void this sale? Points are refunded and the card's effects (time, points, bingo boxes) are undone.") && cmd.run({ action: "undo_sale", id: s.id })}><Ban size={12} /> Void</button>
            </div>
          ))}
        </div>
      </div>

      {editing && <ItemEditor w={w} cmd={cmd} item={editing} close={() => setEditing(null)} />}
    </div>
  );
}

function ItemEditor({ cmd, item, close }: { w: World; cmd: Cmd; item: Partial<World["items"][number]>; close: () => void }) {
  const [f, setF] = useState({ item_name: item.item_name ?? "", description: item.description ?? "", base_points: String(item.base_points ?? 100), min_price: item.min_price?.toString() ?? "", max_price: item.max_price?.toString() ?? "", price_step: String(item.price_step ?? 10) });
  const spin = item.pool === "spin";
  const [kind, setKind] = useState<CardKind>((item.kind as CardKind) ?? "note");
  const e0 = (item.effect ?? {}) as CardEffect;
  const [fx, setFx] = useState({ minutes: String(e0.minutes ?? 15), amount: String(e0.amount ?? 10), mode: e0.mode ?? "cell", column: String(e0.column ?? 0), phase: e0.phase ?? "other", perk: e0.perk ?? "none" });
  const up = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const ux = (k: keyof typeof fx) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setFx({ ...fx, [k]: e.target.value });
  const effect = kind === "time" ? { minutes: Number(fx.minutes) } : kind === "points" ? { amount: Number(fx.amount) } : kind === "bingo" ? (fx.mode === "column" ? { mode: "column", column: Number(fx.column) } : { mode: "cell" }) : kind === "note" ? { phase: fx.phase, perk: fx.perk } : {};
  return (
    <Modal title={spin ? (item.id ? "Edit wheel segment" : "New wheel segment") : item.id ? "Edit card" : "New card"} close={close}>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={async e => { e.preventDefault(); if (await cmd.run({ action: "item_save", id: item.id, ...f, kind, effect, pool: spin ? "spin" : "auction", is_active: item.is_active ?? true })) close(); }}>
        <L t="Name" c="sm:col-span-2"><input className="field" required value={f.item_name} onChange={up("item_name")} placeholder="+15 min" /></L>
        <L t="Description (teams see this)" c="sm:col-span-2"><input className="field" value={f.description} onChange={up("description")} /></L>
        <div className="sm:col-span-2">
          <p className="mb-1.5 text-xs font-semibold text-muted">Card type</p>
          <div className="seg">{KINDS.filter(k => !spin || ["time", "points", "note"].includes(k.key)).map(k => <button key={k.key} type="button" data-on={kind === k.key} title={k.hint} onClick={() => setKind(k.key)}>{k.label}</button>)}</div>
          <p className="mt-1.5 text-xs text-faint">{KINDS.find(k => k.key === kind)?.hint}</p>
        </div>
        {kind === "time" && <L t="Minutes (+ adds, − removes)"><input className="field num" type="number" required value={fx.minutes} onChange={ux("minutes")} /></L>}
        {kind === "points" && <L t="Auction points"><input className="field num" type="number" required value={fx.amount} onChange={ux("amount")} /></L>}
        {kind === "bingo" && <>
          <div className="sm:col-span-2"><p className="mb-1.5 text-xs font-semibold text-muted">What it does</p>
            <div className="seg"><button type="button" data-on={fx.mode === "cell"} onClick={() => setFx({ ...fx, mode: "cell" })}>Covers one box</button><button type="button" data-on={fx.mode === "column"} onClick={() => setFx({ ...fx, mode: "column" })}>Completes a column</button></div></div>
          {fx.mode === "column" && <div className="sm:col-span-2"><p className="mb-1.5 text-xs font-semibold text-muted">Column</p>
            <div className="seg">{LETTERS.map((l, i) => <button key={l} type="button" data-on={fx.column === String(i)} onClick={() => setFx({ ...fx, column: String(i) })}>{l}</button>)}</div></div>}
        </>}
        {kind === "note" && <>
          <div className="sm:col-span-2"><p className="mb-1.5 text-xs font-semibold text-muted">When it applies</p>
            <div className="seg">{PHASES.map(p => <button key={p.key} type="button" data-on={fx.phase === p.key} onClick={() => setFx({ ...fx, phase: p.key })}>{p.label}</button>)}</div></div>
          {!spin && <div className="sm:col-span-2"><p className="mb-1.5 text-xs font-semibold text-muted">Tracked rule</p>
            <div className="seg">{PERKS.map(p => <button key={p.key} type="button" data-on={fx.perk === p.key} title={p.hint} onClick={() => setFx({ ...fx, perk: p.key })}>{p.label}</button>)}</div>
            <p className="mt-1.5 text-xs text-faint">{PERKS.find(p => p.key === fx.perk)?.hint}</p></div>}
        </>}
        {!spin && <>
        <L t="Opening price"><input className="field num" type="number" required value={f.base_points} onChange={up("base_points")} /></L>
        <L t="Step"><input className="field num" type="number" min={1} value={f.price_step} onChange={up("price_step")} /></L>
        <L t="Minimum"><input className="field num" type="number" value={f.min_price} onChange={up("min_price")} placeholder="none" /></L>
        <L t="Maximum"><input className="field num" type="number" value={f.max_price} onChange={up("max_price")} placeholder="none" /></L>
        <p className="text-xs text-faint sm:col-span-2">Each card sells once. Use <b>Copy slot</b> to open another.</p>
        </>}
        <div className="flex flex-wrap justify-end gap-2 sm:col-span-2">
          {item.id && <>
            {!spin && <button type="button" className="key key-sm mr-auto" title="Open another slot of this card" onClick={async () => { if (await cmd.run({ action: "item_copy", id: item.id })) close(); }}><Copy size={12} /> Copy slot</button>}
            <button type="button" className="key key-sm" onClick={async () => { if (await cmd.run({ action: "item_toggle", id: item.id, is_active: !item.is_active })) close(); }}>{item.is_active ? <><EyeOff size={12} /> Hide</> : <><Eye size={12} /> Show</>}</button>
            <button type="button" className="key-danger key-sm" onClick={async () => { if (confirm(`Delete "${item.item_name}"? If it was sold, the sale is voided and points refunded.`) && await cmd.run({ action: "item_delete", id: item.id })) close(); }}><Trash2 size={12} /> Delete</button>
          </>}
          <button type="button" className="key" onClick={close}>Cancel</button><button className="key-primary" disabled={cmd.busy}>Save card</button>
        </div>
      </form>
    </Modal>
  );
}

/* ============================ CARDS & EVAL ============================ */
const STATUS_TONE: Record<string, string> = { applied: "text-ok", held: "text-cobalt-ink", spent: "text-faint line-through", pending: "text-err", resolved: "text-faint" };
function TeamCards({ t, w, full, cmd, paddle, match }: { t: Team; w: World; full: World; cmd: Cmd; paddle: Record<string, number>; match: (c: World["cards"][number]) => boolean }) {
  const cards = w.cards.filter(c => c.team_id === t.id);
  const shown = cards.filter(match);
  const pens = w.penalties.filter(p => p.team_id === t.id || p.landed_team_id === t.id);
  const [ps, setPs] = useState(t.problem_statement ?? "");
  useEffect(() => setPs(t.problem_statement ?? ""), [t.problem_statement]);
  const name = (id: string | null) => full.teams.find(x => x.id === id)?.team_name ?? "—";
  return (
    <div className="panel p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-display text-lg font-black">#{String(paddle[t.id] ?? "?").padStart(2, "0")} {t.team_name}</h3>
        <span className="text-xs text-muted">{t.bay ?? "No venue"} · <span className="num font-bold text-graphite">{w.balances[t.id] ?? 0}</span> pts</span>
      </div>
      <div className="mt-3">
        <p className="eyebrow mb-1">Problem statement {t.ps_locked && <span className="text-ok">· final (swapped)</span>}</p>
        {t.ps_locked ? <p className="well p-2 text-sm">{t.problem_statement}</p> : (
          <div className="flex gap-2"><input className="field flex-1 text-sm" placeholder="Type it once the team draws it" value={ps} onChange={e => setPs(e.target.value)} />
            <button className="key key-sm" disabled={ps === (t.problem_statement ?? "")} onClick={() => cmd.run({ action: "ps_set", team_id: t.id, text: ps })}>Save</button></div>
        )}
      </div>
      {cards.length === 0 ? <p className="mt-3 text-sm text-muted">No cards yet.</p> : (["auction", "spin"] as const).map(round => {
        const rows = shown.filter(c => (round === "spin" ? c.source === "spin" : c.source !== "spin"));
        if (!rows.length) return null;
        return (
          <div key={round} className="mt-4">
            <p className="eyebrow mb-2">{round === "spin" ? "Spin wheel" : "Auction"} · {rows.length}</p>
            <div className="overflow-x-auto rounded-lg border border-silver/70">
              <table className="ledger cards-table">
                <thead><tr><th>Received</th><th>Card</th><th>Type</th><th>What it does</th><th>Status</th></tr></thead>
                <tbody>
                  {rows.map(c => (
                    <tr key={c.id}>
                      <td className="num whitespace-nowrap text-muted">{new Date(c.created_at).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })}</td>
                      <td className="font-semibold">{c.name}{c.source === "trump" && <span className="font-normal text-faint"> (via trump)</span>}
                        {c.kind === "trump" && c.status === "pending" && <TrumpResolve card={c} w={w} full={full} cmd={cmd} teamId={t.id} />}
                        {c.effect?.perk === "swap_ps" && c.status === "held" && <SwapPs card={c} t={t} full={full} cmd={cmd} paddle={paddle} />}
                      </td>
                      <td className="whitespace-nowrap text-xs font-bold uppercase tracking-wider text-muted">{c.kind === "note" ? (PHASES.find(p => p.key === c.effect?.phase)?.label ?? "Note") : kindLabel(c.kind)}</td>
                      <td className="text-muted">{c.detail || effectText(c.kind, c.effect)}</td>
                      <td className={`whitespace-nowrap text-xs font-bold ${STATUS_TONE[c.status] ?? ""}`}>{c.status === "spent" ? "Used" : c.status === "pending" ? "Pick card" : c.status === "resolved" ? "Copied" : c.status === "held" ? "Held" : "Applied"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
      {pens.length > 0 && (
        <div className="mt-3 border-t border-silver/70 pt-2">
          <p className="eyebrow mb-1">Penalties</p>
          {pens.map(p => (
            <p key={p.id} className="text-xs text-muted">
              {p.team_id === t.id ? "" : <>From <b>{name(p.team_id)}</b>: </>}{p.reason} · {[p.minutes ? `−${p.minutes} min` : "", p.points ? `−${p.points} pts` : ""].filter(Boolean).join(" ")} ·{" "}
              <b className={p.outcome === "applied" || (p.outcome === "passed" && p.landed_team_id === t.id) ? "text-err" : "text-ok"}>
                {p.outcome === "applied" ? "taken" : p.outcome === "blocked" ? "blocked" : p.outcome === "passed" ? (p.landed_team_id === t.id ? "received" : `passed to ${name(p.landed_team_id)}`) : "passed & skipped"}
              </b>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function DrawerCards({ t, w, cmd, paddle }: { t: Team; w: World; cmd: Cmd; paddle: Record<string, number> }) {
  const [pen, setPen] = useState({ minutes: "", points: "", reason: "" });
  const issue = async () => {
    if (!pen.reason.trim() || (!Number(pen.minutes) && !Number(pen.points))) { cmd.toast("Enter minutes or points and a reason"); return; }
    if (await cmd.run({ action: "penalty", team_id: t.id, minutes: Number(pen.minutes) || 0, points: Number(pen.points) || 0, reason: pen.reason })) setPen({ minutes: "", points: "", reason: "" });
  };
  return (
    <div className="mt-5">
      <TeamCards t={t} w={w} full={w} cmd={cmd} paddle={paddle} match={() => true} />
      <div className="mt-2 flex flex-wrap gap-2">
        <input className="field !w-20 num !py-1.5" type="number" min={0} placeholder="− min" value={pen.minutes} onChange={e => setPen({ ...pen, minutes: e.target.value })} />
        <input className="field !w-20 num !py-1.5" type="number" min={0} placeholder="− pts" value={pen.points} onChange={e => setPen({ ...pen, points: e.target.value })} />
        <input className="field min-w-[160px] flex-1 !py-1.5" placeholder="Penalty reason" value={pen.reason} onChange={e => setPen({ ...pen, reason: e.target.value })} />
        <button className="key key-sm" disabled={cmd.busy} onClick={issue}>Give penalty</button>
      </div>
    </div>
  );
}

function TrumpResolve({ card, w, full, cmd, teamId }: { card: World["cards"][number]; w: World; full: World; cmd: Cmd; teamId: string }) {
  const [item, setItem] = useState("");
  const [cell, setCell] = useState("");
  const it = full.items.find(i => i.id === item);
  const needsCell = it?.kind === "bingo" && it.effect?.mode !== "column";
  const marks = new Set(w.marks.filter(m => m.team_id === teamId).map(m => m.idx));
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Picker className="min-w-[260px] flex-1" placeholder="Card the team picks…" value={item} onChange={v => { setItem(v); setCell(""); }}
        options={full.items.filter(i => i.kind !== "trump" && i.pool !== "spin").map(i => ({ value: i.id, label: i.item_name, hint: effectText(i.kind, i.effect) }))} />
      {needsCell && <Picker className="min-w-[200px]" placeholder="Box…" value={cell} onChange={setCell}
        options={w.cells.filter(c => !c.is_free).map(c => ({ value: String(c.idx), label: `${boxName(c.idx)} · ${c.label}`, disabled: marks.has(c.idx), hint: marks.has(c.idx) ? "Already stamped" : undefined }))} />}
      <button className="key key-sm" disabled={!item || (needsCell && cell === "") || cmd.busy} onClick={() => confirm(`Turn the trump card into "${it?.item_name}"? Its effect applies now.`) && cmd.run({ action: "trump_resolve", id: card.id, item_id: item, cell: needsCell ? Number(cell) : null })}>Apply</button>
    </div>
  );
}

function SwapPs({ card, t, full, cmd, paddle }: { card: World["cards"][number]; t: Team; full: World; cmd: Cmd; paddle: Record<string, number> }) {
  const [target, setTarget] = useState("");
  const other = full.teams.find(x => x.id === target);
  const options = full.teams.filter(x => x.id !== t.id);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Picker className="min-w-[260px] flex-1" placeholder="Swap with…" value={target} onChange={setTarget}
        options={options.map(x => ({ value: x.id, label: `#${paddle[x.id]} ${x.team_name}`, disabled: !x.problem_statement || x.ps_locked, hint: x.ps_locked ? "Already swapped" : x.problem_statement ? x.problem_statement : "No problem statement yet" }))} />
      {!t.problem_statement && <span className="self-center text-xs text-err">Save this team's problem statement first</span>}
      <button className="key key-sm" disabled={!target || !t.problem_statement || cmd.busy} title={!t.problem_statement ? "Log this team's problem statement first" : ""}
        onClick={() => confirm(`Swap problem statements between ${t.team_name} and ${other?.team_name}? Both become final.`) && cmd.run({ action: "ps_swap", id: card.id, target_id: target })}>Swap</button>
    </div>
  );
}

/* ============================ SPIN ============================ */
function Spin({ w, cmd, paddle, stageOf }: Ctx) {
  const [team, setTeam] = useState("");
  const [seg, setSeg] = useState("");
  const [editing, setEditing] = useState<Partial<World["items"][number]> | null>(null);
  const segments = w.items.filter(i => i.pool === "spin");
  const segment = segments.find(i => i.id === seg);
  const results = w.cards.filter(c => c.source === "spin").slice().reverse().slice(0, 20);
  const name = (id: string | null) => w.teams.find(t => t.id === id)?.team_name ?? "";
  const live = w.teams.filter(t => stageOf(t.id, "spin") === "live");
  const give = async () => { if (await cmd.run({ action: "spin_grant", team_id: team, item_id: seg })) { setTeam(""); setSeg(""); } };
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_1fr_360px]">
      <div className="panel p-5">
        <h2 className="font-display mb-1 font-bold">1 · Who spun?</h2>
        <p className="mb-3 text-xs text-muted">{live.length} team(s) have the spin round open.</p>
        {live.length === 0
          ? <Empty title="No team has Spin open">Open the Spin round for the teams at the wheel under <b>Rounds</b>.</Empty>
          : <TeamPicker w={w} paddle={paddle} value={team} onChange={setTeam} filter={t => stageOf(t.id, "spin") === "live"} />}
      </div>
      <div className="panel p-5">
        <div className="mb-3 flex items-center justify-between"><h2 className="font-display font-bold">2 · Where did it land?</h2>
          <button className="key key-sm" onClick={() => setEditing({ pool: "spin", kind: "points", effect: { amount: 5 }, is_active: true, price_step: 10, base_points: 0 })}><Plus size={13} /> Segment</button></div>
        {segments.length === 0 ? <Empty title="No wheel segments">Run ui_v10_spin_ledger.sql to load the 8 segments.</Empty> :
          <div className="grid grid-cols-2 gap-2">{segments.map(p => (
            <div key={p.id} className="relative">
              <button className="key w-full flex-col items-start !whitespace-normal !normal-case !tracking-normal text-left" data-on={seg === p.id} onClick={() => setSeg(p.id)}>
                <span className="font-semibold">{p.item_name}</span>
                <span className="text-[11px] font-normal text-muted">{kindLabel(p.kind)} · {effectText(p.kind, p.effect)}</span>
              </button>
              <button className="absolute right-1.5 top-1.5 rounded p-1 text-faint hover:bg-frost" title="Edit segment" onClick={() => setEditing(p)}><Pencil size={11} /></button>
            </div>))}</div>}
        <button className="key-primary key-lg mt-4 w-full" disabled={!team || !seg || cmd.busy} onClick={give}><Disc3 size={18} /> Give “{segment?.item_name ?? "…"}” to {name(team) || "…"}</button>
      </div>
      <div className="panel p-4">
        <h3 className="font-display mb-2 font-bold">Spin log</h3>
        {results.length === 0 ? <p className="text-sm text-muted">No spins recorded.</p> : results.map(c => (
          <div key={c.id} className="table-row flex items-center gap-2 py-2 text-sm">
            <span className="min-w-0 flex-1"><b>{name(c.team_id)}</b> → {c.name}{c.detail && <span className="text-muted"> · {c.detail}</span>}</span>
            <button className="key key-sm" title="Remove and undo" onClick={() => confirm(`Remove "${c.name}" from ${name(c.team_id)}? Its effect is undone.`) && cmd.run({ action: "spin_revoke", id: c.id })}><Undo2 size={12} /></button>
          </div>))}
      </div>
      {editing && <ItemEditor w={w} cmd={cmd} item={editing} close={() => setEditing(null)} />}
    </div>
  );
}

/* ============================ BINGO ============================ */
function Bingo({ w, cmd, paddle, stageOf, staff }: Ctx) {
  const [team, setTeam] = useState("");
  const [edit, setEdit] = useState(false);
  // Optimistic stamps: show instantly, reconcile when the server answers.
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const serverMarked = new Set(w.marks.filter(m => m.team_id === team).map(m => m.idx));
  const marked = new Set(serverMarked);
  Object.entries(pending).forEach(([k, on]) => { const [tid, i] = k.split(":"); if (tid === team) { on ? marked.add(+i) : marked.delete(+i); } });
  useEffect(() => { setPending(p => Object.fromEntries(Object.entries(p).filter(([k, on]) => { const [tid, i] = k.split(":"); return tid !== team || serverMarked.has(+i) !== on; }))); }, [w.marks]); // eslint-disable-line react-hooks/exhaustive-deps
  const stamp = async (idx: number) => {
    const key = `${team}:${idx}`; const on = !marked.has(idx);
    setPending(p => ({ ...p, [key]: on }));
    const r = await cmd.run({ action: "bingo_toggle", team_id: team, idx, on }, { quiet: true });
    if (!r) setPending(p => { const n = { ...p }; delete n[key]; return n; });
    else if (r.data?.full) cmd.toast("FULL CARD BINGO!");
  };
  const progress = w.teams.map(t => ({ t, n: w.marks.filter(m => m.team_id === t.id).length })).sort((a, b) => b.n - a.n);
  const [rw, setRw] = useState<Record<string, string>>({ ...Object.fromEntries([...LETTERS, "FULL"].map(k => [k, ""])), ...(w.settings.bingo_rewards ?? {}) });
  const [colBonus, setColBonus] = useState(String(w.settings.bingo_line_bonus));
  const [fullBonus, setFullBonus] = useState(String(w.settings.bingo_full_bonus));
  const tName = w.teams.find(t => t.id === team)?.team_name;
  return (
    <div className="grid gap-5 xl:grid-cols-[320px_1fr_280px]">
      <div className="space-y-5">
        <div className="panel p-4">
          <h2 className="font-display mb-3">Team</h2>
          <TeamPicker w={w} paddle={paddle} value={team} onChange={t => { setTeam(t); setEdit(false); }} filter={t => stageOf(t.id, "bingo") === "live"} />
          <p className="mt-3 text-[11px] text-faint">Only teams whose bingo round is <b>live</b> can be stamped. Open it under Rounds first.</p>
        </div>
        {staff.isHost && <div className="panel p-4">
          <h3 className="font-display mb-2">Rewards & bonuses</h3>
          <div className="grid grid-cols-2 gap-2">
            <L t="Per line (pts)"><input className="field num" type="number" value={colBonus} onChange={e => setColBonus(e.target.value)} /></L>
            <L t="Full card (pts)"><input className="field num" type="number" value={fullBonus} onChange={e => setFullBonus(e.target.value)} /></L>
          </div>
          <div className="mt-3 space-y-2">{[...LETTERS, "FULL"].map(k => (
            <div key={k} className="grid grid-cols-[44px_1fr] items-center gap-2"><span className="font-display grid h-9 place-items-center border border-graphite text-sm">{k === "FULL" ? "★" : k}</span>
              <input className="field" placeholder={k === "FULL" ? "Reward for full card" : `Reward for striking ${k}`} value={rw[k] ?? ""} onChange={e => setRw({ ...rw, [k]: e.target.value })} /></div>))}</div>
          <button className="key-primary mt-3 w-full" onClick={() => cmd.run({ action: "settings", bingo_rewards: rw, bingo_line_bonus: colBonus, bingo_full_bonus: fullBonus })}>Save rewards</button>
          <p className="mt-2 text-[11px] text-faint">Teams see the reward text under each letter. A team's first full row or column locks its direction; only lines in that direction earn this bonus.</p>
        </div>}
      </div>
      <div className="panel p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-2xl">{edit ? "Edit squares" : tName ? `Stamping · ${tName}` : "Bingo board"}</h2>
          {!edit && team && (() => { const m = w.teams.find(x => x.id === team)?.bingo_mode; return <span className={`chip ${m ? "!bg-[#0E0B2B] !text-white" : ""}`}>{m === "rows" ? "Locked: ROWS only" : m === "columns" ? "Locked: COLUMNS only" : "Direction: decided by first full line"}</span>; })()}
          {staff.isHost && <button className="key key-sm" data-on={edit} onClick={() => setEdit(!edit)}><Pencil size={12} />{edit ? "Done editing" : "Edit squares"}</button>}
        </div>
        {edit ? <div className="grid grid-cols-5 gap-2">{w.cells.map(c => <CellEditor key={c.idx} c={c} cmd={cmd} />)}</div>
          : !team ? <Empty title="Choose a team">Tap a square to stamp a dare, and tap again to undo. Completing a column strikes its letter and pays the bonus automatically.</Empty>
          : <BingoBoard cells={w.cells} marked={marked} rewards={w.settings.bingo_rewards} onToggle={stamp} />}
      </div>
      <div className="panel p-4">
        <h3 className="font-display mb-2">Progress</h3>
        <div className="max-h-[560px] space-y-1 overflow-auto">{progress.map(({ t, n }) => (
          <button key={t.id} onClick={() => { setTeam(t.id); setEdit(false); }} className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-frost ${team === t.id ? "bg-frost font-semibold" : ""}`}>
            <span className="min-w-0 flex-1 truncate">{t.team_name}</span>
            <span className="h-1.5 w-16 overflow-hidden border border-graphite bg-white"><span className="block h-full bg-graphite" style={{ width: `${(n / 24) * 100}%` }} /></span>
            <span className="num w-6 text-right text-xs">{n}</span>
          </button>))}</div>
      </div>
    </div>
  );
}
function CellEditor({ c, cmd }: { c: World["cells"][number]; cmd: Cmd }) {
  const [label, setLabel] = useState(c.label); const [pts, setPts] = useState(String(c.points));
  const dirty = label !== c.label || pts !== String(c.points);
  return (
    <div className="flex aspect-square flex-col gap-1 border border-graphite bg-white p-1 shadow-[2px_2px_0_#0E0B2B]">
      <textarea className="min-h-0 flex-1 resize-none bg-frost/50 p-1 text-[10px] leading-tight outline-none" value={label} onChange={e => setLabel(e.target.value)} disabled={c.is_free} />
      <div className="flex gap-1"><input className="num w-full border border-graphite/30 px-1 text-[10px]" value={pts} onChange={e => setPts(e.target.value)} disabled={c.is_free} />
        {dirty && <button className="bg-graphite px-1.5 text-[10px] text-white" onClick={() => cmd.run({ action: "cell_save", idx: c.idx, label, points: pts })}>Save</button>}</div>
    </div>
  );
}

/* ============================ HISTORY ============================ */
function HistoryTab({ w, cmd, paddle, scope }: Ctx) {
  const [team, setTeam] = useState("");
  const [items, setItems] = useState<World["activity"]>(w.activity);
  const [loading, setLoading] = useState(false);
  const name = (id: string | null) => (id ? w.teams.find(t => t.id === id)?.team_name ?? "?" : "Everyone");
  useEffect(() => {
    let alive = true; setLoading(true);
    fetch("/api/control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "activity_for", team_id: team || undefined, venue: scope || undefined }) })
      .then(r => r.json()).then(j => { if (alive && j.data) setItems(j.data); }).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [team, scope, w.activity.length]);
  const sum = (k: "points" | "minutes") => items.reduce((a, i) => a + (i[k] ?? 0), 0);
  const tps = team ? w.teamPowerups.filter(p => p.team_id === team || p.target_team_id === team) : [];
  return (
    <div className="grid gap-5 xl:grid-cols-[320px_1fr]">
      <div className="space-y-5">
        <div className="panel p-4">
          <div className="mb-2 flex items-center justify-between"><h3 className="font-display">Team</h3>{team && <button className="key key-sm" onClick={() => setTeam("")}>All teams</button>}</div>
          <TeamPicker w={w} paddle={paddle} value={team} onChange={setTeam} balanceOf />
        </div>
        {team && (
          <div className="panel foil p-4">
            <p className="eyebrow">{name(team)} · right now</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="well p-3"><p className="eyebrow">Points</p><p className="num text-2xl font-bold">{w.balances[team] ?? 0}</p></div>
              <div className="well p-3"><p className="eyebrow">Time ±</p><p className="num text-2xl font-bold">{fmtMins(tps.reduce((a, p) => a + ((p.target_team_id ? p.target_team_id === team : p.team_id === team) ? p.minutes_delta : 0), 0))}</p></div>
              <div className="well p-3"><p className="eyebrow">Power-ups</p><p className="num text-2xl font-bold">{tps.filter(p => p.team_id === team).length}</p></div>
              <div className="well p-3"><p className="eyebrow">Lots won</p><p className="num text-2xl font-bold">{w.purchases.filter(p => p.team_id === team).length}</p></div>
            </div>
            <div className="mt-3 space-y-1">{tps.map(p => <div key={p.id} className="flex justify-between text-xs"><span className={p.used ? "line-through opacity-60" : ""}>{p.name}{p.target_team_id && p.team_id !== team ? " (on you)" : ""}</span><span className="num">{fmtMins(p.minutes_delta)}</span></div>)}</div>
          </div>
        )}
      </div>
      <div>
        <div className="mb-3 flex items-center justify-between text-xs text-muted"><span>{loading ? "Loading…" : `${items.length} entries · net ${sum("points") >= 0 ? "+" : ""}${sum("points")} pts`}</span></div>
        <HistoryFeed items={items} teamName={team ? undefined : name} />
      </div>
    </div>
  );
}

/* ============================ POINTS ============================ */
function Points({ w, cmd, paddle }: Ctx) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [amount, setAmount] = useState("100");
  const [reason, setReason] = useState("");
  const name = (id: string) => w.teams.find(t => t.id === id)?.team_name ?? "?";
  const go = () => {
    const n = Number(amount);
    if (!confirm(`${n > 0 ? "Give" : "Deduct"} ${Math.abs(n)} pts ${n > 0 ? "to" : "from"} ${sel.size} team(s)?`)) return;
    cmd.run({ action: "grant", team_ids: [...sel], amount: n, reason: reason || (n > 0 ? "Organiser bonus" : "Organiser deduction") });
  };
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
      <div className="panel p-5"><MultiTeams w={w} paddle={paddle} selected={sel} setSelected={setSel} stageFilter={t => <span className="num text-[11px] text-faint">{w.balances[t.id] ?? 0}</span>} /></div>
      <div className="space-y-5">
        <div className="panel foil p-5">
          <p className="eyebrow">Points to {sel.size} team(s)</p>
          <div className="mt-3 grid grid-cols-4 gap-2">{[-100, -50, 50, 100, 200, 250, 500, 1000].map(n => <button key={n} className="key key-sm num" data-on={String(n) === amount} onClick={() => setAmount(String(n))}>{n > 0 ? "+" : ""}{n}</button>)}</div>
          <div className="mt-3 grid grid-cols-[120px_1fr] gap-2"><input className="field num" type="number" value={amount} onChange={e => setAmount(e.target.value)} /><input className="field" placeholder="Reason (shown to teams)" value={reason} onChange={e => setReason(e.target.value)} /></div>
          <button className="key-primary mt-3 w-full" disabled={!sel.size || !Number(amount) || cmd.busy} onClick={go}><Coins size={16} /> Apply</button>
          {sel.size > 0 && (
            <div className="mt-3 flex gap-2 border-t border-graphite/20 pt-3">
              <button className="key key-sm flex-1 text-xs" disabled={cmd.busy} onClick={() => {
                const pin = window.prompt(`Reset points to 0 for ${sel.size} team(s)? Enter PIN:`, "");
                if (pin) cmd.run({ action: "reset", pin, parts: ["points"], team_ids: [...sel] });
              }}>Reset to 0 pts</button>
              <button className="key key-sm flex-1 text-xs" disabled={cmd.busy} onClick={() => {
                const pin = window.prompt(`Reset to starting points for ${sel.size} team(s)? Enter PIN:`, "");
                if (pin) cmd.run({ action: "reset", pin, parts: ["points", "starting_points"], team_ids: [...sel] });
              }}>Reset to starting pts</button>
            </div>
          )}
        </div>
        <div className="panel p-4">
          <h3 className="font-display mb-2 font-bold">Recent ledger</h3>
          <div className="max-h-[420px] overflow-auto">{w.txs.slice(0, 40).map(t => (
            <div key={t.id} className="table-row flex items-center gap-2 py-1.5 text-xs">
              <span className="min-w-0 flex-1 truncate"><b>{name(t.team_id)}</b> · {t.description}</span>
              <span className={`num font-semibold ${t.points >= 0 ? "text-ok" : "text-err"}`}>{t.points > 0 ? "+" : ""}{t.points}</span>
              {!t.description.startsWith("Auction") && !t.description.startsWith("Bingo") && <button className="key key-sm !px-1.5 !py-0.5" onClick={() => confirm("Delete this ledger entry?") && cmd.run({ action: "undo_tx", id: t.id })}><Trash2 size={11} /></button>}
            </div>))}</div>
        </div>
      </div>
    </div>
  );
}

/* ============================ POWER-UPS ============================ */
const COLORS = ["cyan", "magenta", "amber", "violet", "lime"] as const;
const HEX: Record<string, string> = { cyan: "#A6D8D4", magenta: "#C8664A", amber: "#E7D9BD", violet: "#9A8CCB", lime: "#5878D8" };
function Swatch({ c }: { c: string }) { return <span className="inline-block h-3 w-3 rounded-full border border-white shadow" style={{ background: HEX[c] ?? HEX.cyan }} />; }

function Powerups({ w, cmd, paddle, staff }: Ctx) {
  const blank = { name: "", description: "", minutes_delta: "15", targets_rival: false, color: "cyan" as string };
  const [f, setF] = useState<typeof blank & { id?: string }>(blank);
  const [team, setTeam] = useState(""); const [pu, setPu] = useState(""); const [target, setTarget] = useState("");
  const name = (id: string | null) => w.teams.find(t => t.id === id)?.team_name ?? "";
  const sel = w.powerups.find(p => p.id === pu);
  return (
    <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
      <div className="space-y-5">
        {staff.isHost && <div className="panel foil p-5">
          <p className="eyebrow">{f.id ? "Edit power-up" : "New power-up"}</p>
          <form className="mt-3 space-y-3" onSubmit={async e => { e.preventDefault(); if (await cmd.run({ action: "powerup_save", ...f })) setF(blank); }}>
            <input className="field" required placeholder="Name, e.g. Extra 15 minutes" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
            <input className="field" placeholder="What it does" value={f.description} onChange={e => setF({ ...f, description: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <L t="Minutes (±)"><input className="field num" type="number" value={f.minutes_delta} onChange={e => setF({ ...f, minutes_delta: e.target.value })} /></L>
              <L t="Colour"><div className="flex h-[42px] items-center gap-2">{COLORS.map(c => <button type="button" key={c} onClick={() => setF({ ...f, color: c })} className={`h-6 w-6 rounded-full border-2 ${f.color === c ? "border-graphite" : "border-white"} shadow`} style={{ background: HEX[c] }} />)}</div></L>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.targets_rival} onChange={e => setF({ ...f, targets_rival: e.target.checked })} /> Applies to a rival team (e.g. −10 min sabotage)</label>
            <p className="text-[11px] text-faint">0 minutes = an effect with no time change, like “Steal a feature”. You resolve those on the floor.</p>
            <div className="flex gap-2">{f.id && <button type="button" className="key" onClick={() => setF(blank)}>Cancel</button>}<button className="key-primary flex-1" disabled={cmd.busy}>Save</button></div>
          </form>
        </div>}
        <div className="panel p-4">
          <h3 className="font-display mb-2 font-bold">Catalogue</h3>
          {w.powerups.length === 0 ? <p className="text-sm text-muted">Nothing yet.</p> : w.powerups.map(p => (
            <div key={p.id} className="table-row flex items-center gap-2 py-2 text-sm">
              <Swatch c={p.color} /><span className="min-w-0 flex-1 truncate">{p.name}{p.targets_rival && <Swords size={11} className="ml-1 inline text-ember" />}</span>
              <span className="num text-xs text-muted">{fmtMins(p.minutes_delta)}</span>
              {staff.isHost && <button className="key key-sm" onClick={() => setF({ id: p.id, name: p.name, description: p.description ?? "", minutes_delta: String(p.minutes_delta), targets_rival: p.targets_rival, color: p.color })}><Pencil size={11} /></button>}
            </div>))}
        </div>
      </div>
      <div className="space-y-5">
        <div className="panel p-5">
          <h3 className="font-display mb-3 font-bold">Manual grant</h3>
          <div className="grid gap-4 lg:grid-cols-2">
            <TeamPicker w={w} paddle={paddle} value={team} onChange={setTeam} />
            <div className="space-y-3">
              <Picker placeholder="Choose a power-up…" value={pu} onChange={setPu} options={w.powerups.map(p => ({ value: p.id, label: p.name, hint: fmtMins(p.minutes_delta) }))} />
              {sel?.targets_rival && <Picker placeholder="Target team…" value={target} onChange={setTarget} options={w.teams.filter(t => t.id !== team).map(t => ({ value: t.id, label: `#${paddle[t.id]} ${t.team_name}` }))} />}
              <button className="key-primary w-full" disabled={!team || !pu || (sel?.targets_rival && !target) || cmd.busy} onClick={() => cmd.run({ action: "award", source: "manual", team_id: team, powerup_id: pu, target_team_id: target || undefined })}>Grant</button>
            </div>
          </div>
        </div>
        <div className="panel overflow-hidden">
          <div className="px-5 py-4"><h3 className="font-display font-bold">Everything in play</h3><p className="text-xs text-muted">Mark power-ups as used when a team plays them on the floor.</p></div>
          {w.teamPowerups.length === 0 ? <div className="p-5"><Empty title="Nothing granted yet" /></div> : w.teamPowerups.map(p => (
            <div key={p.id} className={`table-row flex items-center gap-3 px-5 py-2.5 text-sm ${p.used ? "opacity-50" : ""}`}>
              <span className="chip w-16 justify-center">{p.source}</span>
              <span className="min-w-0 flex-1 truncate"><b>{name(p.team_id)}</b> · {p.name}{p.target_team_id && <> → {name(p.target_team_id)}</>}</span>
              <span className="num text-xs text-muted">{fmtMins(p.minutes_delta)}</span>
              <span className="text-xs text-faint">{fmtTime(p.created_at)}</span>
              <button className="key key-sm" data-on={p.used} onClick={() => cmd.run({ action: "powerup_used", id: p.id, used: !p.used })}>{p.used ? "Used" : "Use"}</button>
              <button className="key key-sm" onClick={() => confirm("Revoke?") && cmd.run({ action: "revoke", id: p.id })}><Trash2 size={12} /></button>
            </div>))}
        </div>
      </div>
    </div>
  );
}

/* ============================ EVENT ============================ */
function EventPanel({ w, cmd, staff, vkey, scope }: Ctx) {
  const toLocal = (iso: string | null) => { if (!iso) return ""; const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
  const [end, setEnd] = useState(toLocal(w.settings.hackathon_end_at));
  const [hh, setHh] = useState("3"); const [mm, setMm] = useState("0");
  const [msg, setMsg] = useState(w.settings.broadcasts?.[vkey] ?? (vkey === "all" ? w.settings.broadcast ?? "" : ""));
  const now = useNow();
  const paused = w.settings.clock_paused_at;
  const endMs = w.settings.hackathon_end_at ? new Date(w.settings.hackathon_end_at).getTime() : null;
  const left = endMs && now ? endMs - (paused ? new Date(paused).getTime() : now) : null;
  const started = w.settings.hackathon_started_at;
  const total = endMs && started ? endMs - new Date(started).getTime() : null;
  const pct = left != null && total ? Math.max(0, Math.min(100, (left / total) * 100)) : 0;
  const ranked = [...w.teams].sort((a, b) => (w.balances[b.id] ?? 0) - (w.balances[a.id] ?? 0));
  const clock = (op: string, extra: Record<string, unknown> = {}) => cmd.run({ action: "clock", op, ...extra });
  const mins = (Number(hh) || 0) * 60 + (Number(mm) || 0);
  return (
    <div className="grid gap-5 xl:grid-cols-[1.2fr_.8fr_.8fr]">
      <div className="panel foil p-5">
        <div className="flex items-center justify-between"><p className="eyebrow">Hackathon clock</p>
          <span className="chip"><span className={`led ${!endMs ? "led-closed" : paused ? "led-upcoming" : "led-live"}`} />{!endMs ? "not started" : paused ? "paused" : "running"}</span></div>
        <div className="lcd mt-3 px-5 py-5 text-center text-6xl font-bold">{left == null ? "--:--:--" : fmtClock(left)}</div>
        <div className="mt-2 h-2 border border-graphite bg-white"><div className="h-full bg-graphite transition-all" style={{ width: `${pct}%` }} /></div>
        <p className="mt-1 text-xs text-muted">{endMs ? <>Official deadline <b>{fmtTime(w.settings.hackathon_end_at)}</b>{started && <> · started {fmtTime(started)}</>}</> : "Set a duration and start."}</p>

        {!staff.isHost ? <p className="well mt-5 p-3 text-xs text-muted">Only a host can start, pause or change the clock. Ask a host if your floor needs more time.</p> : <>
        <div className="mt-5 grid grid-cols-[1fr_auto] items-end gap-3">
          <div>
            <p className="eyebrow mb-2">Duration</p>
            <div className="flex flex-wrap gap-2">{[60, 120, 180, 240, 360].map(m => <button key={m} className="key key-sm" data-on={mins === m} onClick={() => { setHh(String(Math.floor(m / 60))); setMm("0"); }}>{m / 60}h</button>)}</div>
            <div className="mt-2 flex items-center gap-2"><input className="field num w-20" type="number" min={0} value={hh} onChange={e => setHh(e.target.value)} /><span className="text-sm">h</span><input className="field num w-20" type="number" min={0} max={59} value={mm} onChange={e => setMm(e.target.value)} /><span className="text-sm">m</span></div>
          </div>
          <button className="key-primary key-lg" disabled={mins <= 0 || cmd.busy} onClick={() => (!endMs || confirm(`Restart the clock at ${hh}h ${mm}m from now? Team power-up minutes still apply on top.`)) && clock("start", { minutes: mins })}><Play size={16} /> {endMs ? "Restart" : "Start"}</button>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2">
          {paused ? <button className="key" disabled={cmd.busy} onClick={() => clock("resume")}><Play size={14} /> Resume</button>
            : <button className="key" disabled={!endMs || cmd.busy} onClick={() => clock("pause")}><Pause size={14} /> Pause</button>}
          <button className="key" disabled={!endMs || cmd.busy} onClick={() => clock("adjust", { minutes: -5 })}>−5 min all</button>
          <button className="key" disabled={!endMs || cmd.busy} onClick={() => clock("adjust", { minutes: 5 })}>+5 min all</button>
          <button className="key" disabled={!endMs || cmd.busy} onClick={() => clock("adjust", { minutes: -15 })}>−15 min all</button>
          <button className="key" disabled={!endMs || cmd.busy} onClick={() => clock("adjust", { minutes: 15 })}>+15 min all</button>
          <button className="key-danger" disabled={!endMs || cmd.busy} onClick={() => confirm("Clear the clock? Teams will see --:--:--.") && clock("reset")}><Timer size={14} /> Clear</button>
        </div>
        <details className="mt-4"><summary className="cursor-pointer text-xs font-semibold text-muted">Set an exact deadline instead</summary>
          <div className="mt-2 flex gap-2"><input type="datetime-local" className="field" value={end} onChange={e => setEnd(e.target.value)} /><button className="key" onClick={() => clock("set_end", { end_at: end || null })}>Set</button></div></details>
        </>}
      </div>
      <div className="panel p-5">
        <p className="eyebrow">Announcement banner · {venueLabel(scope)}</p>
        <textarea className="field mt-3 h-28" maxLength={200} value={msg} onChange={e => setMsg(e.target.value)} placeholder="e.g. Bay A → move to Idea Lab for bingo in 5 min" />
        <div className="mt-3 flex gap-2"><button className="key flex-1" onClick={() => { setMsg(""); cmd.run({ action: "broadcast", venue: vkey === "all" ? "" : vkey, text: "" }); }}>Clear</button><button className="key-primary flex-1" onClick={() => cmd.run({ action: "broadcast", venue: vkey === "all" ? "" : vkey, text: msg })}><Radio size={14} /> Send to {venueLabel(scope)}</button></div>
        {staff.isHost && <label className="mt-6 flex items-center justify-between gap-3 text-sm"><span>Show the top 5 and each team&apos;s rank to teams</span>
          <button className="key key-sm" data-on={w.settings.leaderboard_visible} onClick={() => cmd.run({ action: "settings", leaderboard_visible: !w.settings.leaderboard_visible })}>{w.settings.leaderboard_visible ? "Visible" : "Hidden"}</button></label>}
      </div>
      <div className="panel p-5">
        <p className="eyebrow">Standings (by points)</p>
        <div className="mt-3 max-h-[460px] space-y-1 overflow-auto">{ranked.map((t, i) => (
          <div key={t.id} className={`flex items-center gap-3 px-2 py-1.5 text-sm ${i < 3 ? "well" : ""}`}>
            <span className={`num w-6 text-right font-bold ${i < 3 ? "" : "text-faint"}`}>{i + 1}</span>
            <span className="min-w-0 flex-1 truncate">{t.team_name}</span>
            <span className="num font-semibold">{w.balances[t.id] ?? 0}</span>
          </div>))}</div>
      </div>
      <SystemCheck cmd={cmd} />
      <PortalPanel {...{ w, cmd, staff }} />
      <ResetPanel {...{ w, cmd, staff, scope }} />
    </div>
  );
}

/* ============================ TEAMS ============================ */
function TeamsTab({ w, full, cmd, paddle, stageOf, staff, scope }: Ctx) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [pwFilter, setPwFilter] = useState<"all" | "default" | "changed">("all");
  const [nf, setNf] = useState({ team_name: "", bay: staff.venue ?? (scope && scope !== UNASSIGNED ? scope : ""), password: "" });
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [del, setDel] = useState<string[] | null>(null);
  const [confirmTxt, setConfirmTxt] = useState("");
  const [openTeam, setOpenTeam] = useState<string | null>(null);
  const [secrets, setSecrets] = useState<Record<string, { password: string | null; source: string }>>({});
  const [reveal, setReveal] = useState<Set<string>>(new Set());
  const [revealAll, setRevealAll] = useState(false);
  const loadSecrets = async () => {
    const j = await cmd.run({ action: "secrets" }, { quiet: true });
    if (j?.data) setSecrets(Object.fromEntries((j.data as { team_id: string; password: string | null; source: string }[]).map(r => [r.team_id, r])));
  };
  useEffect(() => { loadSecrets(); }, [w.activity.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const getPwStatus = (teamId: string) => {
    const logs = w.activity.filter(a => a.team_id === teamId && (a.action === "password_changed" || a.action === "password" || a.action === "password_reset"));
    if (logs.length > 0 && logs[0].action === "password_changed") {
      return { changed: true, at: logs[0].created_at };
    }
    return { changed: false, at: null };
  };

  const changedCount = w.teams.filter(t => getPwStatus(t.id).changed).length;
  const defaultCount = w.teams.length - changedCount;

  const list = w.teams.filter(t => {
    if (q && !(t.team_name.toLowerCase().includes(q.toLowerCase()) || t.username.toLowerCase().includes(q.toLowerCase()) || String(paddle[t.id]) === q.trim())) {
      return false;
    }
    if (pwFilter === "changed") return getPwStatus(t.id).changed;
    if (pwFilter === "default") return !getPwStatus(t.id).changed;
    return true;
  });

  const toggle = (id: string) => { const n = new Set(sel); n.has(id) ? n.delete(id) : n.add(id); setSel(n); };
  const name = (id: string) => full.teams.find(t => t.id === id)?.team_name ?? "?";
  const exportCsv = () => {
    const rows = [["Paddle", "Team", "Username", "Password Status", "Venue", "Points", "Auction", "Spin", "Bingo", "Lots won", "Bingo squares"]];
    w.teams.forEach(t => rows.push([
      String(paddle[t.id]),
      t.team_name,
      t.username,
      getPwStatus(t.id).changed ? "Changed" : "Default",
      t.bay ?? "",
      String(w.balances[t.id] ?? 0),
      stageOf(t.id, "auction"),
      stageOf(t.id, "spin"),
      stageOf(t.id, "bingo"),
      String(w.purchases.filter(p => p.team_id === t.id).length),
      String(w.marks.filter(m => m.team_id === t.id).length)
    ]));
    const csv = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `daemon-hour-teams-${new Date().toISOString().slice(0, 16)}.csv`; a.click();
  };
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
      <div className="panel overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-graphite p-4">
          <div className="relative min-w-[200px] flex-1"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" /><input className="field pl-9" placeholder="Search team, username or paddle" value={q} onChange={e => setQ(e.target.value)} /></div>
          <a className="key key-sm" href="/api/export" download title="Every team's cards, problem statement and penalties"><FileDown size={13} /> Eval spreadsheet</a>
          <a className="key key-sm" href="/dashboard/eval" target="_blank" rel="noreferrer"><Printer size={13} /> Eval PDF</a>
          {staff.isHost && <a className="key key-sm" href="/api/backup" download title="Everything in the database as one file. Download one before each round."><FileDown size={13} /> Full backup</a>}
          <div className="flex items-center gap-1">
            <button className="key key-sm" data-on={pwFilter === "all"} onClick={() => setPwFilter("all")}>All ({w.teams.length})</button>
            <button className="key key-sm" data-on={pwFilter === "default"} onClick={() => setPwFilter("default")} title="Teams still using default password">Default ({defaultCount})</button>
            <button className="key key-sm" data-on={pwFilter === "changed"} onClick={() => setPwFilter("changed")} title="Teams who have changed their password">Changed ({changedCount})</button>
          </div>
          <button className="key key-sm" onClick={() => setSel(new Set(list.map(t => t.id)))}><CheckSquare size={12} /> Select all</button>
          <button className="key key-sm" disabled={!sel.size} onClick={() => setSel(new Set())}><XCircle size={12} /> Clear</button>
          <button className="key key-sm" onClick={exportCsv}>Export CSV</button>
          <button className="key key-sm" data-on={revealAll} onClick={() => setRevealAll(!revealAll)}>{revealAll ? <EyeOff size={12} /> : <Eye size={12} />} Passwords</button>
        </div>
        {sel.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-graphite bg-frost/60 px-4 py-3 text-sm">
            <b className="num">{sel.size}</b> selected <MoveRight size={14} />
            {staff.isHost && VENUES.map(v => <button key={v} className="key key-sm" onClick={() => cmd.run({ action: "team_move", team_ids: [...sel], bay: v })}>Move to {v}</button>)}
            {staff.isHost && <button className="key key-sm" onClick={() => cmd.run({ action: "team_move", team_ids: [...sel], bay: null })}>Unassign</button>}
            <button className="key-danger key-sm ml-auto" onClick={() => { setDel([...sel]); setConfirmTxt(""); }}><Trash2 size={12} /> Delete</button>
          </div>
        )}
        <div className="max-h-[640px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-white text-left text-[10px] uppercase tracking-[.16em] text-muted"><tr className="border-b border-graphite">
              <th className="w-8 p-3" /><th className="p-3">#</th><th className="p-3">Team</th><th className="p-3">Login</th><th className="p-3">Password</th><th className="p-3">Crew</th><th className="p-3">Venue</th><th className="p-3 text-right">Pts</th><th className="p-3">Rounds</th><th className="p-3" />
            </tr></thead>
            <tbody>{list.map(t => {
              const pw = getPwStatus(t.id);
              return (
              <tr key={t.id} className={`table-row ${sel.has(t.id) ? "bg-frost/60" : ""}`}>
                <td className="p-3"><input type="checkbox" checked={sel.has(t.id)} onChange={() => toggle(t.id)} /></td>
                <td className="num p-3 text-faint">{String(paddle[t.id]).padStart(2, "0")}</td>
                <td className="p-3 font-semibold">{renaming?.id === t.id ? (
                  <form className="flex gap-1" onSubmit={async e => { e.preventDefault(); if (await cmd.run({ action: "team_rename", team_id: t.id, team_name: renaming.name })) setRenaming(null); }}>
                    <input autoFocus className="field !py-1" value={renaming.name} onChange={e => setRenaming({ id: t.id, name: e.target.value })} /><button className="key key-sm">Save</button><button type="button" className="key key-sm" onClick={() => setRenaming(null)}>×</button></form>
                ) : <span className="flex items-center gap-1.5"><button className="text-left underline-offset-2 hover:underline" title="Open team" onClick={() => setOpenTeam(t.id)}>{t.team_name}</button><button className="text-faint hover:text-graphite" title="Rename" onClick={() => setRenaming({ id: t.id, name: t.team_name })}><Pencil size={11} /></button></span>}</td>
                <td className="num p-3 text-xs">{t.username}</td>
                <td className="p-3">
                  {pw.changed ? (
                    <span className="chip border-ok/40 bg-ok/10 text-ok font-semibold inline-flex items-center gap-1" title={pw.at ? `Changed ${fmtTime(pw.at)}` : "Changed"}>
                      <Check size={11} /> Changed
                    </span>
                  ) : (
                    <span className="chip border-graphite text-faint inline-flex items-center gap-1" title={`Default: ${t.username}_123`}>
                      Default
                    </span>
                  )}
                  <button className="num ml-2 inline-flex items-center gap-1 text-xs" title="Show / hide" onClick={() => { const n = new Set(reveal); n.has(t.id) ? n.delete(t.id) : n.add(t.id); setReveal(n); }}>
                    {revealAll || reveal.has(t.id) ? (secrets[t.id]?.password ?? <span className="text-faint">unknown</span>) : "••••••"}
                  </button>
                </td>
                <td className="p-3"><button className="num text-xs underline-offset-2 hover:underline" onClick={() => setOpenTeam(t.id)}>{w.members.filter(m => m.team_id === t.id).length} · <span className="text-ok">{w.members.filter(m => m.team_id === t.id && m.checked_in).length}✓</span></button></td>
                <td className="p-3">{staff.isHost ? (
                  <div className="seg !p-0.5">{["", ...VENUES].map(v => <button key={v || "none"} type="button" className="!px-2 !py-1 !text-[10px]" data-on={(t.bay ?? "") === v} onClick={() => (t.bay ?? "") !== v && cmd.run({ action: "team_move", team_ids: [t.id], bay: v || null })}>{v ? v.split(" ")[0] : "None"}</button>)}</div>) : <span className="text-xs">{t.bay}</span>}</td>
                <td className="num p-3 text-right font-semibold">{w.balances[t.id] ?? 0}</td>
                <td className="p-3"><span className="flex gap-1">{(["quiz", "auction", "spin", "bingo"] as Activity[]).map(a => <StatusLed key={a} status={stageOf(t.id, a)} />)}</span></td>
                <td className="p-3"><div className="flex justify-end gap-1">
                  <button className="key key-sm" title="Reset password" onClick={() => { const pw = window.prompt(`New password for ${t.team_name} (min 6 chars). Leave blank for ${t.username}_123`, ""); if (pw !== null) cmd.run({ action: "team_password", team_id: t.id, password: pw }); }}><KeyRound size={12} /></button>
                  <button className="key key-sm" title="Delete team" onClick={() => { setDel([t.id]); setConfirmTxt(""); }}><Trash2 size={12} /></button>
                </div></td>
              </tr>);
            })}</tbody>
          </table>
          {list.length === 0 && <div className="p-5"><Empty title="No teams here">Change the venue filter above or add a team.</Empty></div>}
        </div>
      </div>

      <div className="space-y-5">
        <div className="panel foil p-5">
          <p className="eyebrow flex items-center gap-2"><UserPlus size={13} /> Add a team</p>
          <form className="mt-3 space-y-3" onSubmit={async e => { e.preventDefault(); if (await cmd.run({ action: "team_create", ...nf })) setNf({ ...nf, team_name: "", password: "" }); }}>
            <input className="field" required placeholder="Team name" value={nf.team_name} onChange={e => setNf({ ...nf, team_name: e.target.value })} />
            {staff.isHost ? <div className="seg">{["", ...VENUES].map(v => <button key={v || "none"} type="button" data-on={nf.bay === v} onClick={() => setNf({ ...nf, bay: v })}>{v || "No venue yet"}</button>)}</div>
              : <p className="text-xs text-muted">Will be added to <b>{staff.venue}</b>.</p>}
            <input className="field" placeholder="Password (blank = TEAMNAME_123)" value={nf.password} onChange={e => setNf({ ...nf, password: e.target.value })} />
            <button className="key-primary w-full" disabled={cmd.busy}>Create team & login</button>
          </form>
          <p className="mt-2 text-[11px] text-faint">The login username is the team name in CAPS_WITH_UNDERSCORES. Renaming a team later keeps its login.</p>
        </div>
        <ImportMembers cmd={cmd} />
        <div className="panel p-5">
          <p className="eyebrow">Venues</p>
          <div className="mt-3 space-y-2">{[...VENUES, null].map(v => {
            const ts = full.teams.filter(t => (v ? t.bay === v : !t.bay));
            return <div key={v ?? "none"} className="well flex items-center justify-between px-3 py-2 text-sm"><span className="font-semibold">{v ?? "Unassigned"}</span><span className="num text-xs">{ts.length} teams · {ts.reduce((a, t) => a + (full.balances[t.id] ?? 0), 0)} pts</span></div>;
          })}</div>
        </div>
      </div>

      {openTeam && w.teams.find(t => t.id === openTeam) && (
        <TeamDrawer {...{ w, cmd, paddle, stageOf, staff }} teamId={openTeam} secret={secrets[openTeam]} close={() => setOpenTeam(null)} onDelete={() => { setDel([openTeam]); setConfirmTxt(""); setOpenTeam(null); }} reloadSecrets={loadSecrets} />
      )}
      {del && (
        <Modal title={`Delete ${del.length} team(s)?`} close={() => setDel(null)}>
          <p className="text-sm">This permanently removes <b>{del.map(name).join(", ")}</b>, their login, points, power-ups, bingo marks and history. There&apos;s no undo.</p>
          <p className="mt-3 text-xs text-muted">Enter the delete password to confirm.</p>
          <input className="field num mt-2" type="password" autoFocus value={confirmTxt} onChange={e => setConfirmTxt(e.target.value)} placeholder="Delete password" />
          <div className="mt-4 flex justify-end gap-2"><button className="key" onClick={() => setDel(null)}>Cancel</button>
            <button className="key-danger" disabled={!confirmTxt || cmd.busy} onClick={async () => { if (await cmd.run({ action: "team_delete", team_ids: del, pin: confirmTxt })) { setDel(null); setSel(new Set()); } }}>Delete forever</button></div>
        </Modal>
      )}
    </div>
  );
}

function TeamDrawer({ w, cmd, paddle, stageOf, staff, teamId, secret, close, onDelete, reloadSecrets }: Pick<Ctx, "w" | "cmd" | "paddle" | "stageOf" | "staff"> & { teamId: string; secret?: { password: string | null; source: string }; close: () => void; onDelete: () => void; reloadSecrets: () => void }) {
  const t = w.teams.find(x => x.id === teamId)!;
  const [show, setShow] = useState(false);
  const members = w.members.filter(m => m.team_id === teamId);
  const tps = w.teamPowerups.filter(p => p.team_id === teamId || p.target_team_id === teamId);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && close(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [close]);
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-graphite/30 backdrop-blur-sm" onClick={close}>
      <aside className="animate-rise h-full w-full max-w-4xl overflow-y-auto border-l border-graphite bg-porcelain p-5 sm:p-7" onClick={e => e.stopPropagation()}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="eyebrow">Paddle {String(paddle[t.id]).padStart(2, "0")} · {t.bay ?? "Unassigned"}</p>
            <h2 className="font-display mt-1 text-4xl">{t.team_name}</h2>
          </div>
          <div className="flex gap-2"><button className="key-danger key-sm" onClick={onDelete}><Trash2 size={12} /> Delete team</button><button className="key key-sm" onClick={close}>Close ✕</button></div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-4">
          <div className="panel-tight p-3"><p className="eyebrow">Points</p><p className="num text-2xl font-bold">{w.balances[t.id] ?? 0}</p></div>
          <div className="panel-tight p-3"><p className="eyebrow">Rounds</p><p className="mt-2 flex gap-1.5">{(["quiz", "auction", "spin", "bingo"] as Activity[]).map(a => <span key={a} className="flex items-center gap-1 text-[10px] uppercase"><StatusLed status={stageOf(t.id, a)} />{a[0]}</span>)}</p></div>
          <div className="panel-tight p-3"><p className="eyebrow">Power-ups</p><p className="num text-2xl font-bold">{tps.filter(p => p.team_id === t.id).length}</p></div>
          <div className="panel-tight p-3"><p className="eyebrow">Bingo</p><p className="num text-2xl font-bold">{w.marks.filter(m => m.team_id === t.id).length}/24</p></div>
        </div>

        <DrawerCards t={t} w={w} cmd={cmd} paddle={paddle} />
        <div className="panel mt-5 p-4"><RoundLedgers compact rows={buildLedger(t.id, w.txs, w.teamPowerups, w.cards)} baseEnd={w.settings.hackathon_end_at} /></div>

        <div className="panel mt-5 flex flex-wrap items-center gap-3 p-4">
          <KeyRound size={16} />
          <div className="min-w-0 flex-1">
            <p className="eyebrow">Login</p>
            <p className="num text-sm"><b>{t.username}</b> · {show ? (secret?.password ?? "unknown (changed before tracking began)") : "••••••••"} <span className="text-[10px] uppercase text-faint">{secret?.source === "team" ? "set by team" : secret?.source === "organiser" ? "set by organiser" : "default"}</span></p>
          </div>
          <button className="key key-sm" onClick={() => setShow(!show)}>{show ? <EyeOff size={12} /> : <Eye size={12} />} {show ? "Hide" : "Show"}</button>
          <button className="key key-sm" onClick={async () => { const pw = window.prompt(`New password for ${t.team_name} (min 6). Blank = ${t.username}_123`, ""); if (pw !== null && await cmd.run({ action: "team_password", team_id: t.id, password: pw })) reloadSecrets(); }}>Reset</button>
          {secret?.password && <button className="key key-sm" onClick={() => navigator.clipboard?.writeText(`${t.username} / ${secret.password}`).catch(() => null)}>Copy</button>}
        </div>

        <div className="mt-6 flex items-end justify-between">
          <h3 className="font-display text-xl">Members</h3>
          <span className="text-xs text-muted">{members.length} people · {members.filter(m => m.checked_in).length} checked in · no password needed to edit</span>
        </div>
        <div className="mt-3"><MemberTiles teamId={t.id} members={members} run={p => cmd.run(p)} busy={cmd.busy} /></div>

        {tps.length > 0 && (
          <div className="panel mt-6 p-4">
            <h3 className="font-display mb-2">Power-ups</h3>
            {tps.map(p => <div key={p.id} className="table-row flex items-center gap-2 py-2 text-sm"><span className={`min-w-0 flex-1 truncate ${p.used ? "line-through opacity-60" : ""}`}>{p.name}{p.target_team_id === t.id && p.team_id !== t.id ? " (played on them)" : ""}</span><span className="num text-xs">{fmtMins(p.minutes_delta)}</span><span className="chip">{p.source}</span></div>)}
          </div>
        )}
      </aside>
    </div>
  );
}

/** Paste rows copied from Excel / Google Sheets: Team, Role, Name, USN, Dept, Year, Phone, Email */
function ImportMembers({ cmd }: { cmd: Cmd }) {
  const [txt, setTxt] = useState("");
  const [replace, setReplace] = useState(false);
  const rows = txt.trim() ? txt.trim().split(/\r?\n/).map(l => l.split(l.includes("\t") ? "\t" : ",").map(c => c.trim().replace(/^"|"$/g, ""))) : [];
  const body = rows.filter(r => !/^team$/i.test(r[0] ?? ""));
  return (
    <div className="panel p-5">
      <p className="eyebrow flex items-center gap-2"><Users size={13} /> Import members</p>
      <p className="mt-1 text-[11px] text-muted">Paste rows from your registration sheet, one person per line, in this column order: <b>Team, Role (lead/member), Name, USN, Dept, Year, Phone, Email</b>.</p>
      <textarea className="field num mt-3 h-28 text-[11px]" placeholder={"Straw Hats\tlead\tAnanya R\t1NH23CS001\tCSE\t3\t98xxxxxx\tananya@…"} value={txt} onChange={e => setTxt(e.target.value)} />
      <label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} /> Replace existing members of those teams</label>
      <button className="key-primary mt-3 w-full" disabled={!body.length || cmd.busy} onClick={async () => {
        const payload = body.map(r => ({ team: r[0], role: r[1], full_name: r[2], usn: r[3], department: r[4], year: r[5], phone: r[6], email: r[7] }));
        if (await cmd.run({ action: "members_import", rows: payload, replace })) setTxt("");
      }}>Import {body.length || ""} {body.length === 1 ? "person" : "people"}</button>
    </div>
  );
}

function SystemCheck({ cmd }: Pick<Ctx, "cmd">) {
  const [rows, setRows] = useState<{ item: string; status: string }[] | null>(null);
  const [running, setRunning] = useState(false);
  const run = async () => { setRunning(true); const j = await cmd.run({ action: "health" }, { quiet: true }); setRows(j?.data ?? null); setRunning(false); };
  const bad = (rows ?? []).filter(r => !(r.status === "OK" || / ms$/.test(r.status)));
  return (
    <div className="panel p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="eyebrow">System check</p>
        <button className="key key-sm" disabled={running} onClick={run}>{running ? "Checking…" : rows ? "Run again" : "Run check"}</button>
      </div>
      {!rows ? <p className="mt-2 text-xs text-muted">Checks every table, column and database function the portal needs. Run it after any database change and before doors open.</p> : (
        <>
          <p className={`mt-3 text-sm font-bold ${bad.length ? "text-err" : "text-ok"}`}>{bad.length ? `${bad.length} problem(s): run supabase/ALL_IN_ONE.sql in Supabase, then check again` : "All good, ready for the event"}</p>
          <div className="mt-2 max-h-56 space-y-1 overflow-auto text-xs">{rows.map(r => (
            <div key={r.item} className="flex justify-between gap-3"><span className="text-muted">{r.item}</span><span className={`num text-right ${r.status === "OK" || / ms$/.test(r.status) ? "text-ok" : "text-err"}`}>{r.status}</span></div>))}</div>
        </>
      )}
    </div>
  );
}

function PortalPanel({ w, cmd, staff }: Pick<Ctx, "w" | "cmd" | "staff">) {
  const [msg, setMsg] = useState(w.settings.portal_message ?? "");
  const [sp, setSp] = useState(String(w.settings.starting_points ?? 0));
  const [ab, setAb] = useState(String(w.auctionBudget ?? 1000));
  if (!staff.isHost) return null;
  return (
    <div className="panel p-5">
      <p className="eyebrow">Team portal</p>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-sm">{w.settings.portal_locked ? <b className="text-err">Locked: teams see a “hold tight” screen</b> : "Open: teams see their dashboard"}</span>
        <button className={w.settings.portal_locked ? "key-primary key-sm" : "key key-sm"} onClick={() => cmd.run({ action: "settings", portal_locked: !w.settings.portal_locked, portal_message: msg })}>{w.settings.portal_locked ? "Unlock" : "Lock"}</button>
      </div>
      <input className="field mt-2" placeholder="Message on the lock screen (optional)" value={msg} onChange={e => setMsg(e.target.value)} />
      <p className="mt-1 text-[11px] text-faint">Use it while you fix data or reset a round, so nobody sees half-updated numbers.</p>
      <hr className="my-4 border-silver/30" />
      <p className="eyebrow">Starting points</p>
      <div className="mt-2 flex gap-2"><input className="field num" type="number" min={0} value={sp} onChange={e => setSp(e.target.value)} /><button className="key" onClick={() => cmd.run({ action: "settings", starting_points: sp })}>Save</button></div>
      <p className="mt-1 text-[11px] text-faint">Main points new teams get. To give it to everyone again, use Reset → “Give starting points”.</p>
      <hr className="my-4 border-silver/30" />
      <p className="eyebrow">Auction wallet</p>
      <div className="mt-2 flex gap-2"><input className="field num" type="number" min={0} value={ab} onChange={e => setAb(e.target.value)} /><button className="key" onClick={() => cmd.run({ action: "settings", auction_budget: ab })}>Save</button></div>
      <p className="mt-1 text-[11px] text-faint">Auction points every team starts with. Used only to pay for auction cards and kept apart from main points. Changing it updates every team&apos;s wallet at once (what they already spent stays spent).</p>
    </div>
  );
}

const RESET_PARTS: { key: string; label: string; note: string; global?: boolean }[] = [
  { key: "points", label: "Points → 0", note: "Main points back to 0 (the auction wallet is separate)" },
  { key: "purchases", label: "Auction wins", note: "Removes sold cards and their effects; the auction wallet goes back to full" },
  { key: "powerups", label: "Power-ups", note: "All granted, spun and rival power-ups" },
  { key: "bingo", label: "Bingo marks", note: "Every stamped square" },
  { key: "rounds", label: "Rounds → upcoming", note: "Auction, spin and bingo all back to upcoming" },
  { key: "help", label: "Help requests", note: "Clears the help queue" },
  { key: "history", label: "History log", note: "Wipes the activity log" },
  { key: "starting_points", label: "Give starting points", note: "Adds the starting points after the reset" },
  { key: "clock", label: "Clock", note: "Clears the hackathon timer", global: true },
  { key: "lots", label: "Live lots", note: "Clears the lot on every screen", global: true },
  { key: "banners", label: "Banners", note: "Clears all announcements", global: true },
];
function ResetPanel({ w, cmd, staff, scope }: Pick<Ctx, "w" | "cmd" | "staff" | "scope">) {
  const [parts, setParts] = useState<Set<string>>(new Set());
  const [pin, setPin] = useState("");
  const toggle = (k: string) => { const n = new Set(parts); n.has(k) ? n.delete(k) : n.add(k); setParts(n); };
  const preset = (keys: string[]) => setParts(new Set(keys.filter(k => staff.isHost || !RESET_PARTS.find(p => p.key === k)?.global)));
  const who = staff.isHost ? (scope ? `${w.teams.length} team(s) in ${venueLabel(scope)}` : `all ${w.teams.length} teams`) : `${w.teams.length} ${staff.venue} team(s)`;
  return (
    <div className="panel border-err p-5 xl:col-span-2" style={{ boxShadow: "4px 4px 0 #C23B22" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="eyebrow text-err">Reset · danger zone</p>
        <div className="flex flex-wrap gap-2">
          <button className="key key-sm" onClick={() => preset(["rounds"])}>Restart rounds</button>
          <button className="key key-sm" onClick={() => preset(["bingo"])}>Restart bingo</button>
          <button className="key key-sm" onClick={() => preset(["points", "purchases", "powerups", "bingo", "rounds", "help", "history", "starting_points", "clock", "lots", "banners"])}>Fresh event (0 pts)</button>
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {RESET_PARTS.filter(p => staff.isHost || !p.global).map(p => (
          <label key={p.key} className={`flex cursor-pointer items-start gap-2 border px-3 py-2 text-sm ${parts.has(p.key) ? "border-err bg-err/5" : "border-graphite/30 bg-white"}`}>
            <input type="checkbox" className="mt-1" checked={parts.has(p.key)} onChange={() => toggle(p.key)} />
            <span><b>{p.label}</b>{p.global && <span className="chip ml-1 !py-0 text-[9px]">event-wide</span>}<br /><span className="text-xs text-muted">{p.note}</span></span>
          </label>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-sm">Applies to <b>{who}</b>. Switch venue at the top to narrow it.</span>
        <input className="field num ml-auto w-36" type="password" placeholder="Password" value={pin} onChange={e => setPin(e.target.value)} />
        <button className="key-danger" disabled={!parts.size || !pin || cmd.busy} onClick={async () => {
          if (!confirm(`Reset ${[...parts].join(", ")} for ${who}? This can't be undone.`)) return;
          if (await cmd.run({ action: "reset", parts: [...parts], team_ids: w.teams.map(t => t.id), pin })) { setPin(""); setParts(new Set()); }
        }}><RotateCcw size={14} /> Reset</button>
      </div>
    </div>
  );
}

/* ============================ STAFF ============================ */
type StaffRow = { id: string; email: string; venue: string | null; last: string | null; me: boolean };
function StaffTab({ cmd }: Ctx) {
  const [rows, setRows] = useState<StaffRow[] | null>(null);
  const [f, setF] = useState({ email: "", password: "", venue: "" });
  const load = async () => { const j = await cmd.run({ action: "staff_list" }, { quiet: true }); if (j?.data) setRows(j.data); };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
      <div className="panel overflow-hidden">
        <div className="border-b border-graphite p-4"><h3 className="font-display">Organisers</h3><p className="text-xs text-muted">Hosts see and control everything. A venue admin only sees their floor&apos;s teams and can&apos;t touch the clock, staff or other venues.</p></div>
        {!rows ? <p className="p-5 text-sm text-muted">Loading…</p> : rows.map(r => (
          <div key={r.id} className="table-row flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
            <span className="min-w-0 flex-1 truncate font-semibold">{r.email}{r.me && <span className="chip ml-2">you</span>}</span>
            <div className="seg !p-0.5">{["", ...VENUES].map(v => <button key={v || "host"} type="button" disabled={r.me} className="!px-2 !py-1 !text-[10px]" data-on={(r.venue ?? "") === v} onClick={async () => { if ((r.venue ?? "") !== v) { await cmd.run({ action: "staff_save", id: r.id, venue: v }); load(); } }}>{v ? v.split(" ")[0] : "Host"}</button>)}</div>
            <span className="text-xs text-faint">{r.last ? `seen ${fmtTime(r.last)}` : "never signed in"}</span>
            <button className="key key-sm" title="Set password" onClick={async () => { const pw = window.prompt(`New password for ${r.email} (min 8 chars)`); if (pw) { await cmd.run({ action: "staff_save", id: r.id, venue: r.venue ?? "", password: pw }); } }}><KeyRound size={12} /></button>
            {!r.me && <button className="key key-sm" title="Remove" onClick={async () => { if (confirm(`Remove ${r.email} as an organiser?`)) { await cmd.run({ action: "staff_delete", id: r.id }); load(); } }}><Trash2 size={12} /></button>}
          </div>))}
      </div>
      <div className="panel foil p-5">
        <p className="eyebrow flex items-center gap-2"><UserPlus size={13} /> Add an organiser</p>
        <form className="mt-3 space-y-3" onSubmit={async e => { e.preventDefault(); if (await cmd.run({ action: "staff_save", ...f })) { setF({ email: "", password: "", venue: f.venue }); load(); } }}>
          <input className="field" type="email" required placeholder="Email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} />
          <input className="field" type="text" required minLength={8} placeholder="Password (min 8)" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} />
          <div className="seg">{["", ...VENUES].map(v => <button key={v || "host"} type="button" data-on={f.venue === v} onClick={() => setF({ ...f, venue: v })}>{v ? `Admin · ${v}` : "Host · all venues"}</button>)}</div>
          <button className="key-primary w-full" disabled={cmd.busy}>Add organiser</button>
        </form>
        <p className="mt-2 text-[11px] text-faint">If the email already has an account, it&apos;s promoted and its password is replaced. Organisers sign in with their email on the normal login page.</p>
      </div>
    </div>
  );
}

/* ============================ bits ============================ */
function L({ t, c = "", children }: { t: string; c?: string; children: React.ReactNode }) {
  return <label className={`block text-xs font-semibold text-muted ${c}`}><span className="mb-1 block">{t}</span>{children}</label>;
}
function Modal({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && close(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [close]);
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-graphite/25 p-4 backdrop-blur-sm" onClick={close}>
      <div className="panel animate-rise w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
        <h3 className="font-display mb-4 text-xl font-bold">{title}</h3>{children}
      </div>
    </div>
  );
}

/** Invisible: ticks once a second and drives every hourglass (header logo) from the official clock. */
function SandSync({ s }: { s: World["settings"] }) {
  const now = useNow();
  const endMs = s.hackathon_end_at ? new Date(s.hackathon_end_at).getTime() : null;
  const startMs = s.hackathon_started_at ? new Date(s.hackathon_started_at).getTime() : null;
  const refMs = s.clock_paused_at ? new Date(s.clock_paused_at).getTime() : now;
  const fill = endMs && startMs && refMs ? Math.max(0, Math.min(1, (endMs - refMs) / Math.max(1, endMs - startMs))) : 1;
  useBroadcastSand(fill, !!endMs && !!startMs && !s.clock_paused_at && fill > 0);
  return null;
}
