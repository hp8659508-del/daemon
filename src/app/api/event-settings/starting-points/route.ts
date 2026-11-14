import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Please sign in as an administrator." }, { status: 401 });

    const { data: profile, error: profileError } = await supabase
      .from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (profileError || profile?.role !== "admin") {
      return NextResponse.json({ error: "Only administrators can publish starting points." }, { status: 403 });
    }

    const body = await request.json();
    const amount = body.starting_points;
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1000000000) {
      return NextResponse.json({ error: "Enter a whole-number amount from 0 to 1,000,000,000." }, { status: 400 });
    }

    const { data, error } = await supabase.rpc("publish_event_starting_points", { p_points: amount });
    if (error) {
      const message = error.message.includes("already been published")
        ? "Starting points have already been published and cannot be published again."
        : error.message;
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ success: true, teams_updated: Number(data ?? 0), starting_points: amount });
  } catch (error) {
    console.error("Starting-points publication failed:", error);
    return NextResponse.json({ error: "Could not publish starting points. Please check the server logs." }, { status: 500 });
  }
}
