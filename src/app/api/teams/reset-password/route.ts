import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
export async function POST(request: Request) {
  const auth = await createClient(); const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const { data: profile } = await auth.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const { team_id } = await request.json(); if (typeof team_id !== "string") return NextResponse.json({ error: "Team ID is required." }, { status: 400 });
  const db = createAdminClient();
  const { data: team, error } = await db.from("profiles").update({ must_change_password: true }).eq("team_id", team_id).eq("role", "team").select("id").maybeSingle();
  if (error) return NextResponse.json({ error: "Could not require password reset." }, { status: 500 });
  if (!team) return NextResponse.json({ error: "Team account not found." }, { status: 404 });
  return NextResponse.json({ success: true });
}
