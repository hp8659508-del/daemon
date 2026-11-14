
import { NextResponse } from "next/server";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

function normalizeUsername(teamName: string) {
  return teamName
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function teamLoginEmail(username: string) {
  return `${username.toLowerCase()}@teams.daemonhour.invalid`;
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Please sign in as an administrator." },
        { status: 401 }
      );
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError || profile?.role !== "admin") {
      return NextResponse.json(
        { error: "Only administrators can create teams." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const teamName =
      typeof body.team_name === "string" ? body.team_name.trim() : "";

    if (!teamName || teamName.length > 80) {
      return NextResponse.json(
        { error: "Enter a team name (maximum 80 characters)." },
        { status: 400 }
      );
    }

    const username = normalizeUsername(teamName);

    if (!username || username.length > 40) {
      return NextResponse.json(
        { error: "The team name must contain letters or numbers." },
        { status: 400 }
      );
    }

    const initialPassword = `${username}_123`;
    const internalEmail = teamLoginEmail(username);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      throw new Error("Server Supabase configuration is missing.");
    }

    const adminClient = createSupabaseAdmin(supabaseUrl, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });

    const { data: settings, error: settingsError } = await adminClient
      .from("event_settings")
      .select("starting_points, starting_points_published")
      .eq("id", true)
      .single();

    if (settingsError) throw settingsError;

    const startingPoints = settings.starting_points_published ? Number(settings.starting_points ?? 0) : 0;

    const { data: team, error: teamError } = await adminClient
      .from("teams")
      .insert({ team_name: teamName, username })
      .select("id")
      .single();

    if (teamError) {
      if (teamError.code === "23505") {
        return NextResponse.json(
          { error: "A team with this name or username already exists." },
          { status: 409 }
        );
      }
      throw teamError;
    }

    let authUserId: string | null = null;

    try {
      const { data: authData, error: createUserError } =
        await adminClient.auth.admin.createUser({
          email: internalEmail,
          password: initialPassword,
          email_confirm: true,
          user_metadata: {
            team_name: teamName,
            team_username: username,
          },
        });

      if (createUserError) throw createUserError;

      authUserId = authData.user.id;

      const { error: profileInsertError } = await adminClient
        .from("profiles")
        .insert({
          id: authUserId,
          team_id: team.id,
          role: "team",
          must_change_password: true,
        });

      if (profileInsertError) throw profileInsertError;

      if (settings.starting_points_published) {
        const { error: transactionError } = await adminClient
          .from("transactions")
          .insert({
            team_id: team.id,
            description: "Initial event points",
            points: startingPoints,
            transaction_type: "bonus",
            created_by: user.id,
          });

        if (transactionError) throw transactionError;
      }
    } catch (creationError) {
      if (authUserId) {
        await adminClient.auth.admin.deleteUser(authUserId);
      }

      await adminClient.from("teams").delete().eq("id", team.id);
      throw creationError;
    }

    return NextResponse.json({
      success: true,
      team: {
        id: team.id,
        name: teamName,
        username,
        initial_password: initialPassword,
        starting_points: settings.starting_points_published ? startingPoints : null,
      },
    });
  } catch (error) {
    console.error("Team creation failed:", error);

    return NextResponse.json(
      { error: "Team creation failed. Please check the server logs." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Please sign in as an administrator." }, { status: 401 });
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (profile?.role !== "admin") return NextResponse.json({ error: "Only administrators can edit teams." }, { status: 403 });
    const body = await request.json();
    const id = typeof body.id === "string" ? body.id : "";
    const teamName = typeof body.team_name === "string" ? body.team_name.trim() : "";
    if (!id || !teamName || teamName.length > 80) return NextResponse.json({ error: "Enter a valid team name." }, { status: 400 });
    const username = normalizeUsername(teamName);
    if (!username || username.length > 40) return NextResponse.json({ error: "The team name must contain letters or numbers." }, { status: 400 });
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Server Supabase configuration is missing.");
    const adminClient = createSupabaseAdmin(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data, error } = await adminClient.from("teams").update({ team_name: teamName, username }).eq("id", id).select("id, team_name, username, created_at").single();
    if (error?.code === "23505") return NextResponse.json({ error: "That team name or username is already in use." }, { status: 409 });
    if (error) throw error;
    return NextResponse.json({ team: data });
  } catch (error) {
    console.error("Team update failed:", error);
    return NextResponse.json({ error: "Could not update the team." }, { status: 500 });
  }
}
