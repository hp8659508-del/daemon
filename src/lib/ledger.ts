/**
 * Round ledger built from the records the app already keeps (points transactions
 * and deadline changes), so it always shows the full history, oldest first, with
 * points and deadline minutes BEFORE and AFTER each ability. Client-safe.
 */
export type LRound = "quiz" | "auction" | "spin" | "bingo" | "penalty" | "other";
export type LRow = { id: string; round: LRound; label: string; created_at: string; points_before: number; points_after: number; minutes_before: number; minutes_after: number; closed?: boolean };

type Tx = { id: string; team_id: string; description: string; points: number; created_at: string; wallet?: string };
type Pu = { id: string; team_id: string; target_team_id: string | null; name: string; minutes_delta: number; source: string; created_at: string };
type Card = { team_id: string; name: string; source: string };
type StageRow = { team_id: string; activity: string; status: string; closed_at: string | null };

const strip = (s: string) => s.replace(/^(Auction|Card|Bingo|Penalty):\s*/i, "").trim();

export function buildLedger(teamId: string, txs: Tx[], pus: Pu[], cards: Card[] = [], stages: StageRow[] = []): LRow[] {
  const spinNames = new Set(cards.filter(c => c.team_id === teamId && c.source === "spin").map(c => c.name));
  type Ev = { id: string; at: number; iso: string; round: LRound; label: string; dp: number; dm: number; base?: boolean; close?: boolean };
  const ev: Ev[] = [];
  for (const t of txs) {
    if (t.team_id !== teamId) continue;
    const d = t.description || "";
    let round: LRound = "other";
    if (/^Starting points/i.test(d)) { ev.push({ id: t.id, at: +new Date(t.created_at), iso: t.created_at, round, label: d, dp: t.points, dm: 0, base: true }); continue; }
    if (/^Rapid fire:/i.test(d)) round = "quiz";
    else if (/^Auction:/i.test(d)) round = "auction";
    else if (/^Card:/i.test(d)) round = spinNames.has(strip(d)) ? "spin" : "auction";
    else if (/^Bingo/i.test(d)) round = "bingo";
    else if (/^Penalty:/i.test(d)) round = "penalty";
    else if (/spin/i.test(d)) round = "spin";
    const label = /^Auction:/i.test(d) ? `${strip(d)} (paid ${-t.points} auction pts)` : /^Bingo/i.test(d) ? d.replace(/^Bingo:\s*/i, "Dare: ") : strip(d);
    // auction-wallet spending never touches main points: the row shows, the points don't move
    ev.push({ id: t.id, at: +new Date(t.created_at), iso: t.created_at, round, label, dp: t.wallet === "auction" ? 0 : Number(t.points), dm: 0 });
  }
  for (const p of pus) {
    const lands = p.target_team_id ? p.target_team_id === teamId : p.team_id === teamId;
    if (!lands || !p.minutes_delta) continue;
    const round: LRound = /^Penalty:/i.test(p.name) ? "penalty" : p.source === "spin" ? "spin" : p.source === "auction" ? "auction" : p.source === "bingo" ? "bingo" : "other";
    ev.push({ id: p.id, at: +new Date(p.created_at), iso: p.created_at, round, label: strip(p.name) + (p.target_team_id && p.team_id !== teamId ? " (played on you)" : ""), dp: 0, dm: p.minutes_delta });
  }
  // a closed round ends its table with a grey "Round completed" line
  for (const st of stages) {
    if (st.team_id !== teamId || st.status !== "closed" || !st.closed_at) continue;
    ev.push({ id: `close-${st.activity}`, at: +new Date(st.closed_at), iso: st.closed_at, round: st.activity as LRound, label: "Round completed", dp: 0, dm: 0, close: true });
  }
  ev.sort((a, b) => a.at - b.at || Number(!!a.close) - Number(!!b.close));

  // one row per ability: effects of the same round within 3 s are the same event (e.g. price + its +15 min)
  const rows: LRow[] = [];
  let pts = 0, mins = 0;
  for (const e of ev) {
    if (e.base) { pts += e.dp; continue; }
    if (e.close) { rows.push({ id: e.id, round: e.round, label: e.label, created_at: e.iso, points_before: pts, points_after: pts, minutes_before: mins, minutes_after: mins, closed: true }); continue; }
    const last = rows[rows.length - 1];
    if (last && !last.closed && last.round === e.round && e.at - +new Date(last.created_at) < 3000) {
      if (!last.label.includes(e.label) && !e.label.startsWith(last.label.split(" (bought")[0])) last.label += ` · ${e.label}`;
      pts += e.dp; mins += e.dm;
      last.points_after = pts; last.minutes_after = mins;
      continue;
    }
    const pb = pts, mb = mins;
    pts += e.dp; mins += e.dm;
    rows.push({ id: e.id, round: e.round, label: e.label, created_at: e.iso, points_before: pb, points_after: pts, minutes_before: mb, minutes_after: mins });
  }
  return rows;
}
