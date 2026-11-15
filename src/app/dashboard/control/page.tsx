import { requireStaff } from "@/lib/staff";
import { loadWorld } from "@/lib/game";
import { scopeWorld } from "@/lib/venues";
import AdminConsole from "@/components/admin-console";

export const dynamic = "force-dynamic";

export default async function ControlPage() {
  const staff = await requireStaff();
  try {
    const world = await loadWorld();
    // Venue admins only ever receive their own floor's data.
    const w = staff.isHost ? world : scopeWorld(world, staff.venue);
    return <AdminConsole w={w} staff={{ isHost: staff.isHost, venue: staff.venue, email: staff.email }} />;
  } catch (e) {
    return (
      <div className="panel p-6">
        <p className="font-display text-lg">Database not ready</p>
        <p className="mt-2 text-sm text-muted">{e instanceof Error ? e.message : String(e)}</p>
        <p className="mt-2 text-sm text-muted">Run the SQL files in <code className="num">supabase/</code> (ui_rebuild → ui_v2 → ui_v3_venues) in the Supabase SQL editor, then reload.</p>
      </div>
    );
  }
}
