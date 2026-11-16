import { requireStaff } from "@/lib/staff";
import { buildEval, fmtIST } from "@/lib/eval-sheet";
import PrintButton from "./print-button";

export const dynamic = "force-dynamic";

/** Printable evaluation sheet: one block per team. Use the browser's Print → Save as PDF. */
export default async function EvalPage() {
  const staff = await requireStaff();
  const { teams, generated, venue } = await buildEval(staff);
  return (
    <div className="eval-sheet mx-auto max-w-4xl">
      <div className="no-print mb-5 flex items-center justify-between gap-3">
        <p className="text-sm text-muted">Print this page, or choose “Save as PDF” in the print dialog.</p>
        <PrintButton />
      </div>
      <header className="mb-6 border-b-2 border-graphite pb-3">
        <p className="eyebrow">MAD Club NHCE · Daemon Hour</p>
        <h1 className="font-display text-3xl font-black">Evaluation sheet</h1>
        <p className="text-sm text-muted">{venue} · {teams.length} teams · generated {fmtIST(generated)} IST</p>
      </header>
      {teams.map(t => (
        <section key={t.no + t.name} className="eval-team mb-6 border border-graphite p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-xl font-black">#{String(t.no).padStart(2, "0")} {t.name}</h2>
            <p className="text-sm">{t.venue} · <b className="num">{t.points}</b> pts · deadline <b className="num">{fmtIST(t.deadline) || "not set"}</b>{t.minutes ? ` (${t.minutes > 0 ? "+" : ""}${t.minutes} min)` : ""}</p>
          </div>
          <p className="mt-2 text-sm"><b>Problem statement:</b> {t.ps || <span className="text-faint">not logged</span>}{t.psFinal && <b> · final (swapped)</b>}</p>
          <table className="mt-3 w-full border-collapse text-sm">
            <thead><tr className="border-b border-graphite text-left text-[11px] uppercase tracking-wider text-muted"><th className="py-1 pr-2">Card</th><th className="pr-2">Type</th><th className="pr-2">When</th><th className="pr-2">Effect</th><th className="pr-2">Status</th><th className="pr-2">Paid</th><th>Check</th></tr></thead>
            <tbody>
              {t.cards.length === 0 && <tr><td colSpan={7} className="py-1 text-faint">No cards</td></tr>}
              {t.cards.map((c, i) => (
                <tr key={i} className="border-b border-silver align-top">
                  <td className="py-1 pr-2 font-semibold">{c.name}{c.via !== "Auction" && <span className="font-normal text-muted"> ({c.via})</span>}</td>
                  <td className="pr-2">{c.type}</td><td className="pr-2">{c.when}</td>
                  <td className="pr-2">{c.rule ? `${c.rule} · ` : ""}{c.detail || c.effect}</td>
                  <td className="pr-2">{c.status}</td><td className="num pr-2">{c.price ?? ""}</td><td>☐</td>
                </tr>
              ))}
            </tbody>
          </table>
          {t.penalties.length > 0 && (
            <div className="mt-3 text-sm"><b>Penalties</b>
              <ul className="list-disc pl-5">{t.penalties.map((p, i) => <li key={i}>{p.reason} · {[p.minutes ? `−${p.minutes} min` : "", p.points ? `−${p.points} pts` : ""].filter(Boolean).join(" ")} · {p.result} · {fmtIST(p.at)}</li>)}</ul>
            </div>
          )}
          <p className="mt-4 text-sm">Judge notes: ______________________________________________ Score: ________</p>
        </section>
      ))}
    </div>
  );
}
