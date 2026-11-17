"use client";

import { effectText, kindLabel, phaseLabel } from "@/lib/cards";
import { useEffect, useMemo, useRef, useState } from "react";
import { Zap, Users, LifeBuoy, History, Gavel, Disc3, Grid3x3, Backpack, Lock, CheckCircle2, Trophy, Radio, Clock3, Coins, ArrowDownRight, ArrowUpRight, Swords, Sparkles } from "lucide-react";
import type { TeamView, Activity } from "@/lib/game";
import BingoBoard from "@/components/bingo-board";
import RapidFire from "@/components/rapid-fire";
import { onPulse, wantFastPulse } from "@/lib/pulse";
import RoundLedgers from "@/components/round-ledger";
import MemberTiles from "@/components/member-tiles";
import { COLUMNS } from "@/lib/bingo-shared";
import { Hourglass, LiveSync, useNow, fmtClock, fmtTime, fmtMins, StatusLed, Empty } from "@/components/ui";
import { useBroadcastSand } from "@/components/sand-clock";

type Tab = Activity | "loadout" | "history" | "team";
const TABS: { key: Tab; label: string; icon: typeof Gavel }[] = [
  { key: "quiz", label: "Rapid Fire", icon: Zap },
  { key: "auction", label: "Auction", icon: Gavel },
  { key: "spin", label: "Spin", icon: Disc3 },
  { key: "bingo", label: "Bingo", icon: Grid3x3 },
  { key: "loadout", label: "Loadout", icon: Backpack },
  { key: "history", label: "History", icon: History },
  { key: "team", label: "Team", icon: Users },
];

export default function TeamArena({ v, paddle }: { v: TeamView; paddle: number }) {
  const firstLive = (["quiz", "auction", "spin", "bingo"] as Activity[]).find(a => v.stages[a].status === "live");
  const [tab, setTab] = useState<Tab>(firstLive ?? "loadout");
  // Jump to a round the moment the admin opens it for this team.
  const prevLive = useRef(firstLive);
  useEffect(() => { if (firstLive && firstLive !== prevLive.current) setTab(firstLive); prevLive.current = firstLive; }, [firstLive]);

  if (v.locked) return (
    <section className="panel foil mx-auto mt-10 grid max-w-xl place-items-center p-10 text-center">
      <Hourglass mode="loader" size={80} />
      <p className="eyebrow mt-6">Portal paused</p>
      <h1 className="font-display mt-2 text-4xl">Hold tight</h1>
      <p className="mt-3 text-sm text-muted">{v.lockMessage || "The organisers have paused the portal for a moment. This page will come back on its own."}</p>
      <div className="mt-6"><LiveSync tables={["event_settings"]} pulse /></div>
    </section>
  );
  return (
    <div className="space-y-6">
      {v.broadcast && <Broadcast text={v.broadcast} />}
      <HelpButton open={v.helpOpen} />
      <Instrument v={v} paddle={paddle} />

      <div className="rail" role="tablist">
        {TABS.filter(t => t.key !== "quiz" || v.stages.quiz.status !== "upcoming").map(t => {
          const st = t.key === "loadout" || t.key === "history" || t.key === "team" ? null : v.stages[t.key].status;
          const Icon = t.icon;
          return (
            <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}>
              <Icon size={16} /> {t.label}
              {st && <StatusLed status={st} />}
              {t.key === "loadout" && v.powerups.length > 0 && <span className="num rounded-full bg-cobalt px-1.5 text-[10px] text-white">{v.powerups.length}</span>}
            </button>
          );
        })}
      </div>

      <div key={tab} className="animate-rise">
        {tab === "quiz" && <RapidFire />}
        {tab === "auction" && <Stage v={v} a="auction"><AuctionLive v={v} paddle={paddle} /></Stage>}
        {tab === "spin" && <Stage v={v} a="spin"><SpinLive v={v} /></Stage>}
        {tab === "bingo" && <Stage v={v} a="bingo"><BingoCard v={v} /></Stage>}
        {tab === "loadout" && <Loadout v={v} />}
        {tab === "history" && <HistoryFeed items={v.activity} />}
        {tab === "team" && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div><p className="eyebrow">{v.team?.bay ?? "Venue to be announced"} · paddle {String(paddle).padStart(2, "0")}</p><h2 className="font-display mt-1 text-4xl">Your team</h2></div>
              <span className="chip">{v.members.length} member{v.members.length === 1 ? "" : "s"}</span>
            </div>
            <MemberTiles teamId={v.team?.id ?? ""} members={v.members} />
            <p className="text-xs text-muted">See a wrong detail or a missing teammate? Tap <b>Need help</b> and an organiser will fix it.</p>
          </section>
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-muted">
        <span>Points and power-ups are set by the organisers. Your screen updates by itself.</span>
        <LiveSync tables={["transactions", "team_stages", "team_powerups", "team_bingo", "team_cards", "event_settings"]} every={8000} jitter={4000} teamId={v.team?.id} />
      </div>
    </div>
  );
}

