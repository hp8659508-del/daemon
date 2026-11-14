import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { loadWorld, teamSlice, type Activity_ } from "@/lib/game";
import { createAdminClient } from "@/lib/supabase/admin";
import TeamArena from "@/components/team-arena";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const profile = await getCurrentProfile();
  if (profile.role === "admin") redirect("/dashboard/control");
  if (!profile.team_id) return <div className="panel p-6 text-sm">This account is not linked to a team. Ask an organiser.</div>;
  try {
    const world = await loadWorld();
    const paddle = world.teams.findIndex(t => t.id === profile.team_id) + 1;
    const v = teamSlice(world, profile.team_id);
    // Full history for this team (the world snapshot only holds the latest 1000 events overall).
    const { data: mine } = await createAdminClient().from("activity_log").select("id,team_id,kind,action,label,points,minutes,created_at").eq("team_id", profile.team_id).order("created_at", { ascending: false }).limit(500);
    if (mine) v.activity = mine as Activity_[];
    return <TeamArena v={v} paddle={paddle} />;
  } catch (e) {
    return <div className="panel p-6 text-sm text-err">The arena is warming up. Try again in a moment. ({e instanceof Error ? e.message : "error"})</div>;
  }
}
