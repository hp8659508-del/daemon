
import { DataTable } from "@/components/data-table";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";

const config: Record<
  string,
  { title: string; description: string; table: string; adminOnly?: boolean }
> = {
  auctions: {
    title: "Auction items",
    description: "Auction inventory visible to your account.",
    table: "auction_items",
  },
  purchases: {
    title: "Purchases",
    description: "Purchase records available to your account.",
    table: "purchases",
  },
  transactions: {
    title: "Transactions",
    description: "A history of points added and deducted from your team.",
    table: "transactions",
  },
  teams: {
    title: "Teams",
    description: "All teams in the DAEMON HOUR workspace.",
    table: "teams",
    adminOnly: true,
  },
};

export async function SectionTable({
  section,
}: {
  section: keyof typeof config;
}) {
  const item = config[section];
  const profile = await getCurrentProfile();
  const isAdmin = profile.role === "admin";

  if (item.adminOnly && !isAdmin) {
    return (
      <div className="panel p-8 text-sm text-faint">
        You do not have permission to view this section.
      </div>
    );
  }

  const supabase = await createClient();

  const query =
    section === "transactions" && isAdmin
      ? supabase
          .from("transactions")
          .select("*, teams(team_name)")
      : supabase.from(item.table).select("*");

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(100);

  const rows = (data ?? []) as unknown as Record<string, unknown>[];

  return (
    <>
      <div className="mb-7">
        <p className="text-xs font-semibold uppercase tracking-[.2em] text-cobalt-ink">
          DAEMON HOUR / COMMAND DECK
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          {item.title}
        </h1>
        <p className="mt-2 text-sm text-faint">{item.description}</p>
      </div>

      <section className="panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-silver px-5 py-4">
          <div className="font-semibold">{item.title}</div>
          <span className="text-xs text-muted">Latest 100 records</span>
        </div>

        {error ? (
          <div className="p-6 text-sm text-err">
            Could not load {item.table}: {error.message}
          </div>
        ) : section === "transactions" ? (
          rows.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-faint">
              No transactions found yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[650px] text-left text-sm">
                <thead>
                  <tr className="border-b border-silver bg-frost">
                    {isAdmin && (
                      <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wider text-cobalt-ink">
                        Team Name
                      </th>
                    )}
                    <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wider text-cobalt-ink">
                      Date
                    </th>
                    <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wider text-cobalt-ink">
                      Description
                    </th>
                    <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wider text-cobalt-ink">
                      Type
                    </th>
                    <th className="px-5 py-4 text-right text-xs font-semibold uppercase tracking-wider text-cobalt-ink">
                      Points
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => {
                    const points = Number(row.points ?? 0);
                    const date = row.created_at
                      ? new Date(String(row.created_at)).toLocaleString()
                      : "—";

                    const team = row.teams as
                      | { team_name: string }
                      | null;

                    return (
                      <tr
                        key={String(row.id ?? index)}
                        className="border-b border-silver last:border-0 hover:bg-frost"
                      >
                        {isAdmin && (
                          <td className="px-5 py-4 font-semibold text-cobalt-ink">
                            {team?.team_name ?? "Team unavailable"}
                          </td>
                        )}
                        <td className="whitespace-nowrap px-5 py-4 text-muted">
                          {date}
                        </td>
                        <td className="px-5 py-4 text-graphite">
                          {String(row.description ?? "—")}
                        </td>
                        <td className="px-5 py-4">
                          <span className="rounded-full border border-silver bg-frost px-3 py-1 text-xs capitalize text-cobalt-ink">
                            {String(row.transaction_type ?? "—")}
                          </span>
                        </td>
                        <td
                          className={`whitespace-nowrap px-5 py-4 text-right font-semibold ${
                            points > 0
                              ? "text-ok"
                              : points < 0
                                ? "text-err"
                                : "text-muted"
                          }`}
                        >
                          {points > 0 ? "+" : ""}
                          {points.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <DataTable rows={rows} empty={`No ${item.title.toLowerCase()} found.`} />
        )}
      </section>

      <p className="mt-4 text-xs text-muted">
        Your account only displays records permitted by its database access
        policies.
      </p>
    </>
  );
}