function Broadcast({ text }: { text: string }) {
  return (
    <div className="panel-tight flex items-center gap-3 overflow-hidden px-4 py-2.5">
      <span className="chip shrink-0"><Radio size={12} className="text-ember" /> ANNOUNCEMENT</span>
      <div className="relative min-w-0 flex-1 overflow-hidden">
        <div className="ticker flex w-max gap-16 whitespace-nowrap text-sm font-medium">
          <span>{text}</span><span aria-hidden>{text}</span>
        </div>
      </div>
    </div>
  );
}

/* ---------------- The instrument cluster: clock + balance + rank ---------------- */
function Instrument({ v, paddle }: { v: TeamView; paddle: number }) {
  const now = useNow();
  const end = v.endAt ? new Date(v.endAt).getTime() : null;          // confirmed deadline
  const ref = v.pausedAt ? new Date(v.pausedAt).getTime() : now;
  const left = end && ref ? end - ref : null;
  // Sand = share of THIS team's time left: (deadline − now) / (deadline − start)
  const started = v.startedAt ? new Date(v.startedAt).getTime() : null;
  const total = end && started ? end - started : null;
  const fill = left == null || !total ? 1 : Math.max(0, Math.min(1, left / total));
  const running = !!end && !!started && !v.pausedAt && (left ?? 0) > 0;
  useBroadcastSand(fill, running);                                   // header logo + every hourglass follow this
  const heat = left == null ? "" : left < 2 * 60_000 ? "animate-pulse" : "";
  return (
    <section className="panel foil overflow-hidden p-5 sm:p-7">
      <div className="relative grid items-center gap-6 lg:grid-cols-[1fr_1.25fr_auto]">
        <div>
          <p className="eyebrow">Team · Paddle <span className="num text-graphite">#{String(paddle).padStart(2, "0")}</span>{v.team?.bay ? <> · {v.team.bay}</> : null}</p>
          <h1 className="font-display mt-1 text-4xl sm:text-5xl">{v.team?.team_name ?? "Your team"}</h1>
          <p className="mt-2 text-sm text-muted">Every power-up you earn moves your deadline once its round closes.</p>
        </div>

        <div className="lcd flex items-center gap-4 px-4 py-4 sm:gap-6 sm:px-6">
          <div className="shrink-0"><Hourglass fill={fill} running={running} size={58} tone="glass" /></div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-[.2em] text-muted">
              <span className="flex items-center gap-1.5"><Clock3 size={12} /> {v.pausedAt ? "Clock paused" : "Your hackathon ends"}</span>
              {v.minutes !== 0 && <span className={v.minutes > 0 ? "text-ok" : "text-err"}>{fmtMins(v.minutes)}</span>}
            </div>
            <div className={`mt-1 text-4xl font-bold tracking-tight sm:text-5xl ${heat}`}>{left == null ? "--:--:--" : fmtClock(left)}</div>
            <div className="mt-1 text-xs text-muted">
              {v.endAt ? <>Deadline <b className="text-white">{fmtTime(v.endAt)}</b>{v.minutes !== 0 && <> · was {fmtTime(v.baseEnd)}</>}</> : "Clock starts when the organisers set it"}
            </div>
            {v.pendingMinutes !== 0 && (
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-sm border border-[#2E2670] px-2 py-0.5 text-[11px] text-muted">
                <span className={v.pendingMinutes > 0 ? "text-ok" : "text-err"}>{fmtMins(v.pendingMinutes)}</span> pending · added when its round closes
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
          <Readout icon={Coins} label={v.pointsProvisional ? "Points · provisional" : "Points · confirmed"} value={v.balance.toLocaleString("en-IN")} />
          <Readout icon={Trophy} label="Standing" value={v.leaderboard ? `#${v.rank} / ${v.teamCount}` : "Hidden"} />
        </div>
      </div>
    </section>
  );
}
function Readout({ icon: Icon, label, value }: { icon: typeof Coins; label: string; value: string }) {
  return (
    <div className="well min-w-[150px] px-4 py-3">
      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.2em] text-muted"><Icon size={12} />{label}</p>
      <p className="num mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}

/* ---------------- Stage frame: upcoming / live / closed ---------------- */
const BLURB: Record<Activity, { title: string; upcoming: string }> = {
  quiz: { title: "Rapid Fire", upcoming: "A timed MCQ quiz, section by section." },
  auction: { title: "The Auction", upcoming: "Lots are bought with points by raising your paddle. The auctioneer records every sale for you; this screen only shows the results." },
  spin: { title: "Spin the Wheel", upcoming: "One trip to the wheel. Whatever it lands on is added to your loadout by the organisers." },
  bingo: { title: "Dare Bingo", upcoming: "Complete dares around campus and show a club member. Each cleared square earns points, and each full line earns a bonus." },
};

function Stage({ v, a, children }: { v: TeamView; a: Activity; children: React.ReactNode }) {
  const s = v.stages[a];
  if (s.status === "upcoming") {
    return (
      <section className="panel grid place-items-center px-6 py-16 text-center">
        <div className="well mb-5 grid h-16 w-16 place-items-center rounded-full"><Lock size={22} className="text-brass" /></div>
        <p className="eyebrow">Round not open yet</p>
        <h2 className="font-serif mt-2 text-4xl">{BLURB[a].title}</h2>
        <p className="mt-3 max-w-md text-sm leading-6 text-muted">{BLURB[a].upcoming}</p>
        <p className="mt-6 text-xs text-faint">Rounds open in turns for each venue, so other teams may already be playing. This tab unlocks when it&apos;s your turn.</p>
      </section>
    );
  }
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow flex items-center gap-2"><StatusLed status={s.status} /> {s.status === "live" ? "Round in progress" : "Round closed · final record"}</p>
          <h2 className="font-serif mt-1 text-4xl">{BLURB[a].title}</h2>
        </div>
        {s.status === "closed" && (
          <div className="flex gap-3">
            <div className="well px-4 py-2 text-right"><p className="eyebrow">Closed</p><p className="num font-bold">{fmtTime(s.closed_at)}</p></div>
            <div className="well px-4 py-2 text-right"><p className="eyebrow">Points confirmed</p><p className="num font-bold">{s.closing_points?.toLocaleString("en-IN") ?? "—"}</p></div>
            <div className="well px-4 py-2 text-right"><p className="eyebrow">Deadline at close</p><p className="num font-bold">{fmtTime(s.closing_end_at)}</p></div>
          </div>
        )}
      </div>
      <div className={s.status === "closed" ? "pointer-events-none select-none opacity-[.92] saturate-[.7]" : ""}>{children}</div>
    </section>
  );
}

/* ---------------- Auction ---------------- */
function AuctionLive({ v, paddle }: { v: TeamView; paddle: number }) {
  const live = v.stages.auction.status === "live";
  const spent = v.purchases.reduce((a, p) => a + p.purchase_price, 0);
  // Live price: websocket feed from the auctioneer wins over the (slower) server copy.
  // Live price: rides in the shared pulse (≈1.5 s while the auction is live), no socket needed.
  const [feed, setFeed] = useState<{ item_id: string | null; price: number } | null>(null);
  useEffect(() => onPulse(p => {
    const l = p.lots?.[v.venueKey] ?? p.lots?.all ?? null;
    setFeed(l ? { item_id: l.item_id, price: Number(l.price) } : { item_id: null, price: 0 });
  }), [v.venueKey]);
  useEffect(() => (live ? wantFastPulse() : undefined), [live]);
  const lotItemId = feed ? feed.item_id : v.liveLot?.item_id ?? null;
  const price = feed ? feed.price : v.liveLot?.price ?? 0;
  const item = lotItemId ? v.catalogue.find(i => i.id === lotItemId) ?? null : null;
  const prevPrice = useRef(price);
  const [flash, setFlash] = useState(false);
  useEffect(() => { if (prevPrice.current !== price) { setFlash(true); const t = setTimeout(() => setFlash(false), 600); prevPrice.current = price; return () => clearTimeout(t); } }, [price]);
  const canAfford = v.balance >= price;
  return (
    <div className="grid gap-5 lg:grid-cols-[1.25fr_.75fr]">
      <div className="space-y-5">
        {live && (
          <div className="panel foil p-6">
            <div className="flex items-center justify-between"><p className="eyebrow">On the block</p><span className="chip"><span className="led led-live" /> live</span></div>
            {item ? (
              <div className="mt-4 grid gap-5 sm:grid-cols-[1fr_auto] sm:items-end">
                <div>
                  <h3 className="font-display text-3xl">{item.item_name}</h3>
                  {item.description && <p className="mt-1 text-sm text-muted">{item.description}</p>}
                  {item.powerup && <p className="mt-2"><span className="chip"><Sparkles size={10} /> {item.powerup}{item.powerupMinutes ? ` · ${fmtMins(item.powerupMinutes)}` : ""}</span></p>}
                  <p className="mt-3 text-xs text-muted">Range <span className="num">{item.min_price ?? 0}–{item.max_price ?? "∞"}</span> · {Math.max(0, item.quantity - item.sold)} of {item.quantity} left</p>
                </div>
                <div className={`lcd px-6 py-4 text-right transition-colors ${flash ? "animate-flash" : ""}`}>
                  <p className="text-[10px] font-bold uppercase tracking-[.2em] opacity-70">Current price</p>
                  <p className="text-5xl font-bold tabular-nums">{price.toLocaleString("en-IN")}</p>
                  <p className={`mt-1 text-xs font-semibold ${canAfford ? "text-ok" : "text-err"}`}>{canAfford ? "You can afford this" : `You're ${price - v.balance} short`}</p>
                </div>
              </div>
            ) : <p className="mt-4 text-sm text-muted">The auctioneer is setting up the next lot…</p>}
          </div>
        )}
        <LotCatalogue v={v} onBlock={lotItemId} />
      </div>
      <div className="space-y-5">
        <div className="panel grid place-items-center p-6 text-center">
          <p className="eyebrow">Raise this when you bid</p>
          <div className="mt-3 grid h-36 w-36 place-items-center border-2 border-graphite bg-white shadow-[6px_6px_0_#6B4BFF]">
            <span className="font-display num text-6xl font-black">{String(paddle).padStart(2, "0")}</span>
          </div>
          <p className="mt-3 text-xs text-muted">The auctioneer records the sale. Your points update here right away.</p>
        </div>
        <div className="panel p-5">
          <div className="flex items-center justify-between"><h3 className="font-display font-bold">Your wins</h3><span className="num text-sm text-muted">−{spent.toLocaleString("en-IN")} pts</span></div>
          <div className="mt-3 space-y-2">
            {v.purchases.length === 0 ? <p className="text-sm text-muted">Nothing won yet.</p> : v.purchases.map(p => (
              <div key={p.id} className="well flex items-center gap-3 px-4 py-2.5 text-sm"><span className="min-w-0 flex-1 truncate font-medium">{p.item_name}</span><span className="num shrink-0">−{p.purchase_price}</span></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Spin ---------------- */
function SpinLive({ v }: { v: TeamView }) {
  const fromSpin = v.cards.filter(c => c.source === "spin").slice().reverse();
  const latest = fromSpin[0];
  return (
    <div className="grid gap-5 lg:grid-cols-[.9fr_1.1fr]">
      <div className="panel foil grid place-items-center overflow-hidden p-8 text-center">
        <p className="eyebrow">Spin round</p>
        {latest ? (
          <div className="mt-4">
            <p className="eyebrow">The wheel gave you</p>
            <p className="font-display animate-stamp mt-3 inline-block border-2 border-graphite bg-white px-5 py-3 text-3xl shadow-[4px_4px_0_#6B4BFF]">{latest.name}</p>
            <p className="mt-3 text-sm text-muted">{latest.detail || effectText(latest.kind, latest.effect)}</p>
          </div>
        ) : <p className="mt-4 max-w-xs text-sm text-muted">{v.stages.spin.status === "live" ? "Head to the physical wheel. Your result will appear here once the organisers record it." : "No spin result was recorded for your team."}</p>}
      </div>
      <div className="panel p-5">
        <h3 className="font-display font-bold">Spin results</h3>
        <div className="mt-4 space-y-2">{fromSpin.length === 0 ? <Empty title="No results yet" /> : fromSpin.map(c => (
          <div key={c.id} className="well flex items-center gap-4 px-4 py-3">
            <span className="w-16 shrink-0 text-[10px] font-bold uppercase tracking-wider text-faint">{kindLabel(c.kind)}</span>
            <div className="min-w-0 flex-1"><p className="font-semibold">{c.name}</p><p className="text-xs text-muted">{c.detail || effectText(c.kind, c.effect)}</p></div>
          </div>))}</div>
      </div>
    </div>
  );
}
/* ---------------- Bingo ---------------- */
function BingoCard({ v }: { v: TeamView }) {
  const marked = new Set(v.marked);
  const free = new Set(v.cells.filter(c => c.is_free).map(c => c.idx));
  const done = (l: number[]) => l.every(i => marked.has(i) || free.has(i));
  const cols = COLUMNS.filter(done).length;
  const rows = [0, 1, 2, 3, 4].map(r => [0, 1, 2, 3, 4].map(c => r * 5 + c)).filter(done).length;
  const full = cols === 5;
  const lines = v.bingoMode === "rows" ? rows : v.bingoMode === "columns" ? cols : 0;
  const pts = v.cells.filter(c => marked.has(c.idx)).reduce((a, c) => a + c.points, 0) + lines * v.lineBonus + (full ? v.fullBonus : 0);
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
      <div className="panel p-4 sm:p-6"><BingoBoard cells={v.cells} marked={marked} rewards={v.rewards} mode={v.bingoMode} /></div>
      <div className="space-y-4">
        <div className={`panel p-4 ${v.bingoMode ? "bg-cobalt-wash" : ""}`}>
          <p className="eyebrow">Your direction</p>
          <p className="font-display mt-1 text-2xl font-black">{v.bingoMode === "rows" ? "ROWS ONLY" : v.bingoMode === "columns" ? "COLUMNS ONLY" : "Not decided yet"}</p>
          <p className="mt-1 text-xs text-muted">{v.bingoMode ? `You finished a ${v.bingoMode === "rows" ? "row" : "column"} first, so only ${v.bingoMode} earn the line bonus for the rest of the round.` : "Your first full row or column decides: after that, only lines in that direction earn the bonus."}</p>
        </div>
        <Readout icon={CheckCircle2} label="Dares cleared" value={`${v.marked.length} / ${v.cells.filter(c => !c.is_free).length}`} />
        <Readout icon={Grid3x3} label={v.bingoMode === "rows" ? "Rows done" : "Columns done"} value={`${v.bingoMode === "rows" ? rows : cols} / 5`} />
        <Readout icon={Coins} label="Bingo points" value={`+${pts}`} />
        <p className="text-xs leading-5 text-muted">Show a club member each dare and they&apos;ll stamp it here. Each line in your direction earns <b className="num text-graphite">+{v.lineBonus}</b>. Strike all five for the full card: <b className="num text-graphite">+{v.fullBonus}</b>.</p>
      </div>
    </div>
  );
}

/* ---------------- Loadout: power-ups + deadline timeline ---------------- */
function PowerRow({ p, me }: { p: TeamView["powerups"][number]; me: string }) {
  const incoming = p.target_team_id === me && p.team_id !== me;
  return (
    <div className={`well flex items-center gap-3 px-3 py-2.5 ${p.used ? "opacity-55" : ""}`}>
      <div className={`grid h-9 w-9 place-items-center rounded-lg ${incoming ? "bg-ember/15 text-ember" : "bg-cobalt-wash text-cobalt-ink"}`}>{incoming ? <Swords size={16} /> : <Sparkles size={16} />}</div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{p.name} {p.used && <span className="chip ml-1">USED</span>}{!p.confirmed && <span className="chip ml-1" title="Counts once this round is closed">pending</span>}</p>
        <p className="truncate text-xs text-muted">{incoming ? `Played on you by ${p.from_name}` : p.target_name ? `Aimed at ${p.target_name}` : `From ${p.source}`}{p.note ? ` · ${p.note}` : ""}</p>
      </div>
      {p.minutes_delta !== 0 && <span className={`num text-sm font-bold ${(incoming || p.target_team_id) ? (incoming ? "text-err" : "text-muted") : p.minutes_delta > 0 ? "text-ok" : "text-err"}`}>{fmtMins(p.minutes_delta)}</span>}
    </div>
  );
}

function Loadout({ v }: { v: TeamView }) {
  const me = v.team?.id ?? "";
  // Build a deadline timeline: each time-changing event, oldest first.
  const affecting = [...v.powerups].filter(p => p.minutes_delta !== 0 && (p.target_team_id ? p.target_team_id === me : p.team_id === me)).reverse();
  // Confirmed effects move the deadline in order; pending ones are listed after, not yet counted.
  let running = 0;
  const steps = affecting.filter(p => p.confirmed).map(p => { running += p.minutes_delta; return { p, running, at: v.baseEnd ? new Date(new Date(v.baseEnd).getTime() + running * 60000).toISOString() : null }; });
  const pending = affecting.filter(p => !p.confirmed);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <MyCards v={v} />
      <div className="panel p-5">
        <div className="flex items-center justify-between"><h3 className="font-display text-lg font-bold">Power-ups</h3><span className="chip">{v.powerups.filter(p => !p.used).length} ready</span></div>
        <div className="mt-4 space-y-2">{v.powerups.length === 0 ? <Empty title="Empty loadout">Win lots, spin the wheel or clear dares to collect power-ups.</Empty> : v.powerups.map(p => <PowerRow key={p.id} p={p} me={me} />)}</div>
      </div>
      <div className="panel p-5">
        <h3 className="font-display text-lg font-bold">Deadline timeline</h3>
        <ol className="mt-4 space-y-5 border-l-2 border-dashed border-silver pl-6">
          <li className="relative"><span className="absolute -left-[31px] top-1 h-3 w-3 rounded-full border-2 border-white bg-faint shadow" /><p className="text-xs text-muted">Official deadline</p><p className="num font-bold">{fmtTime(v.baseEnd)}</p></li>
          {steps.map(({ p, at }) => (
            <li key={p.id} className="animate-rise relative"><span className={`absolute -left-[31px] top-1 h-3 w-3 rounded-full border-2 border-white shadow ${p.minutes_delta > 0 ? "bg-ok" : "bg-err"}`} />
              <p className="text-xs text-muted">{p.name} <span className="num font-semibold text-ok">{fmtMins(p.minutes_delta)}</span></p><p className="num font-bold">{v.baseEnd ? fmtTime(at) : "Set when the clock starts"}</p></li>
          ))}
          <li className="relative"><span className="absolute -left-[33px] top-0.5 h-4 w-4 rounded-full border-2 border-white bg-cobalt shadow" /><p className="text-xs font-semibold text-cobalt-ink">Your deadline now</p><p className="num text-2xl font-black">{fmtTime(v.endAt)}</p></li>
          {pending.map(p => (
            <li key={p.id} className="relative opacity-70"><span className="absolute -left-[31px] top-1 h-3 w-3 rounded-full border-2 border-dashed border-cobalt bg-white" />
              <p className="text-xs text-muted">{p.name} <span className="num">{fmtMins(p.minutes_delta)}</span> · pending</p>
              <p className="text-[11px] text-faint">Added when the {p.source} round closes</p></li>
          ))}
        </ol>
      </div>
      <div className="lg:col-span-2"><RoundLedgers rows={v.ledger} baseEnd={v.baseEnd} /></div>
      {v.leaderboard && (
        <div className="panel p-5 lg:col-span-2">
          <h3 className="font-display text-lg font-bold">Top of the board</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-5">{v.leaderboard.map((t, i) => (
            <div key={t.id} className={`well px-3 py-3 ${t.id === me ? "ring-2 ring-cobalt" : ""}`}><p className="num text-xs text-muted">#{i + 1}</p><p className="truncate font-semibold">{t.name}</p><p className="num text-sm">{t.points}</p></div>
          ))}</div>
        </div>
      )}
    </div>
  );
}

/* ---------------- History: everything granted or removed ---------------- */
export function HistoryFeed({ items, teamName }: { items: TeamView["activity"]; teamName?: (id: string | null) => string }) {
  const [kind, setKind] = useState("all");
  const kinds = ["all", "points", "powerup", "auction", "bingo", "round", "team"];
  const list = items.filter(i => {
    if (kind === "all") return true;
    if (kind === "points") return i.kind === "points" || (i.points != null && i.points !== 0);
    return i.kind === kind;
  });
  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-graphite p-4">
        <h3 className="font-display mr-auto text-lg">History</h3>
        {kinds.map(k => <button key={k} className="key key-sm uppercase" data-on={kind === k} onClick={() => setKind(k)}>{k}</button>)}
      </div>
      {list.length === 0 ? (
        <div className="p-5">
          <Empty title={kind === "all" ? "Nothing here yet" : `No ${kind} entries yet`}>
            {kind === "all"
              ? "Every grant, removal, sale, stamp and round change will be listed here with its time."
              : `Switch to ALL to see all activity.`}
          </Empty>
        </div>
      ) : (
        list.map(i => (
          <div key={i.id} className="table-row grid grid-cols-[76px_1fr_auto] items-center gap-3 px-4 py-2.5 text-sm sm:grid-cols-[90px_96px_1fr_auto_auto]">
            <span className="num text-xs text-muted">{new Date(i.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
            <span className="chip hidden justify-center sm:inline-flex">{i.kind}</span>
            <span className="min-w-0 truncate">
              <b className={["removed", "unstamped", "refunded"].includes(i.action) ? "text-err" : ["granted", "stamped", "opened"].includes(i.action) ? "text-ok" : ""}>{i.action}</b>
              {" · "}{i.label}{teamName && i.team_id ? <span className="text-muted"> · {teamName(i.team_id)}</span> : null}
            </span>
            <span className={`num hidden text-right text-xs sm:block ${(i.minutes ?? 0) < 0 ? "text-err" : "text-ok"}`}>{i.minutes ? fmtMins(i.minutes) : ""}</span>
            <span className={`num w-16 text-right font-semibold ${(i.points ?? 0) < 0 ? "text-err" : "text-ok"}`}>{i.points ? `${i.points > 0 ? "+" : ""}${i.points}` : ""}</span>
          </div>
        ))
      )}
    </div>
  );
}

/* ---------------- Need help ---------------- */
function HelpButton({ open }: { open: boolean }) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(open);
  useEffect(() => setSent(open), [open]);
  const send = async (cancel = false) => {
    let message: string | null = null;
    if (!cancel) { message = window.prompt("What do you need? (optional)", ""); if (message === null) return; }
    setBusy(true);
    await fetch("/api/team/help", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cancel ? { cancel: true } : { message }) }).catch(() => null);
    setSent(!cancel); setBusy(false);
  };
  return (
    <div className="fixed bottom-5 left-5 z-40">
      {sent
        ? <button className="key-primary key-lg" disabled={busy} onClick={() => send(true)} title="Tap to cancel"><LifeBuoy size={18} className="animate-spin [animation-duration:3s]" /> Help is on the way</button>
        : <button className="key key-lg" disabled={busy} onClick={() => send()}><LifeBuoy size={18} /> Need help</button>}
    </div>
  );
}

/* ---------------- Your cards, problem statement, penalties ---------------- */
function MyCards({ v }: { v: TeamView }) {
  const me = v.team?.id ?? "";
  return (
    <div className="panel p-5 lg:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-display text-lg font-bold">Your cards</h3><span className="chip">{v.cards.length} held</span></div>
      <div className="well mt-4 px-4 py-3">
        <p className="text-[10px] font-bold uppercase tracking-[.18em] text-muted">Problem statement {v.psLocked && "· final"}</p>
        <p className="mt-1 text-sm font-semibold">{v.problemStatement || <span className="font-normal text-faint">Not assigned yet</span>}</p>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {v.cards.length === 0 ? <div className="sm:col-span-2"><Empty title="No cards yet">Cards you win at the auction show here.</Empty></div> : v.cards.map(c => {
          const auto = ["time", "points", "bingo"].includes(c.kind);
          const tag = c.status === "spent" ? "USED" : c.status === "pending" ? "TELL AN ORGANISER WHICH CARD" : c.status === "resolved" ? "COPIED" : auto ? "APPLIED" : "";
          return (
            <div key={c.id} className={`well flex items-center gap-4 px-4 py-3 ${c.status === "spent" || c.status === "resolved" ? "opacity-60" : ""}`}>
              <div className="min-w-0 flex-1"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-faint">{c.kind === "note" ? phaseLabel(c.effect?.phase) : kindLabel(c.kind)}{c.source === "spin" ? " · wheel" : ""}</p><p className="mt-0.5 truncate text-sm font-semibold">{c.name}{c.source === "trump" && <span className="font-normal text-muted"> · via trump</span>}</p>
                <p className="truncate text-xs text-muted">{c.detail || effectText(c.kind, c.effect)}</p></div>
              {tag && <span className={`chip !text-[9px] ${c.status === "spent" ? "" : c.status === "pending" ? "text-err" : "text-ok"}`}>{tag}</span>}
            </div>
          );
        })}
      </div>
      {v.penalties.length > 0 && (
        <div className="mt-4 border-t border-silver/70 pt-3">
          <p className="text-[10px] font-bold uppercase tracking-[.18em] text-muted">Penalties</p>
          {v.penalties.map(p => (
            <p key={p.id} className="mt-1 text-sm">{p.team_id !== me && <>From <b>{p.from_name}</b>: </>}{p.reason}
              <span className="num text-err"> {[p.minutes ? `−${p.minutes} min` : "", p.points ? `−${p.points} pts` : ""].filter(Boolean).join(" ")}</span>
              <span className="text-muted"> · {p.outcome === "applied" ? "taken" : p.outcome === "blocked" ? "blocked by your No penalties card" : p.outcome === "passed" ? (p.landed_team_id === me ? "received" : `passed to ${p.landed_name}`) : "passed on, then skipped"}</span></p>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- Lot catalogue: one clear row per lot ---------------- */
function LotCatalogue({ v, onBlock }: { v: TeamView; onBlock: string | null }) {
  const status = (i: TeamView["catalogue"][number]) =>
    i.id === onBlock ? { label: "On the block", cls: "bg-graphite text-white" }
    : i.mine > 0 ? { label: "Yours", cls: "bg-ok text-white" }
    : i.sold >= i.quantity ? { label: `Sold · ${i.buyers.join(", ")}`, cls: "bg-frost text-faint" }
    : { label: "Available", cls: "bg-white" };
  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-graphite px-5 py-4">
        <h3 className="font-display">Card catalogue</h3>
        <span className="num text-xs text-muted">{v.catalogue.filter(i => i.sold < i.quantity).length} of {v.catalogue.length} available</span>
      </div>
      {v.catalogue.length === 0 ? <div className="p-5"><Empty title="No lots announced yet" /></div> : (
        <>
          {/* header (desktop) */}
          <div className="hidden grid-cols-[36px_minmax(0,1.6fr)_minmax(0,1.2fr)_110px_70px_118px] gap-3 border-b border-silver/30 bg-frost/50 px-5 py-2 text-[10px] font-bold uppercase tracking-[.16em] text-muted md:grid">
            <span>#</span><span>Card</span><span>Gives you</span><span className="text-right">Price range</span><span className="text-right">Type</span><span className="text-right">Status</span>
          </div>
          {v.catalogue.map((i, n) => {
            const st = status(i);
            return (
              <div key={i.id} className={`table-row grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-5 py-3 md:grid-cols-[36px_minmax(0,1.5fr)_minmax(0,1.3fr)_110px_80px_170px] ${i.id === onBlock ? "bg-cobalt-wash" : ""} ${i.sold >= i.quantity && i.mine === 0 ? "opacity-60" : ""}`}>
                <span className="num text-xs text-faint">{String(n + 1).padStart(2, "0")}</span>
                <div className="min-w-0">
                  <p className="truncate font-semibold">{i.item_name}</p>
                  {i.description && <p className="truncate text-xs text-muted">{i.description}</p>}
                </div>
                <span title={st.label} className={`max-w-[170px] justify-self-end truncate border border-graphite px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider md:order-last ${st.cls}`}>{st.label}</span>
                <div className="col-start-2 min-w-0 text-xs md:col-start-auto">
                  <span className="inline-flex items-center gap-1 font-semibold"><Sparkles size={11} />{effectText(i.kind, i.effect)}</span>
                </div>
                <span className="num col-start-2 text-xs text-muted md:col-start-auto md:text-right">{i.min_price ?? i.base_points}–{i.max_price ?? "∞"} pts</span>
                <span className="hidden text-right text-[10px] font-bold uppercase tracking-wider text-muted md:block">{kindLabel(i.kind)}</span>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
