"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, UserPlus, KeyRound, Shield, MoveRight, History, Play, Pause, RotateCcw, Timer, XCircle, CheckSquare, Gavel, Disc3, Grid3x3, Coins, Sparkles, Layers, Settings2, Minus, Plus, Hammer, Undo2, Search, Check, Eye, EyeOff, Pencil, Trash2, Radio, Swords } from "lucide-react";
import type { World, Activity, StageStatus, Team } from "@/lib/game";
import { useCommand, LiveSync, StatusLed, fmtTime, fmtMins, Empty, useNow, fmtClock } from "@/components/ui";
import BingoBoard from "@/components/bingo-board";
import { HistoryFeed } from "@/components/team-arena";
import { LETTERS } from "@/lib/bingo-shared";
import { VENUES, UNASSIGNED, scopeWorld, venueKey, venueLabel } from "@/lib/venues";

type Tab = "stages" | "auction" | "spin" | "bingo" | "points" | "powerups" | "history" | "teams" | "event" | "staff";
const TABS: { key: Tab; label: string; icon: typeof Gavel }[] = [
  { key: "stages", label: "Rounds", icon: Layers },
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
          {(["auction", "spin", "bingo"] as Activity[]).map(a => <span key={a} className="chip"><StatusLed status={liveCount(a) ? "live" : "closed"} /> {a} · {liveCount(a)}</span>)}
          <LiveSync tables={["transactions", "purchases", "team_stages", "team_powerups", "team_bingo", "activity_log", "event_settings"]} every={20000} />
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
      <div className="rail" role="tablist">
        {visibleTabs.map((t, i) => { const I = t.icon; return (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} title={`Shortcut: ${i + 1}`}><I size={15} />{t.label}</button>
        ); })}
      </div>

      <div key={tab} className="animate-rise">
        {tab === "stages" && <Stages {...ctx} />}
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
      {cmd.toasts}
    </div>
  );
}

