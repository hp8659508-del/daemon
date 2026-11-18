/** Client-safe venue constants and scoping helpers. */
import type { World } from "@/lib/game";

export const VENUES = ["Incubation Center"] as const; // one venue from 18 Nov: everyone is in Incubation Center
export type Venue = (typeof VENUES)[number];
export const UNASSIGNED = "__unassigned";
/** Key used for per-venue live lot / broadcast. "all" = everyone. */
export const venueKey = (v: string | null | undefined) => (v && v !== UNASSIGNED ? v : "all");
export const venueLabel = (v: string | null | undefined) => (!v ? "All venues" : v === UNASSIGNED ? "Unassigned" : v);

/** Restrict a world snapshot to one venue's teams (null = everything). Catalogues stay shared. */
export function scopeWorld(w: World, venue: string | null): World {
  if (!venue) return w;
  const teams = w.teams.filter(t => (venue === UNASSIGNED ? !t.bay : t.bay === venue));
  const ids = new Set(teams.map(t => t.id));
  const has = (id: string | null) => !!id && ids.has(id);
  return {
    ...w,
    teams,
    stages: w.stages.filter(s => has(s.team_id)),
    teamPowerups: w.teamPowerups.filter(p => has(p.team_id) || has(p.target_team_id)),
    purchases: w.purchases.filter(p => has(p.team_id)),
    txs: w.txs.filter(t => has(t.team_id)),
    marks: w.marks.filter(m => has(m.team_id)),
    activity: w.activity.filter(a => has(a.team_id)),
    members: w.members.filter(m => has(m.team_id)),
    help: w.help.filter(h => has(h.team_id)),
    cards: w.cards.filter(c => has(c.team_id)),
    ledger: w.ledger.filter(l => has(l.team_id)),
    penalties: w.penalties.filter(p => has(p.team_id) || has(p.landed_team_id)),
    balances: Object.fromEntries(Object.entries(w.balances).filter(([k]) => ids.has(k))),
  };
}
