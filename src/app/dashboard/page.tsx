import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { loadWorld, teamSlice } from "@/lib/game";
import TeamArena from "@/components/team-arena";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const profile = await getCurrentProfile();
  if (profile.role === "admin") redirect("/dashboard/control");
  if (!profile.team_id) return <div className="panel p-6 text-sm">This account is not linked to a team. Ask an organiser.</div>;
  try {
    const world = await loadWorld({ teamId: profile.team_id });
    const me = world.teams.find(t => t.id === profile.team_id);
    const paddle = me?.paddle ?? world.teams.findIndex(t => t.id === profile.team_id) + 1;
    const v = teamSlice(world, profile.team_id);
    return <TeamArena v={v} paddle={paddle} />;
  } catch (e) {
    return <div className="panel p-6 text-sm text-err">The arena is warming up. Try again in a moment. ({e instanceof Error ? e.message : "error"})</div>;
  }
}
