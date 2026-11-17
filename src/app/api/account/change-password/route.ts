
import { forgetProfile } from "@/lib/supabase/cached-user";
import { NextResponse } from "next/server";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Please sign in again." },
        { status: 401 }
      );
    }

    const body = await request.json();
    const password =
      typeof body.password === "string" ? body.password : "";

    if (password.length < 10) {
      return NextResponse.json(
        { error: "Use at least 10 characters." },
        { status: 400 }
      );
    }

    const { error: passwordError } =
      await supabase.auth.updateUser({ password });

    if (passwordError) {
      return NextResponse.json(
        { error: passwordError.message },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      throw new Error("Server Supabase configuration is missing.");
    }

    const adminClient = createSupabaseAdmin(
      supabaseUrl,
      serviceKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    const { data: profile } = await adminClient
      .from("profiles")
      .select("id, team_id, role")
      .eq("id", user.id)
      .maybeSingle();

    const { error: profileError } = await adminClient
      .from("profiles")
      .update({ must_change_password: false })
      .eq("id", user.id);

    if (profileError) {
      throw profileError;
    }
    forgetProfile(user.id);

    if (profile?.team_id) {
      // Record password change event in activity_log for admin awareness
      await adminClient.from("activity_log").insert({
        team_id: profile.team_id,
        kind: "team",
        action: "password_changed",
        label: "Password changed by team lead",
        actor: user.id
      });

      // keep the organiser-visible copy in sync
      await adminClient.from("team_secrets").upsert({ team_id: profile.team_id, password, source: "team", updated_at: new Date().toISOString() });

      try {
        await (adminClient.from("teams") as any).update({ password_changed_at: new Date().toISOString() }).eq("id", profile.team_id);
      } catch {}
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Password update failed:", error);

    return NextResponse.json(
      { error: "Password update failed. Please try again." },
      { status: 500 }
    );
  }
}
