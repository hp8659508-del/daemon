import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type UserProfile = { id: string; role: string; team_id: string | null; must_change_password?: boolean | null };

export async function getCurrentProfile(): Promise<UserProfile> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile, error } = await supabase.from("profiles").select("id, role, team_id, must_change_password").eq("id", user.id).maybeSingle();
  if (error || !profile) redirect("/login?error=profile");
  if (profile.must_change_password) redirect("/account/change-password");
  return profile as UserProfile;
}

export async function requireAdmin() {
  const profile = await getCurrentProfile();
  if (profile.role !== "admin") redirect("/dashboard");
  return profile;
}
