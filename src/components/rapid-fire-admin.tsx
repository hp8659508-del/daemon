"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Pencil, Play, Square, RotateCcw, ShieldAlert, Check, Zap } from "lucide-react";
import type { World } from "@/lib/game";

type Cmd = { run: (p: Record<string, unknown>, o?: { quiet?: boolean }) => Promise<any>; busy: boolean; toast: (t: string, bad?: boolean) => void };
type Sec = { id: string; idx: number; title: string; time_limit_sec: number; points_per_correct: number };
type Q = { id: string; section_id: string; idx: number; prompt: string; options: string[]; correct: number };
type Run = { team_id: string; section_id: string; started_at: string; ends_at: string; submitted_at: string | null; correct: number | null; points: number | null };
type Flag = { team_id: string; kind: string; created_at: string };
type Data = { sections: Sec[]; questions: Q[]; runs: Run[]; flags: Flag[] };
const L = ["A", "B", "C", "D", "E", "F"];
const FLAG: Record<string, string> = { left_screen: "left the screen", lost_focus: "switched away", exited_fullscreen: "exited full screen", back_button: "pressed back" };

export default function RapidFireAdmin({ w, cmd, paddle, isHost }: { w: World; cmd: Cmd; paddle: Record<string, number>; isHost: boolean }) {
  const [d, setD] = useState<Data | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [editQ, setEditQ] = useState<Partial<Q> | null>(null);
  const [editS, setEditS] = useState<Partial<Sec> | null>(null);
  const [loadErr, setLoadErr] = useState("");
  // Read-only fetch: must NOT go through cmd.run (that refreshes every team screen).
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "quiz_admin" }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Server busy (${r.status})`);
      setD(j.data); setLoadErr("");
    } catch (e) { setLoadErr(e instanceof Error ? e.message : "Could not load"); }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 15000);
    return () => clearInterval(t);
  }, [load]);
  const act = async (p: Record<string, unknown>) => { if (await cmd.run(p)) load(); };
  const stage = (t: string) => (w.stages.find(s => s.team_id === t && s.activity === "quiz")?.status ?? "upcoming");
  const all = sel.size === w.teams.length && w.teams.length > 0;
  if (!d) return (
    <div className="panel flex flex-wrap items-center gap-3 p-6 text-sm text-muted">
      {loadErr ? <>Couldn&apos;t load Rapid Fire: <b className="text-err">{loadErr}</b><button className="key key-sm" onClick={load}>Retry</button></> : "Loading Rapid Fire…"}
    </div>
  );
  const total = (team: string) => d.runs.filter(r => r.team_id === team).reduce((a, r) => a + (r.points ?? 0), 0);

  return (
    <div className="space-y-5">
      {/* control */}
      <div className="panel overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-graphite p-4">
          <h2 className="font-display mr-auto flex items-center gap-2 text-xl font-black"><Zap size={18} className="text-[#FF9A5C]" /> Rapid Fire · Round 1</h2>
          <button className="key key-sm" onClick={() => setSel(all ? new Set() : new Set(w.teams.map(t => t.id)))}>{all ? "Clear selection" : `Select all (${w.teams.length})`}</button>
          <span className="text-xs text-muted"><b className="num text-graphite">{sel.size}</b> selected</span>
          <button className="key-primary key-sm" disabled={!sel.size || cmd.busy} onClick={() => act({ action: "stage", team_ids: [...sel], activity: "quiz", status: "live" })}><Play size={12} /> Open</button>
          <button className="key key-sm" disabled={!sel.size || cmd.busy} onClick={() => confirm(`Close Rapid Fire for ${sel.size} team(s)? Open sections are submitted as they are.`) && act({ action: "stage", team_ids: [...sel], activity: "quiz", status: "closed" })}><Square size={12} /> Close</button>
          <button className="key-danger key-sm" disabled={!sel.size || cmd.busy} onClick={() => confirm(`Wipe the Rapid Fire attempt of ${sel.size} team(s)? Their answers and Rapid Fire points are removed so they can retake it.`) && act({ action: "quiz_reset", team_ids: [...sel] })}><RotateCcw size={12} /> Reset attempt</button>
        </div>
        <div className="overflow-x-auto">
          <table className="ledger cards-table">
            <thead><tr><th></th><th>Team</th><th>Status</th>{d.sections.map(s => <th key={s.id}>{s.title}</th>)}<th>Points</th><th>Left screen</th></tr></thead>
            <tbody>
              {w.teams.map(t => {
                const flags = d.flags.filter(f => f.team_id === t.id);
                const st = stage(t.id);
                return (
                  <tr key={t.id} onClick={() => { const n = new Set(sel); n.has(t.id) ? n.delete(t.id) : n.add(t.id); setSel(n); }} className="cursor-pointer">
                    <td><span className={`grid h-4 w-4 place-items-center rounded border ${sel.has(t.id) ? "border-[#5136E0] bg-[#6B4BFF] text-white" : "border-silver bg-white"}`}>{sel.has(t.id) && <Check size={10} />}</span></td>
                    <td className="font-semibold"><span className="num mr-2 text-faint">{String(paddle[t.id] ?? "").padStart(2, "0")}</span>{t.team_name}</td>
                    <td><span className={`text-xs font-bold uppercase ${st === "live" ? "text-ok" : st === "closed" ? "text-muted" : "text-faint"}`}>{st === "live" ? "Open" : st}</span></td>
                    {d.sections.map(s => {
                      const r = d.runs.find(x => x.team_id === t.id && x.section_id === s.id);
                      const n = d.questions.filter(q => q.section_id === s.id).length;
                      return <td key={s.id} className="num text-sm">{!r ? <span className="text-faint">—</span> : r.submitted_at ? <><b>{r.correct}/{n}</b> <span className="text-ok">+{r.points}</span></> : <span className="text-[#5136E0]">in progress</span>}</td>;
                    })}
                    <td className="num font-bold">{total(t.id)}</td>
                    <td>{flags.length ? <span className="inline-flex items-center gap-1 text-xs font-bold text-err" title={flags.map(f => `${new Date(f.created_at).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })} ${FLAG[f.kind] ?? f.kind}`).join("\n")}><ShieldAlert size={13} /> {flags.length}×</span> : <span className="text-faint">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="border-t border-silver/60 px-4 py-3 text-xs text-muted">Tap rows to select teams. Points are added to a team the moment it submits a section (or its time runs out). Hover the “Left screen” count to see when.</p>
      </div>

      {/* content */}
      <div className="panel p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-lg font-bold">Sections & questions</h3>
          {isHost && <button className="key key-sm" onClick={() => setEditS({ idx: (d.sections.at(-1)?.idx ?? 0) + 1, title: "", time_limit_sec: 120, points_per_correct: 10 })}><Plus size={13} /> Section</button>}
        </div>
        <div className="space-y-5">
          {d.sections.map(s => (
            <div key={s.id} className="rounded-xl border border-silver/80 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <p className="font-display text-lg font-black">{s.title}</p>
                <span className="chip">{Math.floor(s.time_limit_sec / 60)}:{String(s.time_limit_sec % 60).padStart(2, "0")} min</span>
                <span className="chip">{s.points_per_correct} pts / correct</span>
                {isHost && <span className="ml-auto flex gap-1.5">
                  <button className="key key-sm" onClick={() => setEditS(s)}><Pencil size={12} /> Edit</button>
                  <button className="key key-sm" onClick={() => setEditQ({ section_id: s.id, idx: (d.questions.filter(q => q.section_id === s.id).at(-1)?.idx ?? 0) + 1, prompt: "", options: ["", "", "", ""], correct: 0 })}><Plus size={12} /> Question</button>
                  <button className="key key-sm" onClick={() => confirm(`Delete section "${s.title}" and its questions?`) && act({ action: "quiz_section_delete", id: s.id })}><Trash2 size={12} /></button>
                </span>}
              </div>
              <ol className="mt-3 space-y-2">
                {d.questions.filter(q => q.section_id === s.id).map((q, n) => (
                  <li key={q.id} className="flex gap-3 rounded-lg bg-[#F6F5FF] p-3">
                    <span className="num w-6 shrink-0 text-faint">{n + 1}.</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{q.prompt}</p>
                      <div className="mt-2 grid gap-1 sm:grid-cols-2">{q.options.map((o, k) => (
                        <p key={k} className={`rounded-md px-2 py-1 text-sm ${k === q.correct ? "bg-[#E3F7EC] font-semibold text-[#14804A]" : "text-muted"}`}>{L[k]}) {o}{k === q.correct && " ✓"}</p>))}</div>
                    </div>
                    {isHost && <div className="flex shrink-0 flex-col gap-1.5">
                      <button className="key key-sm" onClick={() => setEditQ(q)}><Pencil size={12} /></button>
                      <button className="key key-sm" onClick={() => confirm("Delete this question?") && act({ action: "quiz_question_delete", id: q.id })}><Trash2 size={12} /></button>
                    </div>}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-faint">Correct answers (green) are only shown here. Teams never receive them.</p>
      </div>

      {editS && <SectionEditor s={editS} close={() => setEditS(null)} save={async p => { if (await cmd.run({ action: "quiz_section_save", ...p })) { setEditS(null); load(); } }} />}
      {editQ && <QuestionEditor q={editQ} sections={d.sections} close={() => setEditQ(null)} save={async p => { if (await cmd.run({ action: "quiz_question_save", ...p })) { setEditQ(null); load(); } }} />}
    </div>
  );
}

function Shell({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#0E0B2B]/40 p-4 backdrop-blur-sm" onClick={close}>
      <div className="panel animate-rise max-h-[90vh] w-full max-w-xl overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between"><h3 className="font-display text-xl font-black">{title}</h3><button className="key key-sm" onClick={close}>✕</button></div>
        {children}
      </div>
    </div>
  );
}

function SectionEditor({ s, close, save }: { s: Partial<Sec>; close: () => void; save: (p: Record<string, unknown>) => void }) {
  const [f, setF] = useState({ title: s.title ?? "", min: String(Math.floor((s.time_limit_sec ?? 120) / 60)), sec: String((s.time_limit_sec ?? 120) % 60), pts: String(s.points_per_correct ?? 10), idx: String(s.idx ?? 1) });
  return (
    <Shell title={s.id ? "Edit section" : "New section"} close={close}>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); save({ id: s.id, title: f.title, time_limit_sec: Number(f.min) * 60 + Number(f.sec), points_per_correct: Number(f.pts), idx: Number(f.idx) }); }}>
        <label className="text-xs font-semibold text-muted sm:col-span-2">Name<input className="field mt-1.5" required value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="Easy" /></label>
        <label className="text-xs font-semibold text-muted">Time · minutes<input className="field num mt-1.5" type="number" min={0} value={f.min} onChange={e => setF({ ...f, min: e.target.value })} /></label>
        <label className="text-xs font-semibold text-muted">… and seconds<input className="field num mt-1.5" type="number" min={0} max={59} value={f.sec} onChange={e => setF({ ...f, sec: e.target.value })} /></label>
        <label className="text-xs font-semibold text-muted">Points per correct answer<input className="field num mt-1.5" type="number" value={f.pts} onChange={e => setF({ ...f, pts: e.target.value })} /></label>
        <label className="text-xs font-semibold text-muted">Order (1 = first)<input className="field num mt-1.5" type="number" min={0} value={f.idx} onChange={e => setF({ ...f, idx: e.target.value })} /></label>
        <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" className="key" onClick={close}>Cancel</button><button className="key-primary">Save section</button></div>
      </form>
    </Shell>
  );
}

function QuestionEditor({ q, sections, close, save }: { q: Partial<Q>; sections: Sec[]; close: () => void; save: (p: Record<string, unknown>) => void }) {
  const [prompt, setPrompt] = useState(q.prompt ?? "");
  const [opts, setOpts] = useState<string[]>(q.options?.length ? [...q.options] : ["", "", "", ""]);
  const [correct, setCorrect] = useState(q.correct ?? 0);
  const [section, setSection] = useState(q.section_id ?? sections[0]?.id ?? "");
  return (
    <Shell title={q.id ? "Edit question" : "New question"} close={close}>
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); save({ id: q.id, section_id: section, idx: q.idx ?? 0, prompt, options: opts, correct }); }}>
        <div><p className="mb-1.5 text-xs font-semibold text-muted">Section</p><div className="seg">{sections.map(s => <button key={s.id} type="button" data-on={section === s.id} onClick={() => setSection(s.id)}>{s.title}</button>)}</div></div>
        <label className="block text-xs font-semibold text-muted">Question<textarea className="field mt-1.5 min-h-[80px]" required value={prompt} onChange={e => setPrompt(e.target.value)} /></label>
        <div>
          <p className="mb-1.5 text-xs font-semibold text-muted">Options · tap the letter of the correct one</p>
          <div className="space-y-2">{opts.map((o, k) => (
            <div key={k} className="flex items-center gap-2">
              <button type="button" onClick={() => setCorrect(k)} className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg border-2 font-black ${correct === k ? "border-[#14804A] bg-[#14804A] text-white" : "border-graphite bg-white"}`}>{L[k]}</button>
              <input className="field" value={o} onChange={e => setOpts(opts.map((x, i) => (i === k ? e.target.value : x)))} placeholder={`Option ${L[k]}`} />
            </div>))}</div>
        </div>
        <div className="flex justify-end gap-2"><button type="button" className="key" onClick={close}>Cancel</button><button className="key-primary">Save question</button></div>
      </form>
    </Shell>
  );
}
