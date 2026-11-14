import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import AuctionManager from "@/components/auction-manager";

export default async function AuctionsPage() {
  const profile = await getCurrentProfile();
  const supabase = await createClient();
  const isAdmin = profile.role === "admin" || profile.role === "organizer";

  let query = supabase
    .from("auction_items")
    .select("id, item_name, description, base_points, is_active, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (!isAdmin) query = query.eq("is_active", true);

  const [{ data: items, error }, { data: transactions }] = await Promise.all([
    query,
    profile.role === "team" && profile.team_id
      ? supabase.from("transactions").select("points").eq("team_id", profile.team_id)
      : Promise.resolve({ data: [] as { points: number }[] }),
  ]);

  if (error) {
    return <div className="panel p-6 text-sm text-red-300">Could not load auction items: {error.message}</div>;
  }

  const balance = (transactions ?? []).reduce((total, row) => total + Number(row.points ?? 0), 0);
  return <AuctionManager initialItems={items ?? []} isAdmin={isAdmin} initialBalance={balance} />;
}
