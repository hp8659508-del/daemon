import { NextResponse } from "next/server";
import { getStaff } from "@/lib/staff";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Full event backup (hosts only): every game table as JSON. The free Supabase plan keeps
 * no backups, so download one before each round. Passwords are NOT included.
 */
const TABLES = ["teams", "team_members", "team_stages", "event_settings", "transactions", "purchases", "auction_items", "powerups",
  "team_powerups", "bingo_cells", "team_bingo", "team_cards", "penalties", "team_ledger", "quiz_sections", "quiz_questions",
  "quiz_runs", "quiz_answers", "quiz_flags", "activity_log", "help_requests", "profiles"];

export async function GET() {
  const staff = await getStaff();
  if (!staff?.isHost) return NextResponse.json({ error: "Hosts only." }, { status: 403 });
  const db = createAdminClient();
  const out: Record<string, unknown[]> = {};
  const errors: Record<string, string> = {};
  for (const t of TABLES) {
    const rows: unknown[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from(t).select("*").range(from, from + 999);
      if (error) { errors[t] = error.message; break; }
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    out[t] = rows;
  }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return new NextResponse(JSON.stringify({ taken_at: new Date().toISOString(), tables: out, errors }, null, 1), {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="daemon-hour-backup-${stamp}.json"`, "Cache-Control": "no-store" },
  });
}
