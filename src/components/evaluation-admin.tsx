"use client";

import { useMemo, useRef, useState } from "react";
import { Award, Eye, EyeOff, FileDown, Trash2, Upload, Check, ExternalLink } from "lucide-react";
import Picker from "@/components/picker";
import { createClient } from "@/lib/supabase/client";
import { CRITERIA, CRIT_MAX, EVAL_MAX, evalTotal, evalComplete, type EvalScore, type Criterion } from "@/lib/evaluation";
import type { World } from "@/lib/game";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cmd = { run: (p: Record<string, unknown>, o?: { quiet?: boolean }) => Promise<any>; busy: boolean; toast: (t: string, bad?: boolean) => void };
type Draft = Record<Criterion, string> & { remarks: string };
const LABELS = ["Participation", "Winner", "Runner-up", "Second runner-up", "Special mention"];

const toDraft = (e?: EvalScore | null): Draft => ({
  impact: e?.impact?.toString() ?? "", innovation: e?.innovation?.toString() ?? "",
  presentation: e?.presentation?.toString() ?? "", prototype: e?.prototype?.toString() ?? "", remarks: e?.remarks ?? "",
});
const bad = (v: string) => v !== "" && !(Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= CRIT_MAX);

export default function EvaluationAdmin({ w, cmd, paddle, isHost }: { w: World; cmd: Cmd; paddle: Record<string, number>; isHost: boolean }) {
  const s = w.settings;
  const cols = (s.eval_columns ?? CRITERIA.map(c => c.key)) as string[];
  const byTeam = useMemo(() => Object.fromEntries(w.evals.map(e => [e.team_id, e])), [w.evals]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [sort, setSort] = useState<"no" | "score">("no");
  const draftOf = (id: string) => drafts[id] ?? toDraft(byTeam[id]);
  const dirty = (id: string) => !!drafts[id] && JSON.stringify(drafts[id]) !== JSON.stringify(toDraft(byTeam[id]));
  const set = (id: string, k: keyof Draft, v: string) => setDrafts(d => ({ ...d, [id]: { ...draftOf(id), [k]: v } }));
  const draftTotal = (d: Draft) => CRITERIA.reduce((a, c) => a + (Number(d[c.key]) || 0), 0);

  const teams = [...w.teams].sort((a, b) => sort === "score"
    ? (evalTotal(byTeam[b.id]) ?? -1) - (evalTotal(byTeam[a.id]) ?? -1)
    : (paddle[a.id] ?? 999) - (paddle[b.id] ?? 999));
  const evaluated = w.teams.filter(t => evalComplete(byTeam[t.id])).length;
  const partial = w.teams.filter(t => byTeam[t.id] && !evalComplete(byTeam[t.id])).length;
  const changed = w.teams.filter(t => dirty(t.id));

  const save = async (id: string) => {
    const d = draftOf(id);
    if (CRITERIA.some(c => bad(d[c.key]))) { cmd.toast(`Marks must be whole numbers from 0 to ${CRIT_MAX}`, true); return false; }
    const ok = await cmd.run({ action: "eval_save", team_id: id, ...d }, { quiet: changed.length > 1 });
    if (ok) setDrafts(x => { const n = { ...x }; delete n[id]; return n; });
    return !!ok;
  };
  const saveAll = async () => { let n = 0; for (const t of changed) if (await save(t.id)) n++; cmd.toast(`Saved ${n} team(s)`); };

  const publish = async (on: boolean) => {
    if (changed.length) { cmd.toast("Save your changed rows first", true); return; }
    const msg = on
      ? `Publish evaluation to all teams?\n\n• ${evaluated} fully marked, ${partial} partly marked, ${w.teams.length - evaluated - partial} not marked.\n• Each team's total is ADDED to their main points (once — edits later update it).`
      : "Hide evaluation from teams?\n\nTheir evaluation scores are taken back out of main points until you publish again.";
    if (confirm(msg)) await cmd.run({ action: "eval_publish", on });
  };

  const exportCsv = () => {
    const q = (x: unknown) => `"${String(x ?? "").replace(/"/g, '""')}"`;
    const rows = [["No", "Team", ...CRITERIA.map(c => `${c.label} (/${CRIT_MAX})`), `Total (/${EVAL_MAX})`, "Remarks"].map(q).join(",")];
    for (const t of teams) { const e = byTeam[t.id]; rows.push([paddle[t.id] ?? "", t.team_name, ...CRITERIA.map(c => e?.[c.key] ?? ""), evalTotal(e) ?? "", e?.remarks ?? ""].map(q).join(",")); }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + rows.join("\n")], { type: "text/csv" }));
    a.download = "daemon_hour_evaluation.csv"; a.click();
  };

  return (
    <div className="space-y-6">
      {/* ---- what teams can see ---- */}
      <section className="panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Final round</p>
            <h2 className="font-display text-2xl">Evaluation · out of {EVAL_MAX}</h2>
            <p className="mt-1 text-sm text-muted">{CRITERIA.length} criteria × {CRIT_MAX} marks. <b className="num">{evaluated}</b>/{w.teams.length} fully marked{partial ? <> · <b className="num">{partial}</b> partly</> : null}.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${s.eval_published ? "bg-[#E3F4EA] text-ok" : "bg-[#F3F2F8] text-muted"}`}>{s.eval_published ? "PUBLISHED · in main points" : "HIDDEN from teams"}</span>
            {isHost && <button className="key key-sm" disabled={cmd.busy} onClick={() => publish(!s.eval_published)}>{s.eval_published ? <><EyeOff size={13} /> Hide scores</> : <><Eye size={13} /> Publish scores</>}</button>}
            <button className="key key-sm" onClick={exportCsv}><FileDown size={13} /> CSV</button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#ECEAF6] pt-4 text-sm">
          <span className="eyebrow mr-1">Teams see</span>
          {CRITERIA.map(c => {
            const on = cols.includes(c.key);
            return <button key={c.key} className="key key-sm" data-on={on} disabled={!isHost || cmd.busy} style={on ? undefined : { opacity: .55, textDecoration: "line-through" }}
              onClick={() => cmd.run({ action: "settings", eval_columns: on ? cols.filter(k => k !== c.key) : [...cols, c.key] })}>{on ? <Eye size={12} /> : <EyeOff size={12} />} {c.label}</button>;
          })}
          <button className="key key-sm" disabled={!isHost || cmd.busy} style={s.eval_show_remarks ? undefined : { opacity: .55, textDecoration: "line-through" }}
            onClick={() => cmd.run({ action: "settings", eval_show_remarks: !s.eval_show_remarks })}>{s.eval_show_remarks ? <Eye size={12} /> : <EyeOff size={12} />} Remarks</button>
          <span className="text-xs text-muted">· the total out of {EVAL_MAX} is always shown once published{cols.length === 0 ? " (only the total now)" : ""}</span>
        </div>
      </section>

      {/* ---- marks sheet ---- */}
      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 p-4">
          <div className="seg">{(["no", "score"] as const).map(k => <button key={k} data-on={sort === k} onClick={() => setSort(k)}>{k === "no" ? "By team no." : "By score"}</button>)}</div>
          <span className="flex-1" />
          {changed.length > 0 && <button className="key key-sm" disabled={cmd.busy} onClick={saveAll}><Check size={13} /> Save {changed.length} changed</button>}
        </div>
        <div className="overflow-x-auto">
          <table className="ledger w-full min-w-[920px] text-sm">
            <thead><tr>
              <th className="w-12">#</th><th>Team</th>
              {CRITERIA.map(c => <th key={c.key} className="w-24 text-center">{c.label}<span className="block text-[10px] text-faint">/ {CRIT_MAX}</span></th>)}
              <th className="w-24 text-center">Total<span className="block text-[10px] text-faint">/ {EVAL_MAX}</span></th>
              <th>Remarks</th><th className="w-20" />
            </tr></thead>
            <tbody>
              {teams.map(t => {
                const d = draftOf(t.id), dt = dirty(t.id), e = byTeam[t.id];
                return (
                  <tr key={t.id} style={dt ? { background: "#FFF8E8" } : undefined}>
                    <td className="num">{paddle[t.id] ?? "—"}</td>
                    <td className="font-semibold">{t.team_name}{!e && <span className="ml-2 text-[11px] font-normal text-faint">not marked</span>}</td>
                    {CRITERIA.map(c => (
                      <td key={c.key} className="text-center">
                        <input className="field num !w-16 !px-2 !py-1 text-center" inputMode="numeric" value={d[c.key]} placeholder="–"
                          style={bad(d[c.key]) ? { borderColor: "#B4442F", color: "#B4442F" } : undefined}
                          onChange={ev => set(t.id, c.key, ev.target.value.replace(/[^\d]/g, "").slice(0, 2))}
                          onKeyDown={ev => ev.key === "Enter" && save(t.id)} />
                      </td>
                    ))}
                    <td className="num text-center text-base font-bold">{Object.values(CRITERIA).some(c => d[c.key] !== "") ? draftTotal(d) : "—"}</td>
                    <td><input className="field !py-1 text-sm" value={d.remarks} placeholder="Optional" maxLength={600} onChange={ev => set(t.id, "remarks", ev.target.value)} onKeyDown={ev => ev.key === "Enter" && save(t.id)} /></td>
                    <td>{dt && <button className="key key-sm" disabled={cmd.busy} onClick={() => save(t.id)}>Save</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="border-t border-[#ECEAF6] p-3 text-xs text-muted">Enter saves a row. Clearing every box (and remarks) removes that team&apos;s marks. While published, any edit updates the team&apos;s main points straight away.</p>
      </section>

      <Winners w={w} cmd={cmd} paddle={paddle} isHost={isHost} />
      <Certificates w={w} cmd={cmd} paddle={paddle} isHost={isHost} />
    </div>
  );
}

/* ================= Certificates ================= */
type Pending = { key: string; file: File; team_id: string; label: string; member_name: string; status?: "up" | "done" | "err" };

/** "07_Ravi.pdf", "7 - AppVengers.pdf", "#7.pdf" → team #7; otherwise a team name found in the file name. */
function guessTeam(name: string, w: World, paddle: Record<string, number>) {
  const base = name.replace(/\.[^.]+$/, "");
  const m = base.match(/^\s*#?(\d{1,3})(?!\d)/);
  if (m) { const id = Object.keys(paddle).find(k => paddle[k] === Number(m[1])); if (id) return id; }
  const flat = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  const f = flat(base);
  return [...w.teams].sort((a, b) => b.team_name.length - a.team_name.length).find(t => flat(t.team_name).length > 2 && f.includes(flat(t.team_name)))?.id ?? "";
}
/** what's left of the file name after the team number / name → a member name guess */
function guessMember(name: string, teamName: string) {
  let b = name.replace(/\.[^.]+$/, "").replace(/^\s*#?\d{1,3}(?!\d)/, "");
  b = b.replace(new RegExp(teamName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "");
  b = b.replace(/certificate|cert|participation|winner|runner[- ]?up/gi, "").replace(/[_\-.]+/g, " ").trim();
  return b.length > 1 && b.length < 60 ? b.replace(/\b\w/g, ch => ch.toUpperCase()) : "";
}

function Certificates({ w, cmd, paddle, isHost }: { w: World; cmd: Cmd; paddle: Record<string, number>; isHost: boolean }) {
  const s = w.settings;
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [label, setLabel] = useState("Participation");
  const [busy, setBusy] = useState(false);
  const names = Object.fromEntries(w.teams.map(t => [t.id, t.team_name]));
  const teamOpts = [...w.teams].sort((a, b) => (paddle[a.id] ?? 999) - (paddle[b.id] ?? 999)).map(t => ({ value: t.id, label: `#${paddle[t.id] ?? "—"} ${t.team_name}` }));
  const withCerts = new Set(w.certificates.map(c => c.team_id));

  const add = (files: FileList | null) => {
    if (!files) return;
    const list = [...files].filter(f => {
      if (!/\.(pdf|png|jpe?g)$/i.test(f.name)) { cmd.toast(`${f.name}: only PDF, PNG or JPG`, true); return false; }
      if (f.size > 15 * 1024 * 1024) { cmd.toast(`${f.name}: bigger than 15 MB`, true); return false; }
      return true;
    }).map(f => { const team_id = guessTeam(f.name, w, paddle); return { key: `${f.name}-${f.size}-${Math.random()}`, file: f, team_id, label, member_name: team_id ? guessMember(f.name, names[team_id] ?? "") : "" }; });
    setPending(p => [...p, ...list]);
    if (input.current) input.current.value = "";
  };

  const uploadAll = async () => {
    const todo = pending.filter(p => p.status !== "done");
    if (todo.some(p => !p.team_id)) { cmd.toast("Pick a team for every file first", true); return; }
    setBusy(true);
    const sb = createClient();
    let ok = 0;
    for (const p of todo) {
      setPending(x => x.map(y => y.key === p.key ? { ...y, status: "up" } : y));
      try {
        const u = await cmd.run({ action: "cert_upload_url", team_id: p.team_id, file_name: p.file.name }, { quiet: true });
        if (!u?.token) throw new Error("no upload link");
        const { error } = await sb.storage.from("certificates").uploadToSignedUrl(u.path, u.token, p.file, { contentType: p.file.type || undefined });
        if (error) throw error;
        const r = await cmd.run({ action: "cert_add", team_id: p.team_id, path: u.path, file_name: p.file.name, label: p.label, member_name: p.member_name }, { quiet: true });
        if (!r) throw new Error("save failed");
        ok++;
        setPending(x => x.map(y => y.key === p.key ? { ...y, status: "done" } : y));
      } catch (e) {
        cmd.toast(`${p.file.name}: ${e instanceof Error ? e.message : "upload failed"}`, true);
        setPending(x => x.map(y => y.key === p.key ? { ...y, status: "err" } : y));
      }
    }
    setBusy(false);
    cmd.toast(`Uploaded ${ok} of ${todo.length}`);
    setPending(x => x.filter(y => y.status !== "done"));
  };

  const open = async (id: string) => {
    const r = await cmd.run({ action: "cert_link", id }, { quiet: true });
    if (r?.url) window.open(r.url, "_blank", "noopener");
  };

  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Certificates</p>
          <h2 className="font-display text-2xl">Upload · release when ready</h2>
          <p className="mt-1 text-sm text-muted"><b className="num">{w.certificates.length}</b> file(s) for <b className="num">{withCerts.size}</b>/{w.teams.length} teams. Files are private: teams can&apos;t view or download until you release them.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${s.certs_published ? "bg-[#E3F4EA] text-ok" : "bg-[#F3F2F8] text-muted"}`}>{s.certs_published ? "RELEASED to teams" : "HIDDEN from teams"}</span>
          {isHost && <button className="key key-sm" disabled={cmd.busy} onClick={() => confirm(s.certs_published ? "Hide certificates? Teams lose the download buttons straight away." : `Release certificates?\n\n${withCerts.size} of ${w.teams.length} teams have at least one file.`) && cmd.run({ action: "settings", certs_published: !s.certs_published })}>
            {s.certs_published ? <><EyeOff size={13} /> Hide</> : <><Eye size={13} /> Release</>}</button>}
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-dashed border-[#B9B5D3] p-4"
        onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); add(e.dataTransfer.files); }}>
        <div className="flex flex-wrap items-center gap-3">
          <Upload size={16} className="text-cobalt" />
          <p className="min-w-0 flex-1 text-sm">Drop PDFs / images here, or <button className="font-semibold text-cobalt underline" onClick={() => input.current?.click()}>choose files</button>. Name them by team number to auto-match, e.g. <code className="num">07_Ravi Kumar.pdf</code> or <code className="num">7 - Firewalls.pdf</code>.</p>
          <span className="text-xs text-muted">New files as</span>
          <div className="seg">{LABELS.slice(0, 3).map(l => <button key={l} data-on={label === l} onClick={() => setLabel(l)}>{l}</button>)}</div>
          <input ref={input} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" className="hidden" onChange={e => add(e.target.files)} />
        </div>
        {pending.length > 0 && (
          <div className="mt-4 space-y-2">
            {pending.map(p => (
              <div key={p.key} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-[180px] flex-1 truncate" title={p.file.name}>{p.status === "up" ? "⏳ " : p.status === "err" ? "⚠ " : ""}{p.file.name}</span>
                <Picker className="!w-56" value={p.team_id} options={teamOpts} placeholder="Which team?" onChange={v => setPending(x => x.map(y => y.key === p.key ? { ...y, team_id: v, member_name: y.member_name || guessMember(y.file.name, names[v] ?? "") } : y))} />
                <Picker className="!w-44" searchable={false} value={p.label} options={LABELS.map(l => ({ value: l, label: l }))} onChange={v => setPending(x => x.map(y => y.key === p.key ? { ...y, label: v } : y))} />
                <input className="field !w-44 !py-1.5" placeholder="Member (blank = team)" value={p.member_name} onChange={e => setPending(x => x.map(y => y.key === p.key ? { ...y, member_name: e.target.value } : y))} />
                <button className="key key-sm" title="Remove" onClick={() => setPending(x => x.filter(y => y.key !== p.key))}><Trash2 size={13} /></button>
              </div>
            ))}
            <div className="flex justify-end gap-2 pt-2">
              <button className="key key-sm" disabled={busy} onClick={() => setPending([])}>Clear</button>
              <button className="key key-sm" disabled={busy || !pending.length} onClick={uploadAll}><Upload size={13} /> {busy ? "Uploading…" : `Upload ${pending.length}`}</button>
            </div>
          </div>
        )}
      </div>

      {w.certificates.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="ledger w-full min-w-[760px] text-sm">
            <thead><tr><th className="w-12">#</th><th>Team</th><th>For</th><th>Type</th><th>File</th><th className="w-28" /></tr></thead>
            <tbody>
              {[...w.certificates].sort((a, b) => (paddle[a.team_id] ?? 999) - (paddle[b.team_id] ?? 999) || (a.member_name ?? "").localeCompare(b.member_name ?? "")).map(c => (
                <tr key={c.id}>
                  <td className="num">{paddle[c.team_id] ?? "—"}</td>
                  <td className="font-semibold">{names[c.team_id] ?? "—"}</td>
                  <td><input className="field !py-1 text-sm" defaultValue={c.member_name ?? ""} placeholder="Whole team" onBlur={e => e.target.value !== (c.member_name ?? "") && cmd.run({ action: "cert_update", id: c.id, team_id: c.team_id, member_name: e.target.value })} /></td>
                  <td><Picker className="!w-40" searchable={false} value={c.label} options={LABELS.map(l => ({ value: l, label: l }))} onChange={v => cmd.run({ action: "cert_update", id: c.id, team_id: c.team_id, label: v })} /></td>
                  <td className="max-w-[220px] truncate text-muted" title={c.file_name}>{c.file_name}</td>
                  <td className="whitespace-nowrap">
                    <button className="key key-sm mr-1" title="Open" onClick={() => open(c.id)}><ExternalLink size={13} /></button>
                    <button className="key key-sm" title="Delete" disabled={cmd.busy} onClick={() => confirm(`Delete ${c.file_name}?`) && cmd.run({ action: "cert_delete", id: c.id, team_id: c.team_id })}><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!s.certs_published && w.certificates.length > 0 && <p className="mt-3 flex items-center gap-2 text-xs text-muted"><Award size={13} /> Teams can&apos;t see any of these until you press Release.</p>}
    </section>
  );
}

/* ================= Winners: the celebration each podium team gets when it opens its screen ================= */
function Winners({ w, cmd, paddle, isHost }: { w: World; cmd: Cmd; paddle: Record<string, number>; isHost: boolean }) {
  const s = w.settings;
  const [pick, setPick] = useState({ first: s.winners?.first ?? "", second: s.winners?.second ?? "", third: s.winners?.third ?? "" });
  const opts = [{ value: "", label: "— none —" }, ...[...w.teams].sort((a, b) => (paddle[a.id] ?? 999) - (paddle[b.id] ?? 999)).map(t => ({ value: t.id, label: `#${paddle[t.id] ?? "—"} ${t.team_name}` }))];
  const name = (id: string) => w.teams.find(t => t.id === id)?.team_name ?? "—";
  const announce = (on: boolean) => {
    if (on && !pick.first) { cmd.toast("Pick the 1st place team", true); return; }
    const msg = on
      ? `Announce the winners?\n\n1st  ${name(pick.first)}\n2nd  ${pick.second ? name(pick.second) : "—"}\n3rd  ${pick.third ? name(pick.third) : "—"}\n\nEach of these teams gets a full-screen celebration every time it opens its dashboard. Other teams see nothing.`
      : "Hide the winners? The celebration stops showing on their screens.";
    if (confirm(msg)) cmd.run({ action: "winners", on, ...pick });
  };
  const rows = [["first", "1st · Champions", "#f5c542"], ["second", "2nd · Runners-up", "#b9c0d4"], ["third", "3rd · Third place", "#d08a52"]] as const;
  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Winners</p>
          <h2 className="font-display text-2xl">Celebration on the winners&apos; screens</h2>
          <p className="mt-1 text-sm text-muted">Full screen, fireworks from every corner. It plays each time a winning team opens or refreshes its dashboard, then fades away (12 s for 1st, 9 s for 2nd and 3rd).</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${s.winners_announced ? "bg-[#E3F4EA] text-ok" : "bg-[#F3F2F8] text-muted"}`}>{s.winners_announced ? "ANNOUNCED" : "NOT ANNOUNCED"}</span>
          {isHost && (s.winners_announced
            ? <button className="key key-sm" disabled={cmd.busy} onClick={() => announce(false)}><EyeOff size={13} /> Hide winners</button>
            : <button className="key key-sm" disabled={cmd.busy} onClick={() => announce(true)}><Award size={13} /> Announce winners</button>)}
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {rows.map(([k, label, col]) => (
          <div key={k} className="rounded-xl border border-[#ECEAF6] p-3">
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold"><span className="inline-block h-3 w-3 rounded-full" style={{ background: col }} />{label}</p>
            <Picker value={pick[k]} options={opts} placeholder="Pick a team" onChange={v => setPick(p => ({ ...p, [k]: v }))} />
          </div>
        ))}
      </div>
      {s.winners_announced && JSON.stringify(pick) !== JSON.stringify({ first: s.winners?.first ?? "", second: s.winners?.second ?? "", third: s.winners?.third ?? "" }) &&
        <p className="mt-3 text-xs text-ember">You changed the picks: press Hide, then Announce again to apply them.</p>}
    </section>
  );
}
