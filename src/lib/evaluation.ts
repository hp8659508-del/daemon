export const CRITERIA = [
  { key: "impact", label: "Impact" },
  { key: "innovation", label: "Innovation" },
  { key: "presentation", label: "Presentation" },
  { key: "prototype", label: "Prototype" },
] as const;

export type Criterion = (typeof CRITERIA)[number]["key"];
export const CRIT_MAX = 20, EVAL_MAX = 80;

export type EvalScore = {
  team_id: string;
  impact: number | null;
  innovation: number | null;
  presentation: number | null;
  prototype: number | null;
  remarks: string | null;
  updated_at: string;
};

export type Certificate = {
  id: string;
  team_id: string;
  member_name: string | null;
  label: string;
  file_path: string;
  file_name: string;
  created_at: string;
};

export const evalTotal = (e: EvalScore | null | undefined) =>
  e ? CRITERIA.reduce((a, c) => a + (e[c.key] ?? 0), 0) : null;

export const evalComplete = (e: EvalScore | null | undefined) =>
  !!e && CRITERIA.every(c => e[c.key] != null);
