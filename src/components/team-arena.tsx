"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Gavel, Disc3, Grid3x3, Backpack, Lock, CheckCircle2, Trophy, Radio, Clock3, Coins, ArrowDownRight, ArrowUpRight, Swords, Sparkles } from "lucide-react";
import type { TeamView, Activity } from "@/lib/game";
import { Hourglass, LiveSync, useNow, fmtClock, fmtTime, fmtMins, StatusLed, Empty } from "@/components/ui";

type Tab = Activity | "loadout";
const TABS: { key: Tab; label: string; icon: typeof Gavel }[] = [
  { key: "auction", label: "Auction", icon: Gavel },
  { key: "spin", label: "Spin", icon: Disc3 },
  { key: "bingo", label: "Bingo", icon: Grid3x3 },
  { key: "loadout", label: "Loadout", icon: Backpack },
];

export default function TeamArena({ v, paddle }: { v: TeamView; paddle: number }) {
  const firstLive = (["auction", "spin", "bingo"] as Activity[]).find(a => v.stages[a].status === "live");
  const [tab, setTab] = useState<Tab>(firstLive ?? "loadout");
  // Jump to a round the moment the admin opens it for this team.
  const prevLive = useRef(firstLive);
  useEffect(() => { if (firstLive && firstLive !== prevLive.current) setTab(firstLive); prevLive.current = firstLive; }, [firstLive]);

  return (
    <div className="space-y-6">
      {v.broadcast && <Broadcast text={v.broadcast} />}
      <Instrument v={v} paddle={paddle} />

      <div className="rail" role="tablist">
        {TABS.map(t => {
          const st = t.key === "loadout" ? null : v.stages[t.key].status;
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
        {tab === "auction" && <Stage v={v} a="auction"><AuctionLive v={v} paddle={paddle} /></Stage>}
        {tab === "spin" && <Stage v={v} a="spin"><SpinLive v={v} /></Stage>}
        {tab === "bingo" && <Stage v={v} a="bingo"><BingoCard v={v} /></Stage>}
        {tab === "loadout" && <Loadout v={v} />}
      </div>

      <div className="flex items-center justify-between text-xs text-muted">
        <span>Points and power-ups are set by the organisers. Your screen updates by itself.</span>
        <LiveSync tables={["transactions", "purchases", "team_stages", "team_powerups", "team_bingo", "event_settings"]} />
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
  const end = v.endAt ? new Date(v.endAt).getTime() : null;
  const base = v.baseEnd ? new Date(v.baseEnd).getTime() : null;
  const left = end && now ? end - now : null;
  // Fill relative to a 24h hackathon window, capped.
  const fill = left == null ? 0.65 : Math.max(0, Math.min(1, left / (24 * 3600_000)));
  return (
    <section className="panel foil overflow-hidden p-5 sm:p-7">
      <div className="pointer-events-none absolute inset-0 paper-grid opacity-50 [mask-image:linear-gradient(90deg,transparent,black_60%)]" />
      <div className="relative grid items-center gap-6 lg:grid-cols-[auto_1fr_auto]">
        <div className="flex items-center gap-5">
          <div className="well grid h-[140px] w-[112px] place-items-center"><Hourglass fill={fill} size={80} /></div>
          <div>
            <p className="eyebrow">Team · Paddle <span className="num text-graphite">#{String(paddle).padStart(2, "0")}</span></p>
            <h1 className="font-display mt-1 text-3xl font-black sm:text-4xl">{v.team?.team_name ?? "Your team"}</h1>
            <p className="mt-1 text-sm text-muted">{v.team?.bay ? <>Stationed at <b className="text-graphite">{v.team.bay}</b></> : "Bid it · Spin it · Bingo it"}</p>
          </div>
        </div>

        <div className="lcd px-5 py-4">
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[.2em] opacity-70">
            <span className="flex items-center gap-1.5"><Clock3 size={12} /> Your hackathon ends</span>
            {v.minutes !== 0 && <span className={v.minutes > 0 ? "text-ok" : "text-err"}>{fmtMins(v.minutes)}</span>}
          </div>
          <div className="mt-1 text-4xl font-bold tracking-tight sm:text-5xl">{left == null ? "--:--:--" : fmtClock(left)}</div>
          <div className="mt-1 text-xs opacity-75">
            {v.endAt ? <>Deadline <b>{fmtTime(v.endAt)}</b>{base && v.minutes !== 0 && <> · was {fmtTime(v.baseEnd)}</>}</> : "Clock starts when the organisers set it"}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
          <Readout icon={Coins} label="Points" value={v.balance.toLocaleString("en-IN")} />
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
            <div className="well px-4 py-2 text-right"><p className="eyebrow">Points then</p><p className="num font-bold">{s.closing_points?.toLocaleString("en-IN") ?? "—"}</p></div>
            <div className="well px-4 py-2 text-right"><p className="eyebrow">Deadline then</p><p className="num font-bold">{fmtTime(s.closing_end_at)}</p></div>
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
  const lot = v.liveLot;
  const prevPrice = useRef(lot?.price);
  const [flash, setFlash] = useState(false);
  useEffect(() => { if (lot && prevPrice.current !== lot.price) { setFlash(true); setTimeout(() => setFlash(false), 900); } prevPrice.current = lot?.price; }, [lot?.price, lot]);
  const canAfford = lot ? v.balance >= lot.price : false;
  return (
    <div className="grid gap-5 lg:grid-cols-[1.25fr_.75fr]">
      <div className="space-y-5">
        {live && (
          <div className="panel foil p-6">
            <div className="flex items-center justify-between"><p className="eyebrow">On the block</p><span className="chip"><span className="led led-live" /> live lot</span></div>
            {lot?.item ? (
              <div className="mt-4 grid gap-5 sm:grid-cols-[1fr_auto] sm:items-end">
                <div>
                  <h3 className="font-display text-3xl font-black">{lot.item.item_name}</h3>
                  {lot.item.description && <p className="mt-1 text-sm text-muted">{lot.item.description}</p>}
                  <p className="mt-3 text-xs text-muted">Range <span className="num">{lot.item.min_price ?? 0}–{lot.item.max_price ?? "∞"}</span> · {Math.max(0, lot.item.quantity - lot.sold)} of {lot.item.quantity} left</p>
                </div>
                <div className={`lcd px-6 py-4 text-right ${flash ? "animate-flash" : ""}`}>
                  <p className="text-[10px] font-bold uppercase tracking-[.2em] opacity-70">Current price</p>
                  <p className="text-5xl font-bold">{lot.price.toLocaleString("en-IN")}</p>
                  <p className={`mt-1 text-xs font-semibold ${canAfford ? "text-ok" : "text-err"}`}>{canAfford ? "You can afford this" : `You're ${lot.price - v.balance} short`}</p>
                </div>
              </div>
            ) : <p className="mt-4 text-sm text-muted">The auctioneer is setting up the next lot…</p>}
          </div>
        )}
        <div className="panel overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4"><h3 className="font-display font-bold">Lot catalogue</h3><span className="text-xs text-muted">{v.catalogue.length} lots</span></div>
          {v.catalogue.length === 0 ? <div className="p-5"><Empty title="No lots announced yet" /></div> :
            v.catalogue.map(i => (
              <div key={i.id} className={`table-row flex items-center gap-4 px-5 py-3 ${lot?.item_id === i.id ? "bg-cobalt-wash" : ""}`}>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{i.item_name} {i.powerup && <span className="chip ml-1"><Sparkles size={10} /> {i.powerup}</span>}</p>
                  {i.description && <p className="truncate text-xs text-muted">{i.description}</p>}
                </div>
                <span className="num text-xs text-muted">{i.min_price ?? i.base_points}–{i.max_price ?? "∞"}</span>
                <span className={`chip ${i.sold >= i.quantity ? "text-faint" : ""}`}>{i.sold >= i.quantity ? "SOLD OUT" : `${i.quantity - i.sold} left`}</span>
              </div>
            ))}
        </div>
      </div>
      <div className="space-y-5">
        <div className="panel grid place-items-center p-6 text-center">
          <p className="eyebrow">Raise this when you bid</p>
          <div className="mt-3 grid h-36 w-36 place-items-center border-2 border-graphite bg-white shadow-[6px_6px_0_#111]">
            <span className="font-display num text-6xl font-black">{String(paddle).padStart(2, "0")}</span>
          </div>
          <p className="mt-3 text-xs text-muted">The auctioneer records the sale. Your points update here right away.</p>
        </div>
        <div className="panel p-5">
          <div className="flex items-center justify-between"><h3 className="font-display font-bold">Your wins</h3><span className="num text-sm text-muted">−{spent.toLocaleString("en-IN")} pts</span></div>
          <div className="mt-3 space-y-2">
            {v.purchases.length === 0 ? <p className="text-sm text-muted">Nothing won yet.</p> : v.purchases.map(p => (
              <div key={p.id} className="well flex items-center justify-between px-3 py-2 text-sm"><span className="font-medium">{p.item_name}</span><span className="num">−{p.purchase_price}</span></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Spin ---------------- */
function SpinLive({ v }: { v: TeamView }) {
  const fromSpin = v.powerups.filter(p => p.source === "spin" && p.team_id === v.team?.id);
  const latest = fromSpin[0];
  return (
    <div className="grid gap-5 lg:grid-cols-[.9fr_1.1fr]">
      <div className="panel foil grid place-items-center overflow-hidden p-8 text-center">
        <p className="eyebrow">Spin round</p>
        {latest ? (
          <div className="mt-4">
            <p className="eyebrow">The wheel gave you</p>
            <p className="font-display animate-stamp mt-2 inline-block border-2 border-graphite bg-white px-4 py-2 text-3xl shadow-[4px_4px_0_#5878D8]">{latest.name}</p>
            {latest.minutes_delta !== 0 && <p className="num mt-2 text-sm text-muted">{fmtMins(latest.minutes_delta)} {latest.target_name ? `to ${latest.target_name}` : "to your deadline"}</p>}
          </div>
        ) : <p className="mt-4 max-w-xs text-sm text-muted">{v.stages.spin.status === "live" ? "Head to the physical wheel. Your result will appear here once the organisers record it." : "No spin result was recorded for your team."}</p>}
      </div>
      <div className="panel p-5">
        <h3 className="font-display font-bold">Spin results</h3>
        <div className="mt-3 space-y-2">{fromSpin.length === 0 ? <Empty title="No results yet" /> : fromSpin.map(p => <PowerRow key={p.id} p={p} me={v.team?.id ?? ""} />)}</div>
      </div>
    </div>
  );
}
/* ---------------- Bingo: a paper card with ink stamps ---------------- */
function BingoCard({ v }: { v: TeamView }) {
  const marked = new Set(v.marked);
  const free = new Set(v.cells.filter(c => c.is_free).map(c => c.idx));
  const lines = useMemo(() => {
    const L = [[0,1,2,3,4],[5,6,7,8,9],[10,11,12,13,14],[15,16,17,18,19],[20,21,22,23,24],[0,5,10,15,20],[1,6,11,16,21],[2,7,12,17,22],[3,8,13,18,23],[4,9,14,19,24],[0,6,12,18,24],[4,8,12,16,20]];
    return L.filter(l => l.every(i => marked.has(i) || free.has(i)));
  }, [v.marked, v.cells]); // eslint-disable-line react-hooks/exhaustive-deps
  const inLine = new Set(lines.flat());
  const pts = v.cells.filter(c => marked.has(c.idx)).reduce((a, c) => a + c.points, 0) + lines.length * v.lineBonus;
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
      <div className="panel p-4 sm:p-6" style={{ background: "linear-gradient(180deg,#FFFDF8,#FBF7EE)" }}>
        <div className="mb-4 flex items-end justify-between">
          <h3 className="font-display text-5xl font-black tracking-tight sm:text-6xl" >BINGO</h3>
          <span className="font-serif text-lg italic text-muted">MD Club · Daemon Hour</span>
        </div>
        <div className="grid grid-cols-5 overflow-hidden rounded-lg border-2 border-graphite">
          {v.cells.map(c => {
            const on = marked.has(c.idx) || c.is_free;
            return (
              <div key={c.idx} className={`relative grid aspect-square place-items-center border border-graphite/70 p-1 text-center text-[9.5px] leading-tight sm:p-2 sm:text-xs ${inLine.has(c.idx) ? "bg-sea/25" : ""}`}>
                {c.is_free ? <img src="/md-logo.svg" alt="MD Club" className="h-3/5 w-3/5 object-contain" /> : <span className={on ? "text-muted" : ""}>{c.label}</span>}
                {on && !c.is_free && (
                  <span className="animate-stamp pointer-events-none absolute inset-[12%] grid place-items-center rounded-full border-[3px] border-cobalt-ink/80 text-[10px] font-black uppercase tracking-widest text-cobalt-ink/90 mix-blend-multiply sm:text-xs" style={{ background: "radial-gradient(circle, rgba(88,120,216,.12), rgba(88,120,216,.04))" }}>
                    done{c.points ? <span className="num absolute bottom-[14%] text-[9px]">+{c.points}</span> : null}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="space-y-4">
        <Readout icon={CheckCircle2} label="Dares cleared" value={`${v.marked.length} / ${v.cells.filter(c => !c.is_free).length}`} />
        <Readout icon={Grid3x3} label="Lines" value={`${lines.length}`} />
        <Readout icon={Coins} label="Bingo points" value={`+${pts}`} />
        <p className="text-xs leading-5 text-muted">Show a club member each dare. They&apos;ll stamp it, and it appears here a moment later. Each full row, column or diagonal earns <b className="num text-graphite">+{v.lineBonus}</b>.</p>
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
        <p className="truncate text-sm font-semibold">{p.name} {p.used && <span className="chip ml-1">USED</span>}</p>
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
  let running = 0;
  const steps = affecting.map(p => { running += p.minutes_delta; return { p, running, at: v.baseEnd ? new Date(new Date(v.baseEnd).getTime() + running * 60000).toISOString() : null }; });
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="panel p-5">
        <div className="flex items-center justify-between"><h3 className="font-display text-lg font-bold">Power-ups</h3><span className="chip">{v.powerups.filter(p => !p.used).length} ready</span></div>
        <div className="mt-4 space-y-2">{v.powerups.length === 0 ? <Empty title="Empty loadout">Win lots, spin the wheel or clear dares to collect power-ups.</Empty> : v.powerups.map(p => <PowerRow key={p.id} p={p} me={me} />)}</div>
      </div>
      <div className="panel p-5">
        <h3 className="font-display text-lg font-bold">Deadline timeline</h3>
        <ol className="relative mt-4 space-y-4 border-l-2 border-dashed border-silver pl-5">
          <li><span className="absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-faint shadow" /><p className="text-xs text-muted">Official deadline</p><p className="num font-bold">{fmtTime(v.baseEnd)}</p></li>
          {steps.map(({ p, at }) => (
            <li key={p.id} className="animate-rise"><span className={`absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full border-2 border-white shadow ${p.minutes_delta > 0 ? "bg-ok" : "bg-err"}`} />
              <p className="text-xs text-muted">{p.name} <span className="num">{fmtMins(p.minutes_delta)}</span></p><p className="num font-bold">{fmtTime(at)}</p></li>
          ))}
          <li><span className="absolute -left-[8px] mt-1 h-4 w-4 rounded-full border-2 border-white bg-cobalt shadow" /><p className="text-xs font-semibold text-cobalt-ink">Your deadline now</p><p className="num text-2xl font-black">{fmtTime(v.endAt)}</p></li>
        </ol>
      </div>
      <div className="panel overflow-hidden lg:col-span-2">
        <div className="flex items-center justify-between px-5 py-4"><h3 className="font-display text-lg font-bold">Points ledger</h3><span className="num text-sm">{v.balance.toLocaleString("en-IN")} pts</span></div>
        {v.txs.length === 0 ? <div className="p-5"><Empty title="No entries yet" /></div> : v.txs.map(t => (
          <div key={t.id} className="table-row flex items-center gap-3 px-5 py-2.5 text-sm">
            {t.points >= 0 ? <ArrowUpRight size={15} className="text-ok" /> : <ArrowDownRight size={15} className="text-err" />}
            <span className="min-w-0 flex-1 truncate">{t.description}</span>
            <span className="text-xs text-faint">{fmtTime(t.created_at)}</span>
            <span className={`num w-20 text-right font-semibold ${t.points >= 0 ? "text-ok" : "text-err"}`}>{t.points > 0 ? "+" : ""}{t.points}</span>
          </div>
        ))}
      </div>
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
