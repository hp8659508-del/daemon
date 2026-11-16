"use client";

import { useState } from "react";

/**
 * Round ledgers: one table per round. Every row is one ability the team received,
 * with the team's deadline and points before → after it.
 */
export type LedgerRowLite = { id: string; round: string; label: string; points_before: number; points_after: number; minutes_before: number; minutes_after: number; created_at: string };

const ROUNDS = [
  { key: "quiz", label: "Rapid Fire" },
  { key: "auction", label: "Auction" },
  { key: "spin", label: "Spin wheel" },
  { key: "bingo", label: "Bingo" },
  { key: "penalty", label: "Penalties" },
  { key: "other", label: "Organiser" },
] as const;

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
const deadline = (base: string | null, mins: number) =>
  base ? new Date(new Date(base).getTime() + mins * 60000).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }) : `${mins > 0 ? "+" : ""}${mins} min`;
const delta = (n: number, unit: string) => (n === 0 ? "" : `${n > 0 ? "+" : ""}${n}${unit}`);

export default function RoundLedgers({ rows, baseEnd, compact = false }: { rows: LedgerRowLite[]; baseEnd: string | null; compact?: boolean }) {
  const counts = Object.fromEntries(ROUNDS.map(r => [r.key, rows.filter(x => x.round === r.key).length]));
  const [round, setRound] = useState<string>(ROUNDS.find(r => counts[r.key])?.key ?? "auction");
  const list = rows.filter(r => r.round === round);
  return (
    <div className={compact ? "" : "panel overflow-hidden"}>
      <div className={`flex flex-wrap items-center justify-between gap-3 ${compact ? "mb-3" : "border-b border-graphite px-5 py-4"}`}>
        <h3 className="font-display text-lg font-bold">Round ledger</h3>
        <div className="seg" role="tablist">
          {ROUNDS.map(r => (
            <button key={r.key} role="tab" aria-selected={round === r.key} data-on={round === r.key} onClick={() => setRound(r.key)}>
              {r.label}<span className="seg-count">{counts[r.key]}</span>
            </button>
          ))}
        </div>
      </div>
      {list.length === 0 ? (
        <p className={`text-sm text-muted ${compact ? "" : "px-5 py-6"}`}>Nothing received in this round yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="ledger">
            <thead>
              <tr>
                <th rowSpan={2}>Received</th>
                <th rowSpan={2} className="text-left">Ability / card</th>
                <th colSpan={2} className="grp">Deadline</th>
                <th colSpan={2} className="grp">Points</th>
              </tr>
              <tr><th>Before</th><th>After</th><th>Before</th><th>After</th></tr>
            </thead>
            <tbody>
              {list.map(r => {
                const dm = r.minutes_after - r.minutes_before, dp = r.points_after - r.points_before;
                return (
                  <tr key={r.id}>
                    <td className="num whitespace-nowrap text-muted">{clock(r.created_at)}</td>
                    <td className="font-semibold">{r.label}</td>
                    <td className="num">{deadline(baseEnd, r.minutes_before)}</td>
                    <td className="num"><b>{deadline(baseEnd, r.minutes_after)}</b>{dm !== 0 && <span className={dm > 0 ? "up" : "down"}>{delta(dm, "m")}</span>}</td>
                    <td className="num">{r.points_before}</td>
                    <td className="num"><b>{r.points_after}</b>{dp !== 0 && <span className={dp > 0 ? "up" : "down"}>{delta(dp, "")}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