/* ============================ shared pickers ============================ */
function TeamPicker({ w, paddle, value, onChange, filter, balanceOf }: { w: World; paddle: Record<string, number>; value: string; onChange: (id: string) => void; filter?: (t: Team) => boolean; balanceOf?: boolean }) {
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
            {balanceOf && <span className="num text-faint">{w.balances[t.id] ?? 0}</span>}
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
          stageFilter={t => <span className="flex gap-1">{(["auction", "spin", "bingo"] as Activity[]).map(a => <StatusLed key={a} status={stageOf(t.id, a)} />)}</span>} />
        <p className="mt-3 text-[11px] text-faint">The three lights on each team show auction · spin · bingo, in that order.</p>
      </div>
      <div className="space-y-5">
        <div className="panel foil p-5">
          <p className="eyebrow">Apply to {sel.size} selected</p>
          <div className="rail mt-3">{(["auction", "spin", "bingo", "all"] as const).map(a => <button key={a} aria-selected={act === a} onClick={() => setAct(a)}>{a === "all" ? "All rounds" : a}</button>)}</div>
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
          <div className="mt-3 space-y-2 text-sm">{(["auction", "spin", "bingo"] as Activity[]).map(a => {
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
  const items = w.items;
  const soldOf = (id: string) => w.purchases.filter(p => p.item_id === id).length;
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
  const broadcast = (id: string, p: number) => {
    if (pushT.current) clearTimeout(pushT.current);
    pushT.current = setTimeout(() => cmd.run({ action: "live_lot", venue: vkey === "all" ? "" : vkey, lot: { item_id: id, price: p } }, { quiet: true }), 400);
  };
  const choose = (id: string) => { const it = items.find(i => i.id === id); setItemId(id); const p = it?.min_price ?? it?.base_points ?? 0; setPrice(p); setTeam(""); broadcast(id, p); };
  const bump = (d: number) => { const p = clamp(price + d); setPrice(p); if (item) broadcast(item.id, p); };
  const bal = team ? w.balances[team] ?? 0 : 0;
  const sell = async () => {
    if (!item || !team) return;
    const t = w.teams.find(x => x.id === team);
    if (!confirm(`SOLD: ${item.item_name} to ${t?.team_name} for ${price} pts?`)) return;
    const r = await cmd.run({ action: "sell", item_id: item.id, team_id: team, price });
    if (r) setTeam("");
  };
  const sales = w.purchases.slice(0, 12);
  const name = (id: string) => w.teams.find(t => t.id === id)?.team_name ?? "?";

  return (
    <div className="grid gap-5 xl:grid-cols-[300px_1fr_360px]">
      {/* Lots */}
      <div className="panel p-4">
        <div className="mb-3 flex items-center justify-between"><h2 className="font-display font-bold">Lots</h2><button className="key key-sm" onClick={() => setEditing({ price_step: 10, quantity: 1, is_active: true })}><Plus size={13} />New</button></div>
        <div className="space-y-1.5">
          {items.length === 0 && <Empty title="No lots">Create the first one.</Empty>}
          {items.map(i => { const s = soldOf(i.id); return (
            <div key={i.id} className={`flex items-center gap-1 ${i.is_active ? "" : "opacity-50"}`}>
              <button className="key key-sm flex-1 justify-start" data-on={itemId === i.id} onClick={() => choose(i.id)}>
                <span className="min-w-0 flex-1 truncate text-left">{i.item_name}</span><span className="num text-faint">{s}/{i.quantity}</span>
              </button>
              <button className="key key-sm" title="Edit" onClick={() => setEditing(i)}><Pencil size={12} /></button>
              <button className="key key-sm" title={i.is_active ? "Hide from teams" : "Show to teams"} onClick={() => cmd.run({ action: "item_toggle", id: i.id, is_active: !i.is_active })}>{i.is_active ? <Eye size={12} /> : <EyeOff size={12} />}</button>
            </div>); })}
        </div>
      </div>

      {/* The block */}
      <div className="panel foil p-6">
        {!item ? <Empty title="Pick a lot">Choose a lot on the left. It appears on the screens of teams whose auction is live.</Empty> : <>
          <div className="flex items-start justify-between gap-3">
            <div><p className="eyebrow">On the block</p><h2 className="font-display mt-1 text-3xl font-black">{item.item_name}</h2>
              <p className="mt-1 text-sm text-muted">Range <span className="num">{min}–{max}</span> · step <span className="num">{step}</span> · {item.quantity - soldOf(item.id)} left{item.powerup_id && <> · grants <b>{w.powerups.find(p => p.id === item.powerup_id)?.name}</b></>}</p></div>
            <span className="chip"><Radio size={11} className="text-ok" /> {venueLabel(scope)} screens</span>
          </div>
          <div className="mt-6 grid items-center gap-4 sm:grid-cols-[auto_1fr_auto]">
            <div className="flex flex-col gap-2"><button className="key" onClick={() => bump(-step * 5)}>−{step * 5}</button><button className="key key-lg" onClick={() => bump(-step)}><Minus size={18} /></button></div>
            <div className="lcd px-6 py-5 text-center"><p className="text-[10px] font-bold uppercase tracking-[.25em] opacity-70">Current price</p><p className="text-7xl font-bold leading-none">{price}</p></div>
            <div className="flex flex-col gap-2"><button className="key" onClick={() => bump(step * 5)}>+{step * 5}</button><button className="key key-lg" onClick={() => bump(step)}><Plus size={18} /></button></div>
          </div>
          <input type="range" className="mt-5 w-full accent-[#5878D8]" min={min} max={max} step={step} value={price} onChange={e => { const p = Number(e.target.value); setPrice(p); broadcast(item.id, p); }} />
          <div className="mt-1 flex justify-between text-[10px] text-faint num"><span>{min}</span><span>{max}</span></div>
          <div className="mt-6 flex items-center gap-3">
            <div className="well flex-1 px-4 py-3 text-sm">{team ? <>Winner <b>#{paddle[team]} {name(team)}</b> · balance <span className={`num font-bold ${bal >= price ? "text-ok" : "text-err"}`}>{bal}</span></> : <span className="text-muted">Select the winning paddle →</span>}</div>
            <button className="key-primary key-lg" disabled={!team || cmd.busy || bal < price || soldOf(item.id) >= item.quantity} onClick={sell}><Hammer size={18} /> Sold</button>
          </div>
          <button className="key key-sm mt-3" onClick={() => cmd.run({ action: "live_lot", venue: vkey === "all" ? "" : vkey, lot: null })}>Clear lot from {venueLabel(scope)} screens</button>
        </>}
      </div>

      {/* Winner + sales */}
      <div className="space-y-5">
        <div className="panel p-4">
          <div className="mb-2 flex items-center justify-between"><h3 className="font-display font-bold">Winning paddle</h3>
            <label className="flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" checked={onlyLive} onChange={e => setOnlyLive(e.target.checked)} /> live only</label></div>
          <TeamPicker w={w} paddle={paddle} value={team} onChange={setTeam} balanceOf filter={onlyLive ? t => stageOf(t.id, "auction") === "live" : undefined} />
        </div>
        <div className="panel p-4">
          <h3 className="font-display mb-2 font-bold">Recent sales</h3>
          {sales.length === 0 ? <p className="text-sm text-muted">No sales yet.</p> : sales.map(s => (
            <div key={s.id} className="table-row flex items-center gap-2 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate"><b>{name(s.team_id)}</b> · {items.find(i => i.id === s.item_id)?.item_name}</span>
              <span className="num">{s.purchase_price}</span>
              <button className="key key-sm" title="Undo and refund" onClick={() => confirm("Reverse this sale and refund the points?") && cmd.run({ action: "undo_sale", id: s.id })}><Undo2 size={12} /></button>
            </div>
          ))}
        </div>
      </div>

      {editing && <ItemEditor w={w} cmd={cmd} item={editing} close={() => setEditing(null)} />}
    </div>
  );
}

function ItemEditor({ w, cmd, item, close }: { w: World; cmd: Cmd; item: Partial<World["items"][number]>; close: () => void }) {
  const [f, setF] = useState({ item_name: item.item_name ?? "", description: item.description ?? "", base_points: String(item.base_points ?? 100), min_price: item.min_price?.toString() ?? "", max_price: item.max_price?.toString() ?? "", price_step: String(item.price_step ?? 10), quantity: String(item.quantity ?? 1), powerup_id: item.powerup_id ?? "" });
  const up = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={item.id ? "Edit lot" : "New lot"} close={close}>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={async e => { e.preventDefault(); if (await cmd.run({ action: "item_save", id: item.id, ...f, is_active: item.is_active ?? true })) close(); }}>
        <L t="Name" c="sm:col-span-2"><input className="field" required value={f.item_name} onChange={up("item_name")} /></L>
        <L t="Description" c="sm:col-span-2"><input className="field" value={f.description} onChange={up("description")} /></L>
        <L t="Opening price"><input className="field num" type="number" required value={f.base_points} onChange={up("base_points")} /></L>
        <L t="Step"><input className="field num" type="number" min={1} value={f.price_step} onChange={up("price_step")} /></L>
        <L t="Minimum"><input className="field num" type="number" value={f.min_price} onChange={up("min_price")} placeholder="none" /></L>
        <L t="Maximum"><input className="field num" type="number" value={f.max_price} onChange={up("max_price")} placeholder="none" /></L>
        <L t="Quantity"><input className="field num" type="number" min={1} value={f.quantity} onChange={up("quantity")} /></L>
        <L t="Grants power-up"><select className="field" value={f.powerup_id} onChange={up("powerup_id")}><option value="">None</option>{w.powerups.map(p => <option key={p.id} value={p.id}>{p.name} ({fmtMins(p.minutes_delta)})</option>)}</select></L>
        <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" className="key" onClick={close}>Cancel</button><button className="key-primary" disabled={cmd.busy}>Save lot</button></div>
      </form>
    </Modal>
  );
}

/* ============================ SPIN ============================ */
function Spin({ w, cmd, paddle, stageOf }: Ctx) {
  const [team, setTeam] = useState("");
  const [pu, setPu] = useState("");
  const [target, setTarget] = useState("");
  const [mins, setMins] = useState("");
  const [note, setNote] = useState("");
  const power = w.powerups.find(p => p.id === pu);
  const recent = w.teamPowerups.filter(p => p.source === "spin").slice(0, 15);
  const name = (id: string | null) => w.teams.find(t => t.id === id)?.team_name ?? "";
  const live = w.teams.filter(t => stageOf(t.id, "spin") === "live");
  const done = new Set(w.teamPowerups.filter(p => p.source === "spin").map(p => p.team_id));
  const award = async () => {
    const r = await cmd.run({ action: "award", source: "spin", team_id: team, powerup_id: pu, target_team_id: target || undefined, minutes_delta: mins, note });
    if (r) { setTeam(""); setTarget(""); setMins(""); setNote(""); }
  };
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_1fr_360px]">
      <div className="panel p-5">
        <h2 className="font-display mb-1 font-bold">1 · Who spun?</h2>
        <p className="mb-3 text-xs text-muted">{live.length} team(s) have the spin round live. A tick means the team already has a spin result.</p>
        <TeamPicker w={w} paddle={paddle} value={team} onChange={setTeam} filter={live.length ? t => stageOf(t.id, "spin") === "live" : undefined} />
        <div className="mt-3 flex flex-wrap gap-1">{live.map(t => <span key={t.id} className="chip">{done.has(t.id) && <Check size={10} className="text-ok" />}{t.team_name}</span>)}</div>
      </div>
      <div className="panel p-5">
        <h2 className="font-display mb-3 font-bold">2 · Where did it land?</h2>
        {w.powerups.filter(p => p.is_active).length === 0 ? <Empty title="No power-ups yet">Add the wheel&apos;s segments in the Power-ups tab first.</Empty> :
          <div className="grid grid-cols-2 gap-2">{w.powerups.filter(p => p.is_active).map(p => (
            <button key={p.id} className="key flex-col items-start !whitespace-normal text-left" data-on={pu === p.id} onClick={() => { setPu(p.id); setMins(""); }}>
              <span className="flex w-full items-center gap-1.5"><Swatch c={p.color} />{p.name}</span>
              <span className="num text-[11px] font-normal text-muted">{fmtMins(p.minutes_delta)}{p.targets_rival && " · rival"}</span>
            </button>))}</div>}
        {power?.targets_rival && <div className="mt-4"><p className="eyebrow mb-2 flex items-center gap-1"><Swords size={12} /> Target team</p><TeamPicker w={w} paddle={paddle} value={target} onChange={setTarget} filter={t => t.id !== team} /></div>}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <L t="Override minutes"><input className="field num" type="number" placeholder={power ? String(power.minutes_delta) : "—"} value={mins} onChange={e => setMins(e.target.value)} /></L>
          <L t="Note"><input className="field" value={note} onChange={e => setNote(e.target.value)} placeholder="optional" /></L>
        </div>
        <button className="key-primary key-lg mt-4 w-full" disabled={!team || !pu || (power?.targets_rival && !target) || cmd.busy} onClick={award}><Disc3 size={18} /> Give {power?.name ?? "power-up"} to {name(team) || "…"}</button>
      </div>
      <div className="panel p-4">
        <h3 className="font-display mb-2 font-bold">Spin log</h3>
        {recent.length === 0 ? <p className="text-sm text-muted">No spins recorded.</p> : recent.map(p => (
          <div key={p.id} className="table-row flex items-center gap-2 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate"><b>{name(p.team_id)}</b> → {p.name}{p.target_team_id && <> on {name(p.target_team_id)}</>}</span>
            <span className="num text-xs text-muted">{fmtMins(p.minutes_delta)}</span>
            <button className="key key-sm" onClick={() => confirm("Revoke this result?") && cmd.run({ action: "revoke", id: p.id })}><Undo2 size={12} /></button>
          </div>))}
      </div>
    </div>
  );
}

/* ============================ BINGO ============================ */
function Bingo({ w, cmd, paddle, stageOf, staff }: Ctx) {
  const [team, setTeam] = useState("");
  const [edit, setEdit] = useState(false);
  const marked = new Set(w.marks.filter(m => m.team_id === team).map(m => m.idx));
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
          <TeamPicker w={w} paddle={paddle} value={team} onChange={t => { setTeam(t); setEdit(false); }} filter={t => stageOf(t.id, "bingo") !== "upcoming"} />
          <p className="mt-3 text-[11px] text-faint">Only teams whose bingo round is live or closed are listed. Open it under Rounds first.</p>
        </div>
        {staff.isHost && <div className="panel p-4">
          <h3 className="font-display mb-2">Rewards & bonuses</h3>
          <div className="grid grid-cols-2 gap-2">
            <L t="Per column (pts)"><input className="field num" type="number" value={colBonus} onChange={e => setColBonus(e.target.value)} /></L>
            <L t="Full card (pts)"><input className="field num" type="number" value={fullBonus} onChange={e => setFullBonus(e.target.value)} /></L>
          </div>
          <div className="mt-3 space-y-2">{[...LETTERS, "FULL"].map(k => (
            <div key={k} className="grid grid-cols-[44px_1fr] items-center gap-2"><span className="font-display grid h-9 place-items-center border border-graphite text-sm">{k === "FULL" ? "★" : k}</span>
              <input className="field" placeholder={k === "FULL" ? "Reward for full card" : `Reward for striking ${k}`} value={rw[k] ?? ""} onChange={e => setRw({ ...rw, [k]: e.target.value })} /></div>))}</div>
          <button className="key-primary mt-3 w-full" onClick={() => cmd.run({ action: "settings", bingo_rewards: rw, bingo_line_bonus: colBonus, bingo_full_bonus: fullBonus })}>Save rewards</button>
          <p className="mt-2 text-[11px] text-faint">Teams see the reward text under each letter. Bonus changes apply to columns completed after you save.</p>
        </div>}
      </div>
      <div className="panel p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-2xl">{edit ? "Edit squares" : tName ? `Stamping · ${tName}` : "Bingo board"}</h2>
          {staff.isHost && <button className="key key-sm" data-on={edit} onClick={() => setEdit(!edit)}><Pencil size={12} />{edit ? "Done editing" : "Edit squares"}</button>}
        </div>
        {edit ? <div className="grid grid-cols-5 gap-2">{w.cells.map(c => <CellEditor key={c.idx} c={c} cmd={cmd} />)}</div>
          : !team ? <Empty title="Choose a team">Tap a square to stamp a dare, and tap again to undo. Completing a column strikes its letter and pays the bonus automatically.</Empty>
          : <BingoBoard cells={w.cells} marked={marked} busy={cmd.busy} rewards={w.settings.bingo_rewards} onToggle={idx => cmd.run({ action: "bingo_toggle", team_id: team, idx })} />}
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
    <div className="flex aspect-square flex-col gap-1 border border-graphite bg-white p-1 shadow-[2px_2px_0_#111]">
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
              <select className="field" value={pu} onChange={e => setPu(e.target.value)}><option value="">Choose a power-up…</option>{w.powerups.map(p => <option key={p.id} value={p.id}>{p.name} ({fmtMins(p.minutes_delta)})</option>)}</select>
              {sel?.targets_rival && <select className="field" value={target} onChange={e => setTarget(e.target.value)}><option value="">Target team…</option>{w.teams.filter(t => t.id !== team).map(t => <option key={t.id} value={t.id}>{t.team_name}</option>)}</select>}
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
    </div>
  );
}

