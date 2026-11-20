import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CardKind, CardEffect } from "@/lib/cards";
import { buildLedger } from "@/lib/ledger";

export type Activity = "quiz" | "auction" | "spin" | "bingo";
export type StageStatus = "upcoming" | "live" | "closed";
export const ACTIVITIES: { key: Activity; label: string; verb: string }[] = [
  { key: "quiz", label: "Rapid Fire", verb: "Answer it" },
  { key: "auction", label: "Auction", verb: "Bid it" },
  { key: "spin", label: "Spin", verb: "Spin it" },
  { key: "bingo", label: "Bingo", verb: "Bingo it" },
];

export type Stage = { team_id: string; activity: Activity; status: StageStatus; opened_at: string | null; closed_at: string | null; closing_points: number | null; closing_end_at: string | null };
export type Team = { id: string; team_name: string; username: string; bay: string | null; paddle: number | null; problem_statement: string | null; ps_locked: boolean; bingo_mode: "rows" | "columns" | null; ps_no?: number | null };
export type PS = { no: number; title: string; goal: string; build: string[]; bonus: string | null; hint: string | null };
export type Item = { id: string; item_name: string; base_points: number; min_price: number | null; max_price: number | null; price_step: number; quantity: number; description: string | null; powerup_id: string | null; is_active: boolean; kind: CardKind; effect: CardEffect; pool: "auction" | "spin" };
export type LedgerRow = { id: string; team_id: string; round: "auction" | "spin" | "bingo" | "penalty"; label: string; card_id: string | null; points_before: number; points_after: number; minutes_before: number; minutes_after: number; created_at: string };
export type TeamCard = { id: string; team_id: string; purchase_id: string | null; item_id: string | null; name: string; kind: CardKind; effect: CardEffect; source: string; status: string; detail: string | null; spent_at: string | null; created_at: string };
export type Penalty = { id: string; team_id: string; landed_team_id: string | null; minutes: number; points: number; reason: string; outcome: string; detail: string | null; created_at: string };
export type Powerup = { id: string; name: string; description: string | null; minutes_delta: number; targets_rival: boolean; color: string; is_active: boolean };
export type TeamPowerup = { id: string; team_id: string; powerup_id: string | null; name: string; minutes_delta: number; target_team_id: string | null; source: string; note: string | null; used: boolean; created_at: string };
export type Purchase = { id: string; team_id: string; item_id: string; purchase_price: number; created_at: string };
export type Tx = { id: string; team_id: string; description: string; points: number; created_at: string; wallet?: "main" | "auction" };
export type Activity_ = { id: string; team_id: string | null; kind: string; action: string; label: string; points: number | null; minutes: number | null; created_at: string };
export type Member = { id: string; team_id: string; role: "lead" | "member"; full_name: string; usn: string | null; department: string | null; year: string | null; phone: string | null; email: string | null; college: string | null; checked_in: boolean };
export type Help = { id: string; team_id: string; message: string | null; status: string; created_at: string };
export type Cell = { idx: number; label: string; points: number; is_free: boolean };
export type Settings = { portal_locked: boolean; portal_message: string | null; live_lots: Record<string, { item_id: string; price: number } | null>; broadcasts: Record<string, string>; hackathon_started_at: string | null; clock_paused_at: string | null; bingo_full_bonus: number; bingo_rewards: Record<string, string>; hackathon_end_at: string | null; live_lot: { item_id: string; price: number; team_ids?: string[] } | null; broadcast: string | null; bingo_line_bonus: number; leaderboard_visible: boolean; starting_points: number | null; auction_budget?: number; eval_published?: boolean; eval_columns?: string[]; eval_show_remarks?: boolean; certs_published?: boolean; winners?: { first: string | null; second: string | null; third: string | null } | null; winners_announced?: boolean };

