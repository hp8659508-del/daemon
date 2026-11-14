import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type Activity = "auction" | "spin" | "bingo";
export type StageStatus = "upcoming" | "live" | "closed";
export const ACTIVITIES: { key: Activity; label: string; verb: string }[] = [
  { key: "auction", label: "Auction", verb: "Bid it" },
  { key: "spin", label: "Spin", verb: "Spin it" },
  { key: "bingo", label: "Bingo", verb: "Bingo it" },
];

export type Stage = { team_id: string; activity: Activity; status: StageStatus; opened_at: string | null; closed_at: string | null; closing_points: number | null; closing_end_at: string | null };
export type Team = { id: string; team_name: string; username: string; bay: string | null };
export type Item = { id: string; item_name: string; base_points: number; min_price: number | null; max_price: number | null; price_step: number; quantity: number; description: string | null; powerup_id: string | null; is_active: boolean };
export type Powerup = { id: string; name: string; description: string | null; minutes_delta: number; targets_rival: boolean; color: string; is_active: boolean };
export type TeamPowerup = { id: string; team_id: string; powerup_id: string | null; name: string; minutes_delta: number; target_team_id: string | null; source: string; note: string | null; used: boolean; created_at: string };
export type Purchase = { id: string; team_id: string; item_id: string; purchase_price: number; created_at: string };
export type Tx = { id: string; team_id: string; description: string; points: number; created_at: string };
export type Activity_ = { id: string; team_id: string | null; kind: string; action: string; label: string; points: number | null; minutes: number | null; created_at: string };
export type Cell = { idx: number; label: string; points: number; is_free: boolean };
export type Settings = { hackathon_started_at: string | null; clock_paused_at: string | null; bingo_full_bonus: number; bingo_rewards: Record<string, string>; hackathon_end_at: string | null; live_lot: { item_id: string; price: number; team_ids?: string[] } | null; broadcast: string | null; bingo_line_bonus: number; leaderboard_visible: boolean; starting_points: number | null };

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

/** Minutes that land on a team: its own self-targeted power-ups + rival effects aimed at it. */
export function minutesFor(teamId: string, rows: TeamPowerup[]) {
  return rows.reduce((sum, p) => {
    if (p.target_team_id) return p.target_team_id === teamId ? sum + p.minutes_delta : sum;
    return p.team_id === teamId ? sum + p.minutes_delta : sum;
  }, 0);
}

export function projectedEnd(base: string | null, minutes: number) {
  if (!base) return null;
  return new Date(new Date(base).getTime() + minutes * 60_000).toISOString();
}

/** Supabase caps responses (default 1000 rows); page through the full ledger so balances are exact. */
async function allTransactions(db: ReturnType<typeof createAdminClient>) {
  const rows: Tx[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("transactions").select("id,team_id,description,points,created_at").order("created_at", { ascending: false }).range(from, from + 999);
    if (error) return { data: null, error };
    rows.push(...((data ?? []) as Tx[]));
    if (!data || data.length < 1000) break;
  }
  return { data: rows, error: null };
}

/** One round-trip snapshot of the whole event. Server-only (service role); callers must authorise first. */
export async function loadWorld() {
  const db = createAdminClient();
  const [teams, stages, items, powerups, tps, purchases, txs, cells, marks, settings, activity] = await Promise.all([
    db.from("teams").select("id,team_name,username,bay").order("team_name"),
    db.from("team_stages").select("*"),
    db.from("auction_items").select("id,item_name,base_points,min_price,max_price,price_step,quantity,description,powerup_id,is_active").order("item_name"),
    db.from("powerups").select("*").order("created_at"),
    db.from("team_powerups").select("*").order("created_at", { ascending: false }),
    db.from("purchases").select("id,team_id,item_id,purchase_price,created_at").order("created_at", { ascending: false }),
    allTransactions(db),
    db.from("bingo_cells").select("*").order("idx"),
    db.from("team_bingo").select("team_id,idx,marked_at"),
    db.from("event_settings").select("hackathon_started_at,clock_paused_at,bingo_full_bonus,bingo_rewards,hackathon_end_at,live_lot,broadcast,bingo_line_bonus,leaderboard_visible,starting_points").eq("id", true).maybeSingle(),
    db.from("activity_log").select("id,team_id,kind,action,label,points,minutes,created_at").order("created_at", { ascending: false }).limit(1000),
  ]);
  const firstError = [teams, stages, items, powerups, tps, purchases, txs, cells, marks, settings, activity].find(r => r.error)?.error;
  if (firstError) throw new Error(firstError.message + " — have supabase/ui_rebuild_migration.sql and ui_v2_migration.sql been run?");

  const balances: Record<string, number> = {};
  for (const t of (txs.data ?? []) as Tx[]) balances[t.team_id] = (balances[t.team_id] ?? 0) + Number(t.points ?? 0);

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
    settings: (settings.data ?? { hackathon_started_at: null, clock_paused_at: null, bingo_full_bonus: 100, bingo_rewards: {}, hackathon_end_at: null, live_lot: null, broadcast: null, bingo_line_bonus: 50, leaderboard_visible: false, starting_points: 0 }) as Settings,
    balances,
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
  const lot = w.settings.live_lot;
  const lotVisible = lot && (!lot.team_ids || lot.team_ids.includes(teamId));
  return {
    team,
    balance: w.balances[teamId] ?? 0,
    stages: { auction: stageFor("auction"), spin: stageFor("spin"), bingo: stageFor("bingo") },
    purchases: w.purchases.filter(p => p.team_id === teamId).map(p => ({ ...p, item_name: w.items.find(i => i.id === p.item_id)?.item_name ?? "Item" })),
    txs: w.txs.filter(t => t.team_id === teamId).slice(0, 80),
    powerups: myPowerups,
    minutes: minutesFor(teamId, w.teamPowerups),
    baseEnd: w.settings.hackathon_end_at,
    startedAt: w.settings.hackathon_started_at,
    pausedAt: w.settings.clock_paused_at,
    activity: w.activity.filter(a => a.team_id === teamId).slice(0, 200),
    rewards: w.settings.bingo_rewards ?? {},
    fullBonus: w.settings.bingo_full_bonus,
    endAt: projectedEnd(w.settings.hackathon_end_at, minutesFor(teamId, w.teamPowerups)),
    cells: w.cells,
    marked: w.marks.filter(m => m.team_id === teamId).map(m => m.idx),
    lineBonus: w.settings.bingo_line_bonus,
    broadcast: w.settings.broadcast,
    liveLot: lotVisible && lot ? { ...lot, item: w.items.find(i => i.id === lot.item_id) ?? null, sold: w.purchases.filter(p => p.item_id === lot.item_id).length } : null,
    catalogue: w.items.filter(i => i.is_active).map(i => ({ ...i, sold: w.purchases.filter(p => p.item_id === i.id).length, powerup: w.powerups.find(p => p.id === i.powerup_id)?.name ?? null })),
    rank: w.settings.leaderboard_visible ? ranked.findIndex(t => t.id === teamId) + 1 : 0,
    teamCount: w.teams.length,
    leaderboard: w.settings.leaderboard_visible ? ranked.slice(0, 5).map(t => ({ id: t.id, name: t.team_name, points: w.balances[t.id] ?? 0 })) : null,
  };
}
export type TeamView = ReturnType<typeof teamSlice>;
