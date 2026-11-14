
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";

type Purchase = {
  id: string;
  purchase_price: number;
  created_at: string;
  auction_items: { item_name: string } | null;
  teams: { team_name: string } | null;
};

export default async function PurchasesPage() {
  const profile = await getCurrentProfile();
  const supabase = await createClient();

  const isAdmin = profile.role === "admin";

  const { data, error } = await supabase
    .from("purchases")
    .select(`
      id,
      purchase_price,
      created_at,
      auction_items(item_name),
      teams(team_name)
    `)
    .order("created_at", { ascending: false })
    .limit(100);

  const purchases = (data ?? []) as unknown as Purchase[];

  return (
    <>
      <div className="mb-7">
        <p className="text-xs font-semibold uppercase tracking-[.2em] text-sky-300">
          DAEMON HOUR / COMMAND DECK
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Purchased Items
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          {isAdmin
            ? "All teams' auction purchases and points spent."
            : "Your team's auction purchases and points spent."}
        </p>
      </div>

      <section className="panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="font-semibold">Purchase History</div>
          <span className="text-xs text-slate-400">
            Latest 100 records
          </span>
        </div>

        {error ? (
          <div className="p-6 text-sm text-red-300">
            Could not load purchases: {error.message}
          </div>
        ) : purchases.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-slate-500">
            No items purchased yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/[.04]">
                  {isAdmin && (
                    <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wider text-sky-200/70">
                      Team Name
                    </th>
                  )}
                  <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wider text-sky-200/70">
                    Item
                  </th>
                  <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wider text-sky-200/70">
                    Purchase Date
                  </th>
                  <th className="px-5 py-4 text-right text-xs font-semibold uppercase tracking-wider text-sky-200/70">
                    Points Paid
                  </th>
                </tr>
              </thead>
              <tbody>
                {purchases.map((purchase) => (
                  <tr
                    key={purchase.id}
                    className="border-b border-white/10 last:border-0 hover:bg-white/[.03]"
                  >
                    {isAdmin && (
                      <td className="px-5 py-4 font-semibold text-sky-200">
                        {purchase.teams?.team_name ?? "Team unavailable"}
                      </td>
                    )}
                    <td className="px-5 py-4 font-medium text-slate-200">
                      {purchase.auction_items?.item_name ?? "Item unavailable"}
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 text-slate-400">
                      {new Date(purchase.created_at).toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 text-right font-semibold text-red-300">
                      -{Number(purchase.purchase_price).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