export const CRITERIA = [
  { key: "impact", label: "Real world" },
  { key: "innovation", label: "Unique" },
  { key: "presentation", label: "Presentation" },
  { key: "prototype", label: "Prototype" },
] as const;
export type Criterion = (typeof CRITERIA)[number]["key"];
export const CRIT_MAX = 20, EVAL_MAX = 80;
export type EvalScore = { team_id: string; impact: number | null; innovation: number | null; presentation: number | null; prototype: number | null; remarks: string | null; updated_at: string };
export type Certificate = { id: string; team_id: string; member_name: string | null; label: string; file_path: string; file_name: string; created_at: string };
export const evalTotal = (e: EvalScore | null | undefined) => e ? CRITERIA.reduce((a, c) => a + (e[c.key] ?? 0), 0) : null;
export const evalComplete = (e: EvalScore | null | undefined) => !!e && CRITERIA.every(c => e[c.key] != null);

export const LINES = [
  [0, 1, 2, 3, 4], [5, 6, 7, 8, 9], [10, 11, 12, 13, 14], [15, 16, 17, 18, 19], [20, 21, 22, 23, 24],
  [0, 5, 10, 15, 20], [1, 6, 11, 16, 21], [2, 7, 12, 17, 22], [3, 8, 13, 18, 23], [4, 9, 14, 19, 24],
  [0, 6, 12, 18, 24], [4, 8, 12, 16, 20],
];

export const COLUMNS = [0, 1, 2, 3, 4].map(c => [c, c + 5, c + 10, c + 15, c + 20]);
export const LETTERS = ["B", "I", "N", "G", "O"];
export function completedColumns(marked: Set<number>, cells: Cell[]) {
  const free = new Set(cells.filter(c => c.is_free).map(c => c.idx));
  return COLUMNS.map(col => col.every(i => marked.has(i) || free.has(i)));
}

export function completedLines(marked: Set<number>, cells: Cell[]) {
  const free = new Set(cells.filter(c => c.is_free).map(c => c.idx));
  return LINES.filter(l => l.every(i => marked.has(i) || free.has(i)));
}

type StageLite = { team_id: string; activity: string; status: string };

/** Does this power-up's time effect land on `teamId` at all? (own self-effects + rival effects aimed at it) */
export function landsOn(teamId: string, p: TeamPowerup) {
  return p.target_team_id ? p.target_team_id === teamId : p.team_id === teamId;
}
/**
 * A power-up's minutes are CONFIRMED once the round it came from is closed for
 * the team that earned it (auction lot → that team's auction closes, spin → spin
 * closes, bingo → bingo closes). Organiser grants ("manual") apply immediately.
 */
export function isConfirmed(p: TeamPowerup, stages: StageLite[]) {
  if (!["auction", "spin", "bingo"].includes(p.source)) return true;
  return stages.some(s => s.team_id === p.team_id && s.activity === p.source && s.status === "closed");
}
/** Minutes on a team's deadline. Pass `stages` to count only confirmed effects (what the clock uses). */
export function minutesFor(teamId: string, rows: TeamPowerup[], stages?: StageLite[]) {
  return rows.reduce((sum, p) => (landsOn(teamId, p) && (!stages || isConfirmed(p, stages)) ? sum + p.minutes_delta : sum), 0);
}
export function pendingMinutes(teamId: string, rows: TeamPowerup[], stages: StageLite[]) {
  return rows.reduce((sum, p) => (landsOn(teamId, p) && !isConfirmed(p, stages) ? sum + p.minutes_delta : sum), 0);
}

export function projectedEnd(base: string | null, minutes: number) {
  if (!base) return null;
  return new Date(new Date(base).getTime() + minutes * 60_000).toISOString();
}

/** Supabase caps responses (default 1000 rows); page through the full ledger so balances are exact. */
async function allTransactions(db: ReturnType<typeof createAdminClient>) {
  const rows: Tx[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("transactions").select("*").order("created_at", { ascending: false }).range(from, from + 999);
    if (error) return { data: null, error };
    rows.push(...((data ?? []) as Tx[]));
    if (!data || data.length < 1000) break;
  }
  return { data: rows, error: null };
}

