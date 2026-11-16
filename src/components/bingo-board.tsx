"use client";

import { COLUMNS, ROWS, LETTERS } from "@/lib/bingo-shared";
import { LogoGlass } from "@/components/ui";

type Cell = { idx: number; label: string; points: number; is_free: boolean };

/**
 * Swiss-instrument bingo board.
 * - Columns are headed by the top B-I-N-G-O letters.
 * - Rows are headed by the left B-I-N-G-O letters.
 * - Whichever direction is active/locked (rows or columns) displays laser strike lines
 *   and strikes through its corresponding B-I-N-G-O letters.
 */
export default function BingoBoard({
  cells, marked, onToggle, busy, rewards, compact = false, mode,
}: {
  cells: Cell[]; marked: Set<number>; onToggle?: (idx: number) => void; busy?: boolean;
  rewards?: Record<string, string>; compact?: boolean; mode?: "rows" | "columns" | null;
}) {
  const free = new Set(cells.filter(c => c.is_free).map(c => c.idx));
  const colsDone = COLUMNS.map(col => col.every(i => marked.has(i) || free.has(i)));
  const rowsDone = ROWS.map(row => row.every(i => marked.has(i) || free.has(i)));
  const full = colsDone.every(Boolean) || rowsDone.every(Boolean);
  const byIdx = new Map(cells.map(c => [c.idx, c]));
  const gap = "gap-2 sm:gap-3";

  // If mode from server is not yet set, infer from whichever line completed first (columns win tie):
  let effectiveMode = mode;
  if (!effectiveMode) {
    const hasCols = colsDone.some(Boolean);
    const hasRows = rowsDone.some(Boolean);
    if (hasCols && hasRows) effectiveMode = "columns";
    else if (hasCols) effectiveMode = "columns";
    else if (hasRows) effectiveMode = "rows";
  }

  const showCols = effectiveMode === "rows" ? false : true;
  const showRows = effectiveMode === "columns" ? false : true;

  return (
    <div className="space-y-2 sm:space-y-3">
      {/* Top Header: Corner Box + 5 Column Letters (B I N G O) */}
      <div className="flex gap-2 sm:gap-3">
        {/* Top-Left Corner: Direction indicator */}
        <div className={`w-10 sm:w-14 shrink-0 relative grid place-items-center overflow-hidden border border-graphite py-2 shadow-[3px_3px_0_#0E0B2B] transition-colors ${
          effectiveMode === "rows" || effectiveMode === "columns" ? "bg-[#0E0B2B] text-white" : "bg-white text-muted"
        }`}>
          <span className="font-mono text-[8.5px] sm:text-[10px] font-bold tracking-wider uppercase text-center leading-tight">
            {effectiveMode === "rows" ? "ROWS\n➔" : effectiveMode === "columns" ? "COLS\n↓" : "BINGO"}
          </span>
        </div>

        {/* 5 Column Letters (B I N G O) */}
        <div className={`grid flex-1 grid-cols-5 ${gap}`}>
          {LETTERS.map((L, i) => {
            const isStruck = showCols && colsDone[i];
            return (
              <div key={L} className={`relative grid place-items-center overflow-hidden border border-graphite py-2 shadow-[3px_3px_0_#0E0B2B] transition-colors ${isStruck ? "bg-graphite text-white" : "bg-white text-graphite"}`}>
                <span className={`font-display text-2xl sm:text-5xl ${isStruck ? "opacity-60" : ""}`}>{L}</span>
                {isStruck && <span className="strike-h pointer-events-none absolute left-[12%] right-[12%] top-[40%] h-[5px] rounded-full bg-ember" />}
                {rewards && <span className="mt-0.5 line-clamp-1 px-1 text-[9px] font-semibold uppercase tracking-wider opacity-70">{rewards[L] || "Reward soon"}</span>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Board: Left Row Letters (B I N G O) + 5x5 Squares Grid */}
      <div className="flex gap-2 sm:gap-3">
        {/* Left Column: 5 Row Letters (B I N G O) */}
        <div className={`w-10 sm:w-14 shrink-0 grid grid-rows-5 ${gap}`}>
          {LETTERS.map((L, r) => {
            const isStruck = showRows && rowsDone[r];
            return (
              <div key={L} className={`relative grid place-items-center overflow-hidden border border-graphite shadow-[3px_3px_0_#0E0B2B] transition-colors ${isStruck ? "bg-graphite text-white" : "bg-white text-graphite"}`}>
                <span className={`font-display text-2xl sm:text-4xl ${isStruck ? "opacity-60" : ""}`}>{L}</span>
                {isStruck && (
                  <span className="strike-h pointer-events-none absolute left-[12%] right-[12%] top-1/2 -translate-y-1/2 h-[5px] rounded-full bg-ember" />
                )}
              </div>
            );
          })}
        </div>

        {/* 5x5 Grid of Cells */}
        <div className="relative flex-1">
          <div className={`grid grid-cols-5 ${gap}`}>
            {Array.from({ length: 25 }, (_, idx) => {
              const c = byIdx.get(idx);
              if (!c) return <div key={idx} className="aspect-square" />;
              const on = marked.has(idx);
              if (c.is_free) return (
                <div key={idx} className="grid aspect-square place-items-center border border-graphite bg-white shadow-[3px_3px_0_#0E0B2B]"
                  style={{ backgroundImage: "linear-gradient(135deg,rgba(127,234,255,.25),rgba(197,151,255,.25),rgba(255,201,138,.25))" }}>
                  <LogoGlass size={compact ? 30 : 48} />
                </div>
              );
              return (
                <button key={idx} type="button" disabled={!onToggle || busy} onClick={() => onToggle?.(idx)} aria-pressed={on}
                  className={`relative flex aspect-square flex-col items-center justify-center border border-graphite p-1.5 text-center transition-[transform,box-shadow,background] duration-100
                    ${on ? "translate-x-[3px] translate-y-[3px] bg-[#E7E1FF] shadow-none" : "bg-white shadow-[3px_3px_0_#0E0B2B] hover:bg-[#F4F3FF]"}
                    ${onToggle ? "cursor-pointer active:translate-x-[3px] active:translate-y-[3px] active:shadow-none" : "cursor-default"}`}>
                  <span className={`${compact ? "text-[8.5px]" : "text-[9.5px] sm:text-[12px]"} font-semibold leading-tight ${on ? "text-muted" : ""}`}>{c.label}</span>
                  {c.points !== 0 && <span className="num absolute bottom-1 right-1.5 text-[8.5px] text-faint">+{c.points}</span>}
                  {on && <span className="animate-stamp absolute left-1.5 top-1.5 grid h-5 w-5 place-items-center bg-graphite text-[11px] font-black text-white">✓</span>}
                </button>
              );
            })}
          </div>

          {/* Overlay: Vertical Columns Strike Lines */}
          {showCols && (
            <div className={`pointer-events-none absolute inset-0 z-20 grid grid-cols-5 ${gap}`} aria-hidden>
              {colsDone.map((d, ci) => (
                <div key={ci} className="relative">
                  {d && <span className="strike-v absolute -bottom-2 -top-2 left-1/2 -translate-x-1/2 w-[6px] rounded-full bg-ember shadow-[0_0_0_2px_#fff]" />}
                </div>
              ))}
            </div>
          )}

          {/* Overlay: Horizontal Rows Strike Lines */}
          {showRows && (
            <div className={`pointer-events-none absolute inset-0 z-20 grid grid-rows-5 ${gap}`} aria-hidden>
              {rowsDone.map((d, ri) => (
                <div key={ri} className="relative">
                  {d && <span className="strike-h absolute -left-2 -right-2 top-1/2 -translate-y-1/2 h-[6px] rounded-full bg-ember shadow-[0_0_0_2px_#fff]" />}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {full && (
        <div className="panel foil animate-rise flex items-center justify-between gap-3 p-4">
          <span className="font-display text-2xl">Full card · BINGO!</span>
          {rewards && <span className="text-sm font-semibold">{rewards.FULL || "Grand reward revealed soon"}</span>}
        </div>
      )}
    </div>
  );
}
