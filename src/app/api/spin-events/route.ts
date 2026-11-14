import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function adminUser() {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return { response: NextResponse.json({ error: "Please sign in." }, { status: 401 }) };
  const { data: profile } = await auth.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") return { response: NextResponse.json({ error: "Admin access required." }, { status: 403 }) };
  return { user };
}

export async function POST(request: Request) {
  try {
    const auth = await adminUser(); if (auth.response) return auth.response;
    const body = await request.json();
    const name = typeof body.event_name === "string" ? body.event_name.trim() : "";
    const outcomes = Array.isArray(body.outcomes) ? body.outcomes : [];
    if (!name || name.length > 100 || outcomes.length < 2 || outcomes.length > 30) return NextResponse.json({ error: "Enter an event name and between 2 and 30 outcomes." }, { status: 400 });
    const clean = outcomes.map((o: any, i: number) => ({ outcome_label: String(o.label ?? "").trim().slice(0,120), points_delta: Number(o.points_delta ?? 0), weight: Number(o.weight ?? 1), display_order: i }));
    if (clean.some((o: any) => !o.outcome_label || !Number.isSafeInteger(o.points_delta) || Math.abs(o.points_delta) > 100000 || !Number.isFinite(o.weight) || o.weight <= 0 || o.weight > 1000)) return NextResponse.json({ error: "Check every outcome label, point value and weight." }, { status: 400 });
    const db = createAdminClient();
    const { data: event, error } = await db.from("spin_events").insert({ event_name: name, status: "draft", created_by: auth.user!.id }).select().single();
    if (error) throw error;
    const { error: outcomeError } = await db.from("spin_outcomes").insert(clean.map((o: any) => ({ ...o, event_id: event.id })));
    if (outcomeError) { await db.from("spin_events").delete().eq("id", event.id); throw outcomeError; }
    return NextResponse.json({ event });
  } catch (e) {
    console.error("Spin event create failed", e);
    const details = e instanceof Error ? e.message : "Unknown database error";
    return NextResponse.json({ error: "Could not create spin event.", details }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await adminUser(); if (auth.response) return auth.response;
    const { id, status } = await request.json();
    if (typeof id !== "string" || !["published", "closed"].includes(status)) return NextResponse.json({ error: "Invalid event update." }, { status: 400 });
    const db = createAdminClient();
    if (status === "published") {
      const { count, error: countError } = await db.from("spin_outcomes").select("id", { count: "exact", head: true }).eq("event_id", id);
      if (countError) throw countError;
      if (!count || count < 2) return NextResponse.json({ error: "An event needs at least two outcomes." }, { status: 400 });
    }
    const { data, error } = await db.from("spin_events").update({ status, ...(status === "published" ? { published_at: new Date().toISOString() } : {}) }).eq("id", id).eq("status", "draft").select().maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Only draft events can be published." }, { status: 409 });
    return NextResponse.json({ event: data });
  } catch (e) { console.error("Spin event update failed", e); return NextResponse.json({ error: "Could not update spin event." }, { status: 500 }); }
}