/* ============================ TEAMS ============================ */
function TeamsTab({ w, full, cmd, paddle, stageOf, staff, scope }: Ctx) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [nf, setNf] = useState({ team_name: "", bay: staff.venue ?? (scope && scope !== UNASSIGNED ? scope : ""), password: "" });
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [del, setDel] = useState<string[] | null>(null);
  const [confirmTxt, setConfirmTxt] = useState("");
  const list = w.teams.filter(t => !q || t.team_name.toLowerCase().includes(q.toLowerCase()) || t.username.toLowerCase().includes(q.toLowerCase()) || String(paddle[t.id]) === q.trim());
  const toggle = (id: string) => { const n = new Set(sel); n.has(id) ? n.delete(id) : n.add(id); setSel(n); };
  const name = (id: string) => full.teams.find(t => t.id === id)?.team_name ?? "?";
  const exportCsv = () => {
    const rows = [["Paddle", "Team", "Username", "Venue", "Points", "Auction", "Spin", "Bingo", "Lots won", "Bingo squares"]];
    w.teams.forEach(t => rows.push([String(paddle[t.id]), t.team_name, t.username, t.bay ?? "", String(w.balances[t.id] ?? 0), stageOf(t.id, "auction"), stageOf(t.id, "spin"), stageOf(t.id, "bingo"), String(w.purchases.filter(p => p.team_id === t.id).length), String(w.marks.filter(m => m.team_id === t.id).length)]));
    const csv = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `daemon-hour-teams-${new Date().toISOString().slice(0, 16)}.csv`; a.click();
  };
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
      <div className="panel overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-graphite p-4">
          <div className="relative min-w-[200px] flex-1"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" /><input className="field pl-9" placeholder="Search team, username or paddle" value={q} onChange={e => setQ(e.target.value)} /></div>
          <button className="key key-sm" onClick={() => setSel(new Set(list.map(t => t.id)))}><CheckSquare size={12} /> Select all</button>
          <button className="key key-sm" disabled={!sel.size} onClick={() => setSel(new Set())}><XCircle size={12} /> Clear</button>
          <button className="key key-sm" onClick={exportCsv}>Export CSV</button>
        </div>
        {staff.isHost && sel.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-graphite bg-frost/60 px-4 py-3 text-sm">
            <b className="num">{sel.size}</b> selected <MoveRight size={14} />
            {VENUES.map(v => <button key={v} className="key key-sm" onClick={() => cmd.run({ action: "team_move", team_ids: [...sel], bay: v })}>Move to {v}</button>)}
            <button className="key key-sm" onClick={() => cmd.run({ action: "team_move", team_ids: [...sel], bay: null })}>Unassign</button>
            <button className="key-danger key-sm ml-auto" onClick={() => { setDel([...sel]); setConfirmTxt(""); }}><Trash2 size={12} /> Delete</button>
          </div>
        )}
        <div className="max-h-[640px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-white text-left text-[10px] uppercase tracking-[.16em] text-muted"><tr className="border-b border-graphite">
              <th className="w-8 p-3" /><th className="p-3">#</th><th className="p-3">Team</th><th className="p-3">Login</th><th className="p-3">Venue</th><th className="p-3 text-right">Pts</th><th className="p-3">Rounds</th><th className="p-3" />
            </tr></thead>
            <tbody>{list.map(t => (
              <tr key={t.id} className={`table-row ${sel.has(t.id) ? "bg-frost/60" : ""}`}>
                <td className="p-3"><input type="checkbox" checked={sel.has(t.id)} onChange={() => toggle(t.id)} /></td>
                <td className="num p-3 text-faint">{String(paddle[t.id]).padStart(2, "0")}</td>
                <td className="p-3 font-semibold">{renaming?.id === t.id ? (
                  <form className="flex gap-1" onSubmit={async e => { e.preventDefault(); if (await cmd.run({ action: "team_rename", team_id: t.id, team_name: renaming.name })) setRenaming(null); }}>
                    <input autoFocus className="field !py-1" value={renaming.name} onChange={e => setRenaming({ id: t.id, name: e.target.value })} /><button className="key key-sm">Save</button><button type="button" className="key key-sm" onClick={() => setRenaming(null)}>×</button></form>
                ) : <button className="text-left hover:underline" title="Rename" onClick={() => setRenaming({ id: t.id, name: t.team_name })}>{t.team_name}</button>}</td>
                <td className="num p-3 text-xs">{t.username}</td>
                <td className="p-3">{staff.isHost ? (
                  <select className="border border-graphite bg-white px-1.5 py-1 text-xs" value={t.bay ?? ""} onChange={e => cmd.run({ action: "team_move", team_ids: [t.id], bay: e.target.value || null })}>
                    <option value="">Unassigned</option>{VENUES.map(v => <option key={v}>{v}</option>)}</select>) : <span className="text-xs">{t.bay}</span>}</td>
                <td className="num p-3 text-right font-semibold">{w.balances[t.id] ?? 0}</td>
                <td className="p-3"><span className="flex gap-1">{(["auction", "spin", "bingo"] as Activity[]).map(a => <StatusLed key={a} status={stageOf(t.id, a)} />)}</span></td>
                <td className="p-3"><div className="flex justify-end gap-1">
                  <button className="key key-sm" title="Reset password" onClick={() => { const pw = window.prompt(`New password for ${t.team_name} (min 6 chars). Leave blank for ${t.username}_123`, ""); if (pw !== null) cmd.run({ action: "team_password", team_id: t.id, password: pw }); }}><KeyRound size={12} /></button>
                  {staff.isHost && <button className="key key-sm" title="Delete team" onClick={() => { setDel([t.id]); setConfirmTxt(""); }}><Trash2 size={12} /></button>}
                </div></td>
              </tr>))}</tbody>
          </table>
          {list.length === 0 && <div className="p-5"><Empty title="No teams here">Change the venue filter above or add a team.</Empty></div>}
        </div>
      </div>

      <div className="space-y-5">
        <div className="panel foil p-5">
          <p className="eyebrow flex items-center gap-2"><UserPlus size={13} /> Add a team</p>
          <form className="mt-3 space-y-3" onSubmit={async e => { e.preventDefault(); if (await cmd.run({ action: "team_create", ...nf })) setNf({ ...nf, team_name: "", password: "" }); }}>
            <input className="field" required placeholder="Team name" value={nf.team_name} onChange={e => setNf({ ...nf, team_name: e.target.value })} />
            {staff.isHost ? <select className="field" value={nf.bay} onChange={e => setNf({ ...nf, bay: e.target.value })}><option value="">No venue yet</option>{VENUES.map(v => <option key={v}>{v}</option>)}</select>
              : <p className="text-xs text-muted">Will be added to <b>{staff.venue}</b>.</p>}
            <input className="field" placeholder="Password (blank = TEAMNAME_123)" value={nf.password} onChange={e => setNf({ ...nf, password: e.target.value })} />
            <button className="key-primary w-full" disabled={cmd.busy}>Create team & login</button>
          </form>
          <p className="mt-2 text-[11px] text-faint">The login username is the team name in CAPS_WITH_UNDERSCORES. Renaming a team later keeps its login.</p>
        </div>
        <div className="panel p-5">
          <p className="eyebrow">Venues</p>
          <div className="mt-3 space-y-2">{[...VENUES, null].map(v => {
            const ts = full.teams.filter(t => (v ? t.bay === v : !t.bay));
            return <div key={v ?? "none"} className="well flex items-center justify-between px-3 py-2 text-sm"><span className="font-semibold">{v ?? "Unassigned"}</span><span className="num text-xs">{ts.length} teams · {ts.reduce((a, t) => a + (full.balances[t.id] ?? 0), 0)} pts</span></div>;
          })}</div>
        </div>
      </div>

      {del && (
        <Modal title={`Delete ${del.length} team(s)?`} close={() => setDel(null)}>
          <p className="text-sm">This permanently removes <b>{del.map(name).join(", ")}</b>, their login, points, power-ups, bingo marks and history. There&apos;s no undo.</p>
          <p className="mt-3 text-xs text-muted">Type <b className="num">DELETE</b> to confirm.</p>
          <input className="field mt-2" value={confirmTxt} onChange={e => setConfirmTxt(e.target.value)} />
          <div className="mt-4 flex justify-end gap-2"><button className="key" onClick={() => setDel(null)}>Cancel</button>
            <button className="key-danger" disabled={confirmTxt !== "DELETE" || cmd.busy} onClick={async () => { if (await cmd.run({ action: "team_delete", team_ids: del })) { setDel(null); setSel(new Set()); } }}>Delete forever</button></div>
        </Modal>
      )}
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
            <select className="border border-graphite bg-white px-2 py-1 text-xs" value={r.venue ?? ""} disabled={r.me} onChange={async e => { await cmd.run({ action: "staff_save", id: r.id, venue: e.target.value }); load(); }}>
              <option value="">Host · all venues</option>{VENUES.map(v => <option key={v} value={v}>Admin · {v}</option>)}</select>
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
          <select className="field" value={f.venue} onChange={e => setF({ ...f, venue: e.target.value })}><option value="">Host · all venues</option>{VENUES.map(v => <option key={v} value={v}>Venue admin · {v}</option>)}</select>
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
