
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { TeamSpin } from "@/components/spin-manager";
import {
  Gavel,
  ShoppingCart,
  Receipt,
  Users,
  ArrowUpRight,
  Hourglass,
  Sparkles,
  Wallet,
  TrendingUp,
  TrendingDown,
  Package,
} from "lucide-react";

export default async function DashboardPage() {
  const profile = await getCurrentProfile();
  const supabase = await createClient();

  const tables = [
    {
      name: "auction_items",
      label: "Auction items",
      href: "/dashboard/auctions",
      icon: Gavel,
      note: "Inventory in play",
    },
    {
      name: "purchases",
      label: "Purchases",
      href: "/dashboard/purchases",
      icon: ShoppingCart,
      note: "Successful acquisitions",
    },
    {
      name: "transactions",
      label: "Transactions",
      href: "/dashboard/transactions",
      icon: Receipt,
      note: "Recorded activity",
    },
    ...(profile.role === "admin"
      ? [
          {
            name: "teams",
            label: "Teams",
            href: "/dashboard/teams",
            icon: Users,
            note: "Auction participants",
          },
        ]
      : []),
  ];

  const results = await Promise.all(
    tables.map(async (table) => {
      const { count, error } = await supabase
        .from(table.name)
        .select("*", { count: "exact", head: true });

      return {
        ...table,
        count: error ? null : count,
      };
    })
  );

  let remainingPoints = 0;
  let pointsEarned = 0;
  let pointsSpent = 0;
  let itemsPurchased = 0;

  if (profile.role === "team" && profile.team_id) {
    const [
      { data: transactions },
      { data: purchases, count: purchaseCount },
    ] = await Promise.all([
      supabase
        .from("transactions")
        .select("points")
        .eq("team_id", profile.team_id),

      supabase
        .from("purchases")
        .select("purchase_price", { count: "exact" })
        .eq("team_id", profile.team_id),
    ]);

    const transactionValues = transactions ?? [];
    const purchaseValues = purchases ?? [];

    const transactionTotal = transactionValues.reduce(
      (total, item) => total + Number(item.points ?? 0),
      0
    );

    pointsEarned = transactionValues.reduce(
      (total, item) =>
        total + Math.max(Number(item.points ?? 0), 0),
      0
    );

    pointsSpent = purchaseValues.reduce(
      (total, item) =>
        total + Number(item.purchase_price ?? 0),
      0
    );

    // Purchases are also recorded as negative ledger transactions.
    // The ledger total is therefore the canonical available balance.
    remainingPoints = transactionTotal;
    itemsPurchased = purchaseCount ?? 0;
  }

  let liveSpinEvents: any[] = [];
  if (profile.role === "team" && profile.team_id) {
    const { data: events } = await supabase.from("spin_events").select("id,event_name,status,created_at").eq("status", "published").order("published_at", { ascending: false });
    const eventIds = (events ?? []).map((event) => event.id);
    const [{ data: outcomes }, { data: mySpins }] = await Promise.all([
      eventIds.length ? supabase.from("spin_outcomes").select("id,event_id,outcome_label,points_delta,weight,display_order").in("event_id", eventIds).order("display_order") : Promise.resolve({ data: [] as any[] }),
      supabase.from("team_spins").select("event_id,outcome_label,points_delta").eq("team_id", profile.team_id),
    ]);
    liveSpinEvents = (events ?? []).map((event) => ({
      event,
      outcomes: (outcomes ?? []).filter((outcome) => outcome.event_id === event.id),
      prior: (mySpins ?? []).find((spin) => spin.event_id === event.id) ?? null,
    }));
  }

  const pointCards = [
    {
      label: "Remaining points",
      value: remainingPoints,
      note: "Your available auction balance",
      icon: Wallet,
    },
    {
      label: "Points earned",
      value: pointsEarned,
      note: "Bonuses and positive adjustments",
      icon: TrendingUp,
    },
    {
      label: "Points spent",
      value: pointsSpent,
      note: "Points used for purchases",
      icon: TrendingDown,
    },
    {
      label: "Items purchased",
      value: itemsPurchased,
      note: "Successful acquisitions",
      icon: Package,
    },
  ];

  return (
    <>
      <section className="relative mb-7 min-h-[260px] overflow-hidden rounded-[28px] border border-sky-200/15 bg-[#0b1424] shadow-glow">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_75%_45%,rgba(54,140,255,.2),transparent_38%),linear-gradient(110deg,#0a101c_5%,rgba(8,14,25,.88)_52%,rgba(8,14,25,.42))]" />

        <div
          className="absolute inset-y-0 right-0 hidden w-[47%] bg-cover bg-[center_42%] opacity-35 mix-blend-screen md:block"
          style={{ backgroundImage: "url('/daemon-hour-poster.png')" }}
        />

        <div className="absolute -right-12 -top-24 h-72 w-72 rounded-full border border-sky-200/10" />
        <div className="absolute -right-2 -top-14 h-52 w-52 rounded-full border border-sky-200/10" />

        <div className="relative z-10 max-w-2xl p-7 sm:p-10">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-sky-200/20 bg-sky-300/10 px-3 py-2 text-[10px] font-bold uppercase tracking-[.2em] text-sky-200">
            <Sparkles size={13} />
            Auction command center
          </div>

          <p className="text-xs font-semibold uppercase tracking-[.25em] text-slate-400">
            Welcome back · {profile.role}
          </p>

          <h1 className="glow-text mt-3 text-4xl font-black tracking-tight text-white sm:text-5xl">
            Own the moment.
            <br />
            <span className="text-sky-200">Beat the clock.</span>
          </h1>

          <p className="mt-4 max-w-md text-sm leading-6 text-slate-400">
            Your DAEMON HOUR operations, bids and auction activity — brought
            together in one command deck.
          </p>

          <div className="mt-6 flex items-center gap-2 text-xs font-semibold tracking-wide text-amber-200">
            <Hourglass size={15} />
            EVERY SECOND COUNTS
          </div>
        </div>
      </section>

      {profile.role === "team" && liveSpinEvents.length > 0 && (
        <section className="mb-8 space-y-4">
          <div><p className="text-[10px] font-bold uppercase tracking-[.24em] text-sky-300/70">Event arena</p><h2 className="mt-2 text-xl font-semibold">Live spin events</h2></div>
          {liveSpinEvents.map(({event, outcomes, prior}) => <TeamSpin key={event.id} event={event} outcomes={outcomes} prior={prior} />)}
        </section>
      )}

      {profile.role === "team" && (
        <section className="mb-8">
          <div className="mb-5">
            <p className="text-[10px] font-bold uppercase tracking-[.24em] text-sky-300/70">
              Your team finances
            </p>
            <h2 className="mt-2 text-xl font-semibold text-white">
              Points overview
            </h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {pointCards.map((card) => {
              const Icon = card.icon;

              return (
                <div
                  key={card.label}
                  className="panel p-5 transition duration-300 hover:border-sky-200/30 hover:shadow-glow"
                >
                  <div className="flex items-center justify-between">
                    <div className="rounded-xl border border-sky-200/15 bg-sky-300/10 p-3 text-sky-200">
                      <Icon size={20} />
                    </div>
                    <Hourglass size={16} className="text-slate-600" />
                  </div>

                  <p className="mt-5 text-sm font-medium text-slate-300">
                    {card.label}
                  </p>

                  <p className="mt-1 text-3xl font-semibold tracking-tight text-white">
                    {card.value.toLocaleString("en-IN")}
                  </p>

                  <p className="mt-2 text-[11px] text-slate-500">
                    {card.note}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.24em] text-sky-300/70">
            Live workspace
          </p>
          <h2 className="mt-2 text-xl font-semibold text-white">
            Your overview
          </h2>
        </div>

        <div className="rounded-full border border-white/10 bg-white/[.04] px-4 py-2 text-[10px] font-semibold uppercase tracking-[.16em] text-slate-400">
          {profile.role} account
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {results.map((item) => {
          const Icon = item.icon;

          return (
            <Link
              key={item.name}
              href={item.href}
              className="panel group p-5 transition duration-300 hover:-translate-y-1 hover:border-sky-200/30 hover:shadow-glow"
            >
              <div className="flex items-center justify-between">
                <div className="rounded-xl border border-sky-200/15 bg-sky-300/10 p-3 text-sky-200">
                  <Icon size={20} />
                </div>
                <ArrowUpRight
                  size={17}
                  className="text-slate-600 transition group-hover:text-sky-200"
                />
              </div>

              <p className="mt-6 text-sm font-medium text-slate-300">
                {item.label}
              </p>

              <p className="mt-1 text-4xl font-semibold tracking-tight text-white">
                {item.count === null ? "—" : item.count}
              </p>

              <p className="mt-2 text-[11px] text-slate-500">
                {item.count === null
                  ? "Check table permissions"
                  : item.note}
              </p>
            </Link>
          );
        })}
      </div>

      <section className="panel mt-6 flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sky-200">
            <Hourglass size={17} />
            <h2 className="text-sm font-semibold text-white">
              The clock is running
            </h2>
          </div>

          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
            {profile.role === "admin"
              ? "You have administrator access. Manage auction inventory, review purchases and transactions, and oversee participating teams."
              : "Your account is linked to its assigned team. Your points and activity are shown in your personal team workspace."}
          </p>
        </div>

        <div className="shrink-0 rounded-xl border border-amber-200/15 bg-amber-200/[.06] px-4 py-3 text-xs font-semibold tracking-wide text-amber-100">
          BID IT · SPIN IT · BINGO IT
        </div>
      </section>
    </>
  );
}
