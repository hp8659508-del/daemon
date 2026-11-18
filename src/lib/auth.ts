import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserCached, cachedProfile } from "@/lib/supabase/cached-user";

export type UserProfile = { id: string; role: string; team_id: string | null; must_change_password?: boolean | null };

export const getCurrentProfile = cache(async function getCurrentProfile(): Promise<UserProfile> {
  const supabase = await createClient();
  const user = await getUserCached(supabase as never, { strict: true });
  // the cookie holds a login Auth no longer accepts (e.g. a removed team): go to /login and
  // have it cleared there, otherwise /login → /dashboard → /login loops forever
  if (!user) redirect("/login?expired=1");
  const cached = await cachedProfile<UserProfile>(user.id, async () => {
    const { data } = await supabase.from("profiles").select("id, role, team_id, must_change_password").eq("id", user.id).maybeSingle();
    return (data as UserProfile | null) ?? null;
  });
  if (!cached) redirect("/login?error=profile");
  const profile = cached as UserProfile;
  if (profile.must_change_password) {
    // never trust a cached "must change" — the user may have just changed it on another server
    const { data: fresh } = await supabase.from("profiles").select("id, role, team_id, must_change_password").eq("id", user.id).maybeSingle();
    if (fresh && !fresh.must_change_password) return fresh as UserProfile;
  }
  if (profile.must_change_password) redirect("/account/change-password");
  return profile as UserProfile;
});

export async function requireAdmin() {
  const profile = await getCurrentProfile();
  if (profile.role !== "admin") redirect("/dashboard");
  return profile;
}