/** One round-trip snapshot of the whole event. Server-only (service role); callers must authorise first. */
/**
 * Load the event. With { teamId } only that team's private rows are fetched
 * (team screens refresh often, so they must stay light); balances for every
 * team come from one aggregate call either way.
 */
/* ---------- shared data cache (team screens) ----------
 * The parts every team screen needs (teams, rounds, catalogue, settings, balances…)
 * are fetched once per ~1.5 s per server instance and shared by every team request
 * on it, instead of once per screen. Concurrent callers share the same in-flight fetch. */
type SharedPart = Awaited<ReturnType<typeof fetchShared>>;
let sharedCache: { at: number; p: Promise<SharedPart>; gv?: number } | null = null;
const SHARED_TTL = 1500;
function fetchShared(db: ReturnType<typeof createAdminClient>) {
  return Promise.all([
    db.from("teams").select("*").order("paddle", { ascending: true, nullsFirst: false }).order("team_name"),
    db.from("team_stages").select("team_id,activity,status,opened_at,closed_at,closing_points,closing_end_at"),
    db.from("auction_items").select("id,item_name,base_points,min_price,max_price,price_step,quantity,description,powerup_id,is_active,kind,effect,pool,created_at").order("created_at"),
    db.from("powerups").select("*").order("created_at"),
    db.from("purchases").select("id,team_id,item_id,purchase_price,created_at").order("created_at", { ascending: false }),
    db.from("bingo_cells").select("*").order("idx"),
    db.from("event_settings").select("*").eq("id", true).maybeSingle(),
    db.rpc("team_balances"),
    db.from("problem_statements").select("*").order("no"),   // optional: missing table → []
  ]);
}
function sharedFor(db: ReturnType<typeof createAdminClient>, fresh: boolean, gv?: number): Promise<SharedPart> {
  if (!fresh && sharedCache && (gv !== undefined ? sharedCache.gv === gv && Date.now() - sharedCache.at < 60_000 : Date.now() - sharedCache.at < SHARED_TTL)) return sharedCache.p;
  const p = fetchShared(db);
  sharedCache = { at: Date.now(), p, gv };
  p.then(r => { if (r.some(x => x.error)) sharedCache = null; }, () => { sharedCache = null; });
  return p;
}

/* ---------- per-team cache ----------
 * Everyone on a team sees the same data. Each team's world is loaded ONCE per change
 * (keyed by that team's change counter + the event-wide counter from dh_versions)
 * and shared by every teammate's screen on this server. Any change bumps a counter,
 * so the key changes and the next request loads fresh: never stale. */
type WorldT = Awaited<ReturnType<typeof loadWorldRaw>>;
const teamCache = new Map<string, { exp: number; p: Promise<WorldT> }>();
export async function loadWorld(opts: { teamId?: string } = {}): Promise<WorldT> {
  const tid = opts.teamId;
  if (!tid) return loadWorldRaw(opts);
  const db = createAdminClient();
  let key: string | null = null, gv: number | undefined;
  try {
    const { data } = await db.from("dh_versions").select("key,v").in("key", ["global", tid]);
    if (data) {
      gv = Number(data.find((r: { key: string }) => r.key === "global")?.v ?? 0);
      key = `${tid}:${data.find((r: { key: string }) => r.key === tid)?.v ?? 0}:${gv}`;
    }
  } catch { key = null; }                         // ui_v13 not run yet: no cache
  if (!key) return loadWorldRaw(opts);
  const hit = teamCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.p;
  const p = loadWorldRaw({ teamId: tid, gv });
  if (teamCache.size > 400) for (const [k, e] of teamCache) if (e.exp < Date.now() || teamCache.size > 300) teamCache.delete(k);
  teamCache.set(key, { exp: Date.now() + 60_000, p });
  p.catch(() => teamCache.delete(key!));
  return p;
}

