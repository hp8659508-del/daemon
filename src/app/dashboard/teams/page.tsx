
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import TeamManager from "@/components/team-manager";

export default async function TeamsPage() {
  await requireAdmin();

  const supabase = await createClient();

  const { data: teams, error } = await supabase
    .from("teams")
    .select("id, team_name, username, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <div className="panel p-6 text-sm text-err">
        Could not load teams: {error.message}
      </div>
    );
  }

  const { data: settings, error: settingsError } = await supabase
    .from("event_settings")
    .select("starting_points, starting_points_published")
    .eq("id", true)
    .single();

  if (settingsError) {
    return <div className="panel p-6 text-sm text-err">Could not load event settings: {settingsError.message}</div>;
  }

  return (
    <TeamManager
      initialTeams={teams ?? []}
      initialStartingPoints={Number(settings.starting_points ?? 0)}
      startingPointsPublished={Boolean(settings.starting_points_published)}
    />
  );
}
