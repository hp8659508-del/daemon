import { requireAdmin } from "@/lib/auth";
import { loadWorld } from "@/lib/game";
import AdminConsole from "@/components/admin-console";

export const dynamic = "force-dynamic";

export default async function ControlPage() {
  await requireAdmin();
  try {
    return <AdminConsole w={await loadWorld()} />;
  } catch (e) {
    return (
      <div className="panel p-6">
        <p className="font-display text-lg font-bold">Database not ready</p>
        <p className="mt-2 text-sm text-muted">{e instanceof Error ? e.message : String(e)}</p>
        <p className="mt-2 text-sm text-muted">Run <code className="num">supabase/ui_rebuild_migration.sql</code> in the Supabase SQL editor, then reload.</p>
      </div>
    );
  }
}