async function loadWorldRaw(opts: { teamId?: string; gv?: number } = {}) {
  const db = createAdminClient();
  const tid = opts.teamId;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const own = (q: any, col = "team_id") => (tid ? q.eq(col, tid) : q);
  // admins always read fresh; team screens share the cached part
  const sharedP = sharedFor(db, !tid, opts.gv);
  const [[teams, stages, items, powerups, purchases, cells, settings, bal, psPool], [tps, txs, marks, activity, members, help, cards, pens, ledger]] = await Promise.all([sharedP, Promise.all([
    tid ? db.from("team_powerups").select("*").or(`team_id.eq.${tid},target_team_id.eq.${tid}`).order("created_at", { ascending: false })
        : db.from("team_powerups").select("*").order("created_at", { ascending: false }),
    tid ? db.from("transactions").select("*").eq("team_id", tid).order("created_at", { ascending: false }).limit(3000)
        : allTransactions(db),
    own(db.from("team_bingo").select("team_id,idx,marked_at")),
    own(db.from("activity_log").select("id,team_id,kind,action,label,points,minutes,created_at")).order("created_at", { ascending: false }).limit(tid ? 300 : 1000),
    own(db.from("team_members").select("id,team_id,role,full_name,usn,department,year,phone,email,college,checked_in")).order("role").order("created_at"),
    own(db.from("help_requests").select("id,team_id,message,status,created_at")).eq("status", "open").order("created_at"),
    own(db.from("team_cards").select("id,team_id,purchase_id,item_id,name,kind,effect,source,status,detail,spent_at,created_at")).order("created_at"),
    tid ? db.from("penalties").select("*").or(`team_id.eq.${tid},landed_team_id.eq.${tid}`).order("created_at", { ascending: false })
        : db.from("penalties").select("*").order("created_at", { ascending: false }),
    own(db.from("team_ledger").select("*")).order("created_at"),
  ])]);
  // v19 (optional until ui_v19_evaluation.sql is run → empty)
  const [evals, certs] = await Promise.all([
    own(db.from("evaluation_scores").select("*")),
    own(db.from("certificates").select("*")).order("created_at"),
  ]);
  const firstError = [teams, stages, items, powerups, tps, purchases, txs, cells, marks, settings, activity, members, help, cards, pens, ledger].find(r => r.error)?.error;
  if (firstError) throw new Error(firstError.message + " — run supabase/ui_v10_spin_ledger.sql (after ui_v9_cards.sql) in the Supabase SQL editor");

  const balances: Record<string, number> = {};
  if (!bal.error && Array.isArray(bal.data)) {
    for (const r of bal.data as { team_id: string; balance: number }[]) balances[r.team_id] = Number(r.balance);
  } else {
    // ui_v6 not run yet: fall back to summing the ledger ourselves
    const all = await allTransactions(db);
    for (const t of (all.data ?? []) as Tx[]) if ((t.wallet ?? "main") === "main") balances[t.team_id] = (balances[t.team_id] ?? 0) + Number(t.points ?? 0);
  }
  // Auction wallet: the budget every team starts with + what it spent / got refunded at the auction.
  // Separate from main points. (Admin loads have every transaction; team loads have their own.)
  const budget = Number((settings.data as { auction_budget?: number } | null)?.auction_budget ?? 1000);
  const auctionBalances: Record<string, number> = {};
  for (const t of (teams.data ?? []) as Team[]) auctionBalances[t.id] = budget;
  for (const t of (txs.data ?? []) as Tx[]) if (t.wallet === "auction") auctionBalances[t.team_id] = (auctionBalances[t.team_id] ?? budget) + Number(t.points ?? 0);

  return {
    teams: (teams.data ?? []) as Team[],
    stages: (stages.data ?? []) as Stage[],
    items: (items.data ?? []) as Item[],
    powerups: (powerups.data ?? []) as Powerup[],
    teamPowerups: (tps.data ?? []) as TeamPowerup[],
    purchases: (purchases.data ?? []) as Purchase[],
    txs: (txs.data ?? []) as Tx[],
    cells: (cells.data ?? []) as Cell[],
    marks: (marks.data ?? []) as { team_id: string; idx: number; marked_at: string }[],
    activity: (activity.data ?? []) as Activity_[],
    members: (members.data ?? []) as Member[],
    help: (help.data ?? []) as Help[],
    settings: (settings.data ?? { portal_locked: false, portal_message: null, live_lots: {}, broadcasts: {}, hackathon_started_at: null, clock_paused_at: null, bingo_full_bonus: 100, bingo_rewards: {}, hackathon_end_at: null, live_lot: null, broadcast: null, bingo_line_bonus: 50, leaderboard_visible: false, starting_points: 0 }) as Settings,
    balances,
    auctionBalances,
    auctionBudget: budget,
    psPool: (psPool.error ? [] : (psPool.data ?? [])) as PS[],
    cards: (cards.data ?? []) as TeamCard[],
    penalties: (pens.data ?? []) as Penalty[],
    ledger: (ledger.data ?? []) as LedgerRow[],
    evals: (evals.error ? [] : (evals.data ?? [])) as EvalScore[],
    certificates: (certs.error ? [] : (certs.data ?? [])) as Certificate[],
    /** Every sale in every venue (lots are shared, so 'sold' must count all of them). */
    lotSales: ((purchases.data ?? []) as Purchase[]).map(p => ({ item_id: p.item_id, team_id: p.team_id, team_name: ((teams.data ?? []) as Team[]).find(t => t.id === p.team_id)?.team_name ?? "Team" })),
  };
}
export type World = Awaited<ReturnType<typeof loadWorld>>;

