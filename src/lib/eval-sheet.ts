import "server-only";
import { loadWorld, minutesFor, projectedEnd, type World } from "@/lib/game";
import { scopeWorld } from "@/lib/venues";
import { kindLabel, phaseLabel, perkLabel, effectText } from "@/lib/cards";
import type { Staff } from "@/lib/staff";

export type EvalTeam = {
  no: number; name: string; venue: string; ps: string; psFinal: boolean; points: number; deadline: string | null; minutes: number;
  cards: { name: string; type: string; when: string; rule: string; effect: string; status: string; detail: string; price: number | null; via: string; at: string }[];
  penalties: { reason: string; minutes: number; points: number; result: string; at: string }[];
};

const STATUS: Record<string, string> = { applied: "Applied", held: "Held", spent: "Used", pending: "Not chosen yet", resolved: "Copied" };

export async function buildEval(staff: Staff): Promise<{ teams: EvalTeam[]; generated: string; venue: string }> {
  const full = await loadWorld();
  const w: World = staff.isHost ? full : scopeWorld(full, staff.venue);
  const nameOf = (id: string | null) => full.teams.find(t => t.id === id)?.team_name ?? "—";
  const teams = w.teams.map((t, i) => {
    const mins = minutesFor(t.id, full.teamPowerups, full.stages);
    return {
      no: t.paddle ?? i + 1, name: t.team_name, venue: t.bay ?? "—",
      ps: t.problem_statement ?? "", psFinal: t.ps_locked, points: w.balances[t.id] ?? 0,
      deadline: projectedEnd(full.settings.hackathon_end_at, mins), minutes: mins,
      cards: w.cards.filter(c => c.team_id === t.id).map(c => ({
        name: c.name, type: kindLabel(c.kind),
        when: c.kind === "note" ? phaseLabel(c.effect?.phase) : "",
        rule: c.kind === "note" && c.effect?.perk && c.effect.perk !== "none" ? perkLabel(c.effect.perk) : "",
        effect: effectText(c.kind, c.effect),
        status: c.kind === "note" && c.status === "held" ? "" : STATUS[c.status] ?? c.status,
        detail: c.detail ?? "",
        price: c.purchase_id ? full.purchases.find(p => p.id === c.purchase_id)?.purchase_price ?? null : null,
        via: c.source === "trump" ? "Trump card" : c.source === "spin" ? "Spin wheel" : c.source === "manual" ? "Organiser" : "Auction",
        at: c.created_at,
      })),
      penalties: w.penalties.filter(p => p.team_id === t.id || p.landed_team_id === t.id).map(p => ({
        reason: p.team_id === t.id ? p.reason : `${p.reason} (passed by ${nameOf(p.team_id)})`,
        minutes: p.minutes, points: p.points, at: p.created_at,
        result: p.outcome === "applied" ? "Taken" : p.outcome === "blocked" ? "Blocked (No penalties)"
          : p.outcome === "passed" ? (p.landed_team_id === t.id ? "Received" : `Passed to ${nameOf(p.landed_team_id)}`) : "Passed, then skipped",
      })),
    };
  });
  return { teams, generated: new Date().toISOString(), venue: staff.venue ?? "All venues" };
}

const ist = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
export const fmtIST = ist;

export function evalCsv(teams: EvalTeam[]) {
  const head = ["Team #", "Team", "Venue", "Problem statement", "PS final (swapped)", "Auction points", "Final deadline (IST)", "Minutes added", "Row", "Card / penalty", "Type", "When it applies", "Rule", "Effect", "Status / result", "Detail", "Bought for", "Got it via", "Time (IST)"];
  const rows: (string | number)[][] = [];
  for (const t of teams) {
    const base = [t.no, t.name, t.venue, t.ps, t.psFinal ? "Yes" : "No", t.points, ist(t.deadline), t.minutes];
    if (!t.cards.length && !t.penalties.length) rows.push([...base, "Summary", "", "", "", "", "", "", "", "", "", ""]);
    for (const c of t.cards) rows.push([...base, "Card", c.name, c.type, c.when, c.rule, c.effect, c.status, c.detail, c.price ?? "", c.via, ist(c.at)]);
    for (const p of t.penalties) rows.push([...base, "Penalty", p.reason, "Penalty", "", "", [p.minutes ? `-${p.minutes} min` : "", p.points ? `-${p.points} pts` : ""].filter(Boolean).join(" "), p.result, "", "", "", ist(p.at)]);
  }
  const esc = (v: string | number) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return "﻿" + [head, ...rows].map(r => r.map(esc).join(",")).join("\r\n");
}
