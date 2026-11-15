"use client";

import { useState } from "react";
import { Crown, Phone, Mail, Pencil, Trash2, Plus, Check, GraduationCap, IdCard } from "lucide-react";

export type MemberRow = { id: string; team_id: string; role: "lead" | "member"; full_name: string; usn: string | null; department: string | null; year: string | null; phone: string | null; email: string | null; college: string | null; checked_in: boolean };
type Run = (payload: Record<string, unknown>) => Promise<unknown>;

const BLANK = { full_name: "", role: "member", usn: "", department: "", year: "", phone: "", email: "" };

/** One tile per participant. Pass `run` to make it editable (organisers); omit for read-only (teams). */
export default function MemberTiles({ teamId, members, run, busy }: { teamId: string; members: MemberRow[]; run?: Run; busy?: boolean }) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const sorted = [...members].sort((a, b) => (a.role === b.role ? 0 : a.role === "lead" ? -1 : 1));
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {sorted.map(m => editing === m.id && run
        ? <MemberForm key={m.id} init={m} onCancel={() => setEditing(null)} onSave={async f => { if (await run({ action: "member_save", id: m.id, team_id: teamId, ...f })) setEditing(null); }} busy={busy} />
        : <Tile key={m.id} m={m} run={run} onEdit={() => setEditing(m.id)} />)}
      {run && (editing === "new"
        ? <MemberForm init={{ ...BLANK, role: members.some(m => m.role === "lead") ? "member" : "lead" }} onCancel={() => setEditing(null)} onSave={async f => { if (await run({ action: "member_save", team_id: teamId, ...f })) setEditing(null); }} busy={busy} />
        : <button onClick={() => setEditing("new")} className="grid min-h-[190px] place-items-center border-2 border-dashed border-graphite/40 bg-white/50 text-sm font-semibold text-muted transition hover:border-graphite hover:text-graphite">
            <span className="flex flex-col items-center gap-2"><Plus size={22} />Add {members.some(m => m.role === "lead") ? "teammate" : "team lead"}</span>
          </button>)}
      {!run && members.length === 0 && <p className="text-sm text-muted">No members on record yet. Ask an organiser to add your team.</p>}
    </div>
  );
}

function Tile({ m, run, onEdit }: { m: MemberRow; run?: Run; onEdit: () => void }) {
  const lead = m.role === "lead";
  const initials = m.full_name.split(/\s+/).map(x => x[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className={`panel relative flex flex-col p-4 ${lead ? "foil" : ""}`}>
      <div className="flex items-start gap-3">
        <div className={`grid h-12 w-12 shrink-0 place-items-center border border-graphite font-display text-lg ${lead ? "bg-graphite text-white" : "bg-white"}`}>{initials}</div>
        <div className="min-w-0 flex-1">
          <p className="eyebrow flex items-center gap-1">{lead ? <><Crown size={11} /> Team lead</> : "Teammate"}</p>
          <p className="truncate text-base font-bold">{m.full_name}</p>
        </div>
        {run && (
          <button title={m.checked_in ? "Checked in" : "Mark checked in"} onClick={() => run({ action: "member_checkin", id: m.id, checked_in: !m.checked_in })}
            className={`grid h-8 w-8 place-items-center border border-graphite ${m.checked_in ? "bg-ok text-white" : "bg-white text-faint"}`}><Check size={14} /></button>
        )}
        {!run && m.checked_in && <span className="chip"><Check size={10} /> in</span>}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <Field icon={IdCard} k="USN" v={m.usn} mono />
        <Field icon={GraduationCap} k="Dept" v={[m.department, m.year && `Yr ${m.year}`].filter(Boolean).join(" · ") || null} />
        <Field icon={Phone} k="Phone" v={m.phone} href={m.phone ? `tel:${m.phone}` : undefined} mono />
        <Field icon={Mail} k="Email" v={m.email} href={m.email ? `mailto:${m.email}` : undefined} />
      </dl>
      {run && (
        <div className="mt-4 flex gap-2 border-t border-silver/30 pt-3">
          <button className="key key-sm flex-1" onClick={onEdit}><Pencil size={11} /> Edit</button>
          <button className="key key-sm" title="Remove" onClick={() => confirm(`Remove ${m.full_name} from the team?`) && run({ action: "member_delete", id: m.id })}><Trash2 size={11} /></button>
        </div>
      )}
    </div>
  );
}

function Field({ icon: Icon, k, v, href, mono }: { icon: typeof Phone; k: string; v: string | null; href?: string; mono?: boolean }) {
  const val = v || "—";
  return (
    <div className="well min-w-0 px-2.5 py-2">
      <dt className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[.16em] text-muted"><Icon size={10} />{k}</dt>
      <dd className={`mt-0.5 truncate font-semibold ${mono ? "num" : ""}`}>{href && v ? <a className="underline-offset-2 hover:underline" href={href}>{val}</a> : val}</dd>
    </div>
  );
}

function MemberForm({ init, onSave, onCancel, busy }: { init: Partial<MemberRow> & { role?: string }; onSave: (f: typeof BLANK) => void; onCancel: () => void; busy?: boolean }) {
  const [f, setF] = useState({ ...BLANK, ...Object.fromEntries(Object.entries(init).map(([k, v]) => [k, v ?? ""])) } as typeof BLANK);
  const up = (k: keyof typeof BLANK) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="panel space-y-2 p-4" onSubmit={e => { e.preventDefault(); onSave(f); }}>
      <div className="grid grid-cols-[1fr_110px] gap-2">
        <input className="field" required autoFocus placeholder="Full name" value={f.full_name} onChange={up("full_name")} />
        <select className="field" value={f.role} onChange={up("role")}><option value="lead">Team lead</option><option value="member">Teammate</option></select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input className="field num uppercase" placeholder="USN" value={f.usn} onChange={up("usn")} />
        <input className="field" placeholder="Department" value={f.department} onChange={up("department")} />
        <input className="field" placeholder="Year" value={f.year} onChange={up("year")} />
        <input className="field num" placeholder="Phone" value={f.phone} onChange={up("phone")} />
      </div>
      <input className="field" type="email" placeholder="Email" value={f.email} onChange={up("email")} />
      <div className="flex gap-2 pt-1"><button type="button" className="key key-sm flex-1" onClick={onCancel}>Cancel</button><button className="key-primary key-sm flex-1" disabled={busy}>Save</button></div>
    </form>
  );
}