/** Team view: only that team's private rows, plus public catalogue/board. */
export function teamSlice(w: World, teamId: string) {
  const team = w.teams.find(t => t.id === teamId) ?? null;
  const names = Object.fromEntries(w.teams.map(t => [t.id, t.team_name]));
  const myPowerups = w.teamPowerups.filter(p => p.team_id === teamId || p.target_team_id === teamId)
    .map(p => ({ ...p, from_name: names[p.team_id] ?? "", target_name: p.target_team_id ? names[p.target_team_id] ?? "" : null }));
  const stageFor = (a: Activity) => w.stages.find(s => s.team_id === teamId && s.activity === a) ?? { team_id: teamId, activity: a, status: "upcoming" as StageStatus, opened_at: null, closed_at: null, closing_points: null, closing_end_at: null };
  const ranked = [...w.teams].sort((a, b) => (w.balances[b.id] ?? 0) - (w.balances[a.id] ?? 0));
  const vkey = team?.bay || "all";
  const lots = w.settings.live_lots ?? {};
  const lot = (lots[vkey] ?? lots.all ?? null) as Settings["live_lot"];
  const lotVisible = !!lot;
  return {
    team,
    balance: w.balances[teamId] ?? 0,
    auctionBalance: w.auctionBalances[teamId] ?? w.auctionBudget,
    auctionBudget: w.auctionBudget,
    evaluation: evalFor(w, teamId),
    stages: { quiz: stageFor("quiz"), auction: stageFor("auction"), spin: stageFor("spin"), bingo: stageFor("bingo") },
    purchases: w.purchases.filter(p => p.team_id === teamId).map(p => ({ ...p, item_name: w.items.find(i => i.id === p.item_id)?.item_name ?? "Item" })),
    txs: w.txs.filter(t => t.team_id === teamId).slice(0, 80),
    powerups: myPowerups.map(p => ({ ...p, confirmed: isConfirmed(p, w.stages) })),
    minutes: minutesFor(teamId, w.teamPowerups, w.stages),
    pendingMinutes: pendingMinutes(teamId, w.teamPowerups, w.stages),
    pointsProvisional: (["auction", "spin", "bingo"] as Activity[]).some(a => stageFor(a).status === "live"),
    baseEnd: w.settings.hackathon_end_at,
    startedAt: w.settings.hackathon_started_at,
    members: w.members.filter(m => m.team_id === teamId),
    helpOpen: w.help.some(h => h.team_id === teamId),
    locked: w.settings.portal_locked,
    lockMessage: w.settings.portal_message,
    pausedAt: w.settings.clock_paused_at,
    activity: w.activity.filter(a => a.team_id === teamId).slice(0, 200),
    rewards: w.settings.bingo_rewards ?? {},
    fullBonus: w.settings.bingo_full_bonus,
    endAt: projectedEnd(w.settings.hackathon_end_at, minutesFor(teamId, w.teamPowerups, w.stages)),
    pendingEndAt: projectedEnd(w.settings.hackathon_end_at, minutesFor(teamId, w.teamPowerups)),
    cells: w.cells,
    marked: w.marks.filter(m => m.team_id === teamId).map(m => m.idx),
    lineBonus: w.settings.bingo_line_bonus,
    broadcast: [w.settings.broadcasts?.all, team?.bay ? w.settings.broadcasts?.[team.bay] : null, w.settings.broadcast].filter(Boolean).join("   ◆   ") || null,
    liveLot: lotVisible && lot ? { ...lot, item: w.items.find(i => i.id === lot.item_id) ?? null, sold: w.purchases.filter(p => p.item_id === lot.item_id).length } : null,
    ledger: buildLedger(teamId, w.txs, w.teamPowerups, w.cards, w.stages),
    catalogue: w.items.filter(i => i.is_active && i.pool !== "spin").map(i => {
      const pu = w.powerups.find(p => p.id === i.powerup_id);
      return { ...i, sold: w.purchases.filter(p => p.item_id === i.id).length, mine: w.purchases.filter(p => p.item_id === i.id && p.team_id === teamId).length,
        powerup: pu?.name ?? null, powerupMinutes: pu?.minutes_delta ?? null, powerupRival: pu?.targets_rival ?? false,
        buyers: w.purchases.filter(p => p.item_id === i.id).map(p => names[p.team_id] ?? "Team") };
    }),
    venueKey: team?.bay || "all",
    problemStatement: team?.problem_statement ?? null,
    psDetail: team?.ps_no ? w.psPool.find(p => p.no === team.ps_no) ?? null : null,
    psLocked: team?.ps_locked ?? false,
    bingoMode: team?.bingo_mode ?? null,
    cards: w.cards.filter(c => c.team_id === teamId),
    penalties: w.penalties.filter(p => p.team_id === teamId || p.landed_team_id === teamId)
      .map(p => ({ ...p, from_name: names[p.team_id] ?? "", landed_name: p.landed_team_id ? names[p.landed_team_id] ?? "" : null })),
    rank: w.settings.leaderboard_visible ? ranked.findIndex(t => t.id === teamId) + 1 : 0,
    teamCount: w.teams.length,
    leaderboard: w.settings.leaderboard_visible ? ranked.slice(0, 5).map(t => ({ id: t.id, name: t.team_name, points: w.balances[t.id] ?? 0 })) : null,
  };
}
export type TeamView = ReturnType<typeof teamSlice>;

/** What a team may see of its evaluation: nothing until published; only the columns the admin shows. */
function evalFor(w: World, teamId: string) {
  const st = w.settings;
  const e = w.evals.find(x => x.team_id === teamId) ?? null;
  const cols = (st.eval_columns ?? CRITERIA.map(c => c.key)) as string[];
  return {
    published: !!st.eval_published,
    certsPublished: !!st.certs_published,
    total: st.eval_published ? evalTotal(e) : null,
    max: EVAL_MAX,
    columns: st.eval_published && e ? CRITERIA.filter(c => cols.includes(c.key)).map(c => ({ key: c.key, label: c.label, score: e[c.key], max: CRIT_MAX })) : [],
    remarks: st.eval_published && st.eval_show_remarks ? e?.remarks ?? null : null,
    // ids/labels only — files are fetched through /api/certificates, which checks publish + ownership
    certificates: st.certs_published ? w.certificates.filter(c => c.team_id === teamId).map(c => ({ id: c.id, label: c.label, member_name: c.member_name, file_name: c.file_name })) : [],
  };
}
