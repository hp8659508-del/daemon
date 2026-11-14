"use client";

import { COLUMNS, LETTERS } from "@/lib/bingo-shared";
import { LogoGlass } from "@/components/ui";

type Cell = { idx: number; label: string; points: number; is_free: boolean };

/**
 * Swiss-instrument bingo board. Each square is a pressable key; a completed
 * column gets a hand-drawn scratch and its letter in B-I-N-G-O is struck out.
 */
export default function BingoBoard({
  cells, marked, onToggle, busy, rewards, compact = false,
}: {
  cells: Cell[]; marked: Set<number>; onToggle?: (idx: number) => void; busy?: boolean;
  rewards?: Record<string, string>; compact?: boolean;
}) {
  const free = new Set(cells.filter(c => c.is_free).map(c => c.idx));
  const done = COLUMNS.map(col => col.every(i => marked.has(i) || free.has(i)));
  const full = done.every(Boolean);
  const byIdx = new Map(cells.map(c => [c.idx, c]));

  return (
    <div className="space-y-3">
      {/* Letter header */}
      <div className="grid grid-cols-5 gap-2 sm:gap-3">
        {LETTERS.map((L, i) => (
          <div key={L} className={`relative grid place-items-center border border-graphite py-2 ${done[i] ? "bg-graphite text-white" : "bg-white"} shadow-[3px_3px_0_#111]`}>
            <span className={`font-display text-3xl sm:text-5xl ${done[i] ? "opacity-60" : ""}`}>{L}</span>
            {done[i] && <Scratch horizontal />}
            {rewards && <span className="mt-0.5 line-clamp-1 px-1 text-[9px] font-semibold uppercase tracking-wider opacity-70">{rewards[L] || "Reward soon"}</span>}
          </div>
        ))}
      </div>

      {/* Board: render column-major so each column can carry its own scratch */}
      <div className="grid grid-cols-5 gap-2 sm:gap-3">
        {COLUMNS.map((col, ci) => (
          <div key={ci} className="relative grid gap-2 sm:gap-3">
            {col.map(idx => {
              const c = byIdx.get(idx); if (!c) return <div key={idx} />;
              const on = marked.has(idx);
              if (c.is_free) return (
                <div key={idx} className="grid aspect-square place-items-center border border-graphite bg-white shadow-[3px_3px_0_#111]" style={{ backgroundImage: "linear-gradient(135deg,rgba(127,234,255,.25),rgba(197,151,255,.25),rgba(255,201,138,.25))" }}>
                  <LogoGlass size={compact ? 34 : 52} />
                </div>
              );
              return (
                <button key={idx} type="button" disabled={!onToggle || busy} onClick={() => onToggle?.(idx)}
                  aria-pressed={on}
                  className={`group relative flex aspect-square flex-col items-center justify-center border border-graphite p-1.5 text-center transition-[transform,box-shadow,background] duration-100
                    ${on ? "translate-x-[3px] translate-y-[3px] bg-[#EEF1FF] shadow-none" : "bg-white shadow-[3px_3px_0_#111] hover:bg-[#F4F4F2]"}
                    ${onToggle ? "cursor-pointer active:translate-x-[3px] active:translate-y-[3px] active:shadow-none" : "cursor-default"}`}>
                  <span className={`${compact ? "text-[9px]" : "text-[10px] sm:text-[12.5px]"} font-semibold leading-tight ${on ? "text-muted" : ""}`}>{c.label}</span>
                  {c.points !== 0 && <span className="num absolute bottom-1 right-1.5 text-[9px] text-faint">+{c.points}</span>}
                  {on && <span className="animate-stamp absolute left-1.5 top-1.5 grid h-5 w-5 place-items-center bg-graphite text-[11px] font-black text-white">✓</span>}
                </button>
              );
            })}
            {done[ci] && <Scratch />}
          </div>
        ))}
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

/** A crisp strike through the central axis of a completed column or letter. */
function Scratch({ horizontal = false }: { horizontal?: boolean }) {
  return (
    <svg
      className="pointer-events-none absolute inset-0 z-20 h-full w-full overflow-visible"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
    >
      <path
        d={horizontal ? "M 6 50 L 94 50" : "M 50 1 L 50 99"}
        fill="none"
        stroke="#E07A5F"
        strokeWidth={5}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        opacity={0.95}
        pathLength={1}
        style={{
          strokeDasharray: 1,
          strokeDashoffset: 0,
          animation: "draw .4s cubic-bezier(.16,1,.3,1) forwards",
        }}
      />
    </svg>
  );
}
