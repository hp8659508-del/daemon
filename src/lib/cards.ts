/** Client-safe card vocabulary (game.ts is server-only). */
export type CardKind = "time" | "points" | "bingo" | "note" | "trump";
export type Phase = "ps" | "build" | "spin" | "penalty" | "presentation" | "other";
export type Perk = "none" | "no_penalty" | "pass_penalty" | "swap_ps";
export type CardEffect = { minutes?: number; amount?: number; mode?: "cell" | "column"; column?: number; phase?: Phase; perk?: Perk };

export const KINDS: { key: CardKind; label: string; hint: string }[] = [
  { key: "time", label: "Time", hint: "Changes the buyer's deadline automatically" },
  { key: "points", label: "Points", hint: "Adds auction points automatically" },
  { key: "bingo", label: "Bingo", hint: "Stamps the buyer's bingo sheet automatically" },
  { key: "note", label: "Note", hint: "Recorded on the team for evaluation" },
  { key: "trump", label: "Trump", hint: "Becomes a copy of any card the team picks" },
];
export const PHASES: { key: Phase; label: string }[] = [
  { key: "ps", label: "Problem statement" },
  { key: "build", label: "Build" },
  { key: "spin", label: "Spin wheel" },
  { key: "penalty", label: "Penalties" },
  { key: "presentation", label: "Presentation" },
  { key: "other", label: "Other" },
];
export const PERKS: { key: Perk; label: string; hint: string }[] = [
  { key: "none", label: "Plain note", hint: "Judges refer to it; nothing automatic" },
  { key: "no_penalty", label: "No penalties", hint: "Blocks the next penalty (once)" },
  { key: "pass_penalty", label: "Pass penalties", hint: "Sends the next penalty to the next team in the venue (once)" },
  { key: "swap_ps", label: "Swap problem statement", hint: "Swap with any team once; both become final" },
];
export const LETTERS = ["B", "I", "N", "G", "O"];
export const kindLabel = (k: string) => KINDS.find(x => x.key === k)?.label ?? k;
export const phaseLabel = (p?: string) => PHASES.find(x => x.key === p)?.label ?? "Other";
export const perkLabel = (p?: string) => PERKS.find(x => x.key === p)?.label ?? "";
export const boxName = (idx: number) => `${LETTERS[idx % 5]}${Math.floor(idx / 5) + 1}`;

export function effectText(kind: string, e: CardEffect | null | undefined): string {
  const f = e ?? {};
  if (kind === "time") return `${(f.minutes ?? 0) > 0 ? "+" : ""}${f.minutes ?? 0} min on deadline`;
  if (kind === "points") return `${(f.amount ?? 0) > 0 ? "+" : ""}${f.amount ?? 0} auction points`;
  if (kind === "bingo") return f.mode === "column" ? `Completes column ${LETTERS[f.column ?? 0]}` : "Covers one box (admin picks)";
  if (kind === "trump") return "Copies any card";
  const perk = f.perk && f.perk !== "none" ? `${perkLabel(f.perk)} · ` : "";
  return `${perk}${phaseLabel(f.phase)}`;
}

export const STATUS_LABEL: Record<string, string> = { applied: "Applied", held: "Held", spent: "Used", pending: "Choose card", resolved: "Copied" };
