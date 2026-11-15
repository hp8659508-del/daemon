import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** Team lead taps "Need help": one open request per team at a time. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { data: p } = await supabase.from("profiles").select("team_id").eq("id", user.id).maybeSingle();
  if (!p?.team_id) return NextResponse.json({ error: "Not a team account." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const db = createAdminClient();
  if (body.cancel) {
    await db.from("help_requests").update({ status: "resolved", resolved_at: new Date().toISOString() }).eq("team_id", p.team_id).eq("status", "open");
    return NextResponse.json({ ok: true });
  }
  const { data: open } = await db.from("help_requests").select("id").eq("team_id", p.team_id).eq("status", "open").maybeSingle();
  if (open) return NextResponse.json({ ok: true, already: true });
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 160) || null : null;
  const { error } = await db.from("help_requests").insert({ team_id: p.team_id, message });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
