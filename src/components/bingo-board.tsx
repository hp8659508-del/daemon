"use client";

import { COLUMNS, LETTERS } from "@/lib/bingo-shared";
import { LogoGlass } from "@/components/ui";

type Cell = { idx: number; label: string; points: number; is_free: boolean };

/**
 * Swiss-instrument bingo board. Each square is a pressable key. A finished
 * column is struck with ONE continuous bar drawn on an overlay layer that
 * spans the full board height, and its letter in B-I-N-G-O is struck out.
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
  const gap = "gap-2 sm:gap-3";

  return (
    <div className="space-y-3">
      <div className={`grid grid-cols-5 ${gap}`}>
        {LETTERS.map((L, i) => (
          <div key={L} className={`relative grid place-items-center overflow-hidden border border-graphite py-2 shadow-[3px_3px_0_#0E0B2B] ${done[i] ? "bg-graphite text-white" : "bg-white"}`}>
            <span className={`font-display text-3xl sm:text-5xl ${done[i] ? "opacity-60" : ""}`}>{L}</span>
            {done[i] && <span className="strike-h pointer-events-none absolute left-[12%] right-[12%] top-[40%] h-[5px] rounded-full bg-ember" />}
            {rewards && <span className="mt-0.5 line-clamp-1 px-1 text-[9px] font-semibold uppercase tracking-wider opacity-70">{rewards[L] || "Reward soon"}</span>}
          </div>
        ))}
      </div>

      <div className="relative">
        <div className={`grid grid-cols-5 ${gap}`}>
          {Array.from({ length: 25 }, (_, idx) => {
            const c = byIdx.get(idx);
            if (!c) return <div key={idx} className="aspect-square" />;
            const on = marked.has(idx);
            if (c.is_free) return (
              <div key={idx} className="grid aspect-square place-items-center border border-graphite bg-white shadow-[3px_3px_0_#0E0B2B]"
                style={{ backgroundImage: "linear-gradient(135deg,rgba(127,234,255,.25),rgba(197,151,255,.25),rgba(255,201,138,.25))" }}>
                <LogoGlass size={compact ? 34 : 52} />
              </div>
            );
            return (
              <button key={idx} type="button" disabled={!onToggle || busy} onClick={() => onToggle?.(idx)} aria-pressed={on}
                className={`relative flex aspect-square flex-col items-center justify-center border border-graphite p-1.5 text-center transition-[transform,box-shadow,background] duration-100
                  ${on ? "translate-x-[3px] translate-y-[3px] bg-[#E7E1FF] shadow-none" : "bg-white shadow-[3px_3px_0_#0E0B2B] hover:bg-[#F4F3FF]"}
                  ${onToggle ? "cursor-pointer active:translate-x-[3px] active:translate-y-[3px] active:shadow-none" : "cursor-default"}`}>
                <span className={`${compact ? "text-[9px]" : "text-[10px] sm:text-[12.5px]"} font-semibold leading-tight ${on ? "text-muted" : ""}`}>{c.label}</span>
                {c.points !== 0 && <span className="num absolute bottom-1 right-1.5 text-[9px] text-faint">+{c.points}</span>}
                {on && <span className="animate-stamp absolute left-1.5 top-1.5 grid h-5 w-5 place-items-center bg-graphite text-[11px] font-black text-white">✓</span>}
              </button>
            );
          })}
        </div>
        {/* Overlay: same 5-column grid, one full-height bar per finished column */}
        <div className={`pointer-events-none absolute inset-0 z-20 grid grid-cols-5 ${gap}`} aria-hidden>
          {done.map((d, ci) => (
            <div key={ci} className="relative">
              {d && <span className="strike-v absolute -bottom-2 -top-2 left-1/2 w-[6px] rounded-full bg-ember shadow-[0_0_0_2px_#fff]" />}
            </div>
          ))}
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
