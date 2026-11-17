import { getUserCached } from "@/lib/supabase/cached-user";
import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** A signed-in organiser. venue = null → host (all venues); otherwise scoped to that floor. */
export type Staff = { id: string; email: string; venue: string | null; isHost: boolean };

export async function getStaff(): Promise<Staff | null> {
  const supabase = await createClient();
  const user = await getUserCached(supabase as never);
  if (!user) return null;
  const { data: p } = await supabase.from("profiles").select("role, venue").eq("id", user.id).maybeSingle();
  if (p?.role !== "admin") return null;
  return { id: user.id, email: user.email ?? "", venue: p.venue ?? null, isHost: !p.venue };
}

export async function requireStaff(): Promise<Staff> {
  const s = await getStaff();
  if (!s) redirect("/dashboard");
  return s;
}
