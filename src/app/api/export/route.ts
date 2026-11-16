import { NextResponse } from "next/server";
import { getStaff } from "@/lib/staff";
import { buildEval, evalCsv } from "@/lib/eval-sheet";

export const dynamic = "force-dynamic";

/** Evaluation spreadsheet (CSV, opens in Excel / Google Sheets): one row per card or penalty, team details on every row. */
export async function GET() {
  const staff = await getStaff();
  if (!staff) return NextResponse.json({ error: "Admin only." }, { status: 403 });
  const { teams } = await buildEval(staff);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return new NextResponse(evalCsv(teams), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="daemon-hour-eval-${stamp}.csv"`, "Cache-Control": "no-store" },
  });
}
