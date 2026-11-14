import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  const { data: profile } = await auth.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  try {
    const body = await request.json();
    const team_id = typeof body.team_id === "string" ? body.team_id.trim() : "";
    const result_label = typeof body.result_label === "string" ? body.result_label.trim() : "";
    const points_delta = Number(body.points_delta ?? 0);
    const award = body.award_points === true;
    const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 500) : "";

    if (!team_id || !result_label || result_label.length > 160 || !Number.isSafeInteger(points_delta) || Math.abs(points_delta) > 100000) {
      return NextResponse.json({ error: "Choose a team, enter a result and use a whole-number point value between -100,000 and 100,000." }, { status: 400 });
    }

    const db = createAdminClient();
    const { data: team, error: teamError } = await db.from("teams").select("id").eq("id", team_id).maybeSingle();
    if (teamError) throw teamError;
    if (!team) return NextResponse.json({ error: "The selected team no longer exists. Refresh the page and choose a team again." }, { status: 404 });

    const appliedPoints = award ? points_delta : 0;
    const { data: record, error: recordError } = await db.from("manual_spin_records").insert({
      team_id,
      result_label,
      notes: notes || null,
      points_delta: appliedPoints,
      points_awarded: award,
      created_by: user.id,
    }).select().single();
    if (recordError) throw recordError;

    if (award && points_delta !== 0) {
      const { error: ledgerError } = await db.from("transactions").insert({
        team_id,
        description: `Physical spin result: ${result_label}`,
        points: points_delta,
        transaction_type: "adjustment",
        created_by: user.id,
      });
      if (ledgerError) {
        await db.from("manual_spin_records").delete().eq("id", record.id);
        throw ledgerError;
      }
    }

    return NextResponse.json({ success: true, record });
  } catch (error) {
    console.error("Manual spin record failed:", error);
    return NextResponse.json({ error: "Could not save the physical spin result.", details: error instanceof Error ? error.message : "Unknown database error" }, { status: 500 });
  }
}
