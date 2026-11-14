import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ResetTeamPassword } from "@/components/reset-team-password";

type ActivityItem = {
  id: string;
  kind: "Transaction" | "Auction purchase" | "Digital spin" | "Physical spin";
  title: string;
  detail: string;
  points: number | null;
  createdAt: string;
};

export default async function TeamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const db = createAdminClient();

  const [teamResult, teamsResult, transactionsResult, purchasesResult, spinsResult, manualResult, membersResult] = await Promise.all([
    db.from("teams").select("id, team_name, username, registration_email, contact_number, registration_submitted_at").eq("id", id).maybeSingle(),
    db.from("teams").select("id, team_name").order("team_name"),
    db.from("transactions").select("id, description, points, transaction_type, created_at").eq("team_id", id).order("created_at", { ascending: false }),
    db.from("purchases").select("id, purchase_price, created_at, auction_items(item_name)").eq("team_id", id).order("created_at", { ascending: false }),
    db.from("team_spins").select("id, outcome_label, points_delta, created_at, spin_events(event_name)").eq("team_id", id).order("created_at", { ascending: false }),
    db.from("manual_spin_records").select("id, result_label, notes, points_delta, points_awarded, created_at").eq("team_id", id).order("created_at", { ascending: false }),
    db.from("team_members").select("id, member_name, usn, department, member_order").eq("team_id", id).order("member_order"),
  ]);

  if (!teamResult.data) notFound();
  const queryErrors = [transactionsResult.error, purchasesResult.error, spinsResult.error, manualResult.error].filter(Boolean);
  const transactions = transactionsResult.data ?? [];
  const purchases = purchasesResult.data ?? [];
  const spins = spinsResult.data ?? [];
  const manual = manualResult.data ?? [];
  const balance = transactions.reduce((sum, row) => sum + Number(row.points ?? 0), 0);
  const earned = transactions.reduce((sum, row) => sum + Math.max(0, Number(row.points ?? 0)), 0);
  const spent = purchases.reduce((sum, row) => sum + Number(row.purchase_price ?? 0), 0);

  const activity: ActivityItem[] = [
    ...transactions.map((row) => ({ id: `tx-${row.id}`, kind: "Transaction" as const, title: row.description, detail: row.transaction_type, points: Number(row.points), createdAt: row.created_at ?? "" })),
    ...purchases.map((row) => ({ id: `purchase-${row.id}`, kind: "Auction purchase" as const, title: (row.auction_items as { item_name?: string } | null)?.item_name ?? "Auction item", detail: "Item purchased", points: -Number(row.purchase_price), createdAt: row.created_at })),
    ...spins.map((row) => ({ id: `spin-${row.id}`, kind: "Digital spin" as const, title: `${(row.spin_events as { event_name?: string } | null)?.event_name ?? "Spin event"}: ${row.outcome_label}`, detail: "Wheel result", points: Number(row.points_delta), createdAt: row.created_at })),
    ...manual.map((row) => ({ id: `manual-${row.id}`, kind: "Physical spin" as const, title: row.result_label, detail: [row.points_awarded ? `${row.points_delta} points applied` : "No points applied", row.notes].filter(Boolean).join(" · "), points: row.points_awarded ? Number(row.points_delta) : null, createdAt: row.created_at })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const team = teamResult.data;
  return (
    <div className="space-y-6">
      <header>
        <Link href="/dashboard/teams" className="text-sm text-sky-300 hover:text-sky-100">← All teams</Link>
        <p className="mt-4 text-xs uppercase tracking-[.2em] text-sky-300">Team activity monitor</p>
        <h1 className="mt-2 text-3xl font-bold">{team.team_name}</h1>
        <p className="mt-1 text-sm text-slate-400">Username: {team.username ?? "—"}</p>
      </header>

      <section className="panel p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Select a team to monitor</h2>
          <span className="text-xs text-slate-500">{teamsResult.data?.length ?? 0} teams</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {(teamsResult.data ?? []).map((entry) => (
            <Link key={entry.id} href={`/dashboard/teams/${entry.id}`} aria-current={entry.id === id ? "page" : undefined}
              className={`rounded-lg border px-3 py-2 text-sm transition ${entry.id === id ? "border-sky-300/40 bg-sky-300/15 text-sky-100" : "border-white/10 text-slate-300 hover:border-sky-300/30 hover:text-white"}`}>
              {entry.team_name}
            </Link>
          ))}
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        {[{ label: "Current balance", value: balance }, { label: "Total positive points", value: earned }, { label: "Auction spend", value: spent }].map((item) => (
          <section key={item.label} className="panel p-5"><p className="text-xs text-slate-400">{item.label}</p><p className="mt-2 text-2xl font-bold">{item.value.toLocaleString("en-IN")}</p></section>
        ))}
      </div>

      <section className="panel overflow-hidden">
        <div className="border-b border-white/10 px-5 py-4">
          <h2 className="font-semibold">Registration details & team members</h2>
          <p className="mt-1 text-xs text-slate-500">Imported from the official team registration spreadsheet.</p>
        </div>
        <div className="grid gap-4 border-b border-white/5 p-5 sm:grid-cols-2">
          <div><p className="text-xs text-slate-500">Registration email</p><p className="mt-1 break-all text-sm text-white">{team.registration_email || "Not provided"}</p></div>
          <div><p className="text-xs text-slate-500">Contact number</p><p className="mt-1 text-sm text-white">{team.contact_number || "Not provided"}</p></div>
          <div><p className="text-xs text-slate-500">Registration submitted</p><p className="mt-1 text-sm text-white">{team.registration_submitted_at ? new Date(team.registration_submitted_at).toLocaleString() : "—"}</p></div>
          <div><p className="text-xs text-slate-500">Registered members</p><p className="mt-1 text-sm text-white">{membersResult.data?.length ?? 0}</p></div>
        </div>
        {(membersResult.data ?? []).length === 0 ? (
          <p className="p-5 text-sm text-slate-500">No member records have been added for this team.</p>
        ) : (
          <div className="divide-y divide-white/5">
            {(membersResult.data ?? []).map((member) => (
              <div key={member.id} className="grid gap-1 px-5 py-4 sm:grid-cols-[2rem_1.5fr_1fr_1fr] sm:items-center sm:gap-3">
                <span className="text-xs text-slate-500">#{member.member_order}</span>
                <span className="text-sm font-medium text-white">{member.member_name}</span>
                <span className="font-mono text-xs text-sky-200">{member.usn}</span>
                <span className="text-xs text-slate-400">{member.department}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <ResetTeamPassword teamId={id} />

      {queryErrors.length > 0 && (
        <div role="alert" className="rounded-xl border border-amber-300/20 bg-amber-300/5 p-4 text-sm text-amber-200">
          Some activity records could not be loaded. Refresh the page; if the problem continues, check the Supabase connection and server logs.
        </div>
      )}

      <section className="panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div><h2 className="font-semibold">Complete activity history</h2><p className="mt-1 text-xs text-slate-500">Transactions, purchases and both types of spin records, newest first.</p></div>
          <span className="text-xs text-slate-400">{activity.length} records</span>
        </div>
        {activity.length === 0 ? <p className="p-6 text-sm text-slate-500">No activity has been recorded for this team yet.</p> : (
          <div className="divide-y divide-white/5">
            {activity.map((item) => (
              <article key={item.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><span className="rounded-md border border-sky-300/15 bg-sky-300/[.06] px-2 py-1 text-[10px] uppercase tracking-wider text-sky-200">{item.kind}</span><h3 className="text-sm font-medium text-white">{item.title}</h3></div>
                  <p className="mt-1 text-xs text-slate-500">{item.detail}{item.createdAt ? ` · ${new Date(item.createdAt).toLocaleString()}` : ""}</p>
                </div>
                {item.points !== null && <span className={`shrink-0 text-sm font-semibold tabular-nums ${item.points >= 0 ? "text-emerald-300" : "text-red-300"}`}>{item.points > 0 ? "+" : ""}{item.points.toLocaleString("en-IN")} pts</span>}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
