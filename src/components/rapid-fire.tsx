"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Zap, Lock, Maximize2, ShieldAlert, Timer, CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";

/**
 * RAPID FIRE — Round 1 MCQ quiz.
 * While a section is running the quiz takes over the whole screen:
 *  • full-screen request, no app tabs or header reachable
 *  • leaving (switching app/tab, minimising, exiting full screen) is recorded and shown to the host
 *  • Back button and reload are trapped with a warning
 * A web page can't physically stop someone pressing Home on a phone; it can hide everything
 * else, warn, and report it, which is what this does.
 */
type Run = { started_at: string; ends_at: string; submitted_at: string | null; correct: number | null; points: number | null };
type Section = { id: string; idx: number; title: string; time_limit_sec: number; points_per_correct: number; questions: number; run: Run | null };
type Q = { id: string; prompt: string; options: string[]; choice: number | null };
type State = { status: string; now: string; flags: number; sections: Section[]; active: { id: string; ends_at: string; questions: Q[] } | null };

const STRIKES = 3;
const LETTER = ["A", "B", "C", "D", "E", "F"];
const TONE = ["#6B4BFF", "#FF5F86", "#FF9A5C", "#3FD8FF"];

async function call(body: Record<string, unknown>) {
  const r = await fetch("/api/quiz", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Something went wrong");
  return j as State;
}

export default function RapidFire() {
  const [s, setS] = useState<State | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const skew = useRef(0);
  const load = useCallback(async (body: Record<string, unknown> = { action: "state" }) => {
    try { const j = await call(body); skew.current = new Date(j.now).getTime() - Date.now(); setS(j); setErr(""); }
    catch (e) { setErr(e instanceof Error ? e.message : "Error"); }
  }, []);
  useEffect(() => { load(); const t = setInterval(() => load(), 15000); return () => clearInterval(t); }, [load]);

  if (!s) return <div className="panel grid place-items-center p-16 text-sm text-muted">{err || "Loading Rapid Fire…"}</div>;
  if (s.active) return <QuizScreen key={s.active.id} s={s} skew={skew.current} reload={load} />;

  const next = s.sections.find(x => !x.run?.submitted_at) ?? null;
  const done = s.sections.filter(x => x.run?.submitted_at);
  const total = done.reduce((a, x) => a + (x.run?.points ?? 0), 0);
  const start = async () => {
    if (!next) return;
    setBusy(true);
    try { await document.documentElement.requestFullscreen?.({ navigationUI: "hide" } as FullscreenOptions); } catch {}
    await load({ action: "start", section_id: next.id });
    setBusy(false);
  };

  return (
    <section className="rf-hero">
      <div className="rf-glow" />
      <div className="relative grid gap-8 p-6 sm:p-10 lg:grid-cols-[1.2fr_1fr]">
        <div>
          <p className="rf-eyebrow"><Zap size={13} /> Round 1 · Workshop quiz</p>
          <h2 className="rf-title">RAPID<br />FIRE</h2>
          <p className="mt-4 max-w-md text-[15px] leading-7 text-[#B9B2E8]">
            {s.status !== "live" ? (s.status === "closed" ? "Rapid Fire is closed. Your score is final." : "Waiting for the host to open Rapid Fire.")
              : next ? "One section at a time, each with its own clock. Once you start, the quiz locks this screen until the section ends. Leaving the screen 3 times submits the section as it stands, and every exit is reported to the host."
              : "All sections done. Nice work."}
          </p>
          {s.status === "live" && next && (
            <button className="rf-start" disabled={busy} onClick={start}>
              <Maximize2 size={18} /> Start {next.title} · {fmt(next.time_limit_sec)}
            </button>
          )}
          {err && <p className="mt-3 text-sm text-[#FF8FA3]">{err}</p>}
          {s.flags > 0 && <p className="mt-4 flex items-center gap-2 text-xs text-[#FF8FA3]"><ShieldAlert size={14} /> Left the quiz screen {s.flags} time{s.flags > 1 ? "s" : ""} (reported)</p>}
        </div>
        <div className="space-y-3">
          {s.sections.map((x, i) => {
            const st = x.run?.submitted_at ? "done" : x.run ? "running" : next?.id === x.id ? "next" : "locked";
            return (
              <div key={x.id} className="rf-sec" data-st={st}>
                <span className="rf-sec-no">{String(i + 1).padStart(2, "0")}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-lg font-black tracking-wide text-white">{x.title}</p>
                  <p className="text-xs text-[#9A90D6]">{x.questions} questions · {fmt(x.time_limit_sec)} · {x.points_per_correct} pts each</p>
                </div>
                {st === "done" ? <span className="rf-score"><CheckCircle2 size={14} /> {x.run!.correct}/{x.questions} · +{x.run!.points}</span>
                  : st === "locked" ? <Lock size={16} className="text-[#5F5A8A]" /> : <span className="rf-next">{st === "next" ? "Up next" : "Running"}</span>}
              </div>
            );
          })}
          {done.length > 0 && <div className="rf-total"><span>Rapid Fire points</span><b className="num">+{total}</b></div>}
        </div>
      </div>
    </section>
  );
}

function cleanPrompt(text: string) {
  if (!text) return "";
  return text
    .replace(/â–¶/g, "▶")
    .replace(/âš¡/g, "⚡")
    .replace(/â€™/g, "'")
    .replace(/â€œ/g, '"')
    .replace(/â€/g, '"');
}

function QuizScreen({ s, skew, reload }: { s: State; skew: number; reload: (b?: Record<string, unknown>) => Promise<void> }) {
  const a = s.active!;
  const sec = s.sections.find(x => x.id === a.id)!;
  const [i, setI] = useState(() => Math.max(0, a.questions.findIndex(q => q.choice === null)));
  const [picks, setPicks] = useState<Record<string, number | null>>(() => Object.fromEntries(a.questions.map(q => [q.id, q.choice])));
  const [now, setNow] = useState(Date.now() + skew);
  const [warn, setWarn] = useState(false);
  const [strikes, setStrikes] = useState(0);
  const lastFlag = useRef(0);
  const [fs, setFs] = useState(true);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const ending = useRef(false);
  const detachListeners = useRef<() => void>(() => {});
  const end = new Date(a.ends_at).getTime();
  const left = Math.max(0, end - now);
  const total = sec.time_limit_sec * 1000;
  const q = a.questions[i];
  const answered = Object.values(picks).filter(v => v !== null && v !== undefined).length;

  const submit = useCallback(async () => {
    if (ending.current) return;
    ending.current = true;
    setSubmitting(true);
    setWarn(false);
    setConfirmSubmit(false);
    detachListeners.current();
    try { if (document.fullscreenElement) await document.exitFullscreen(); } catch {}
    await reload({ action: "submit", section_id: a.id });
  }, [a.id, reload]);

  useEffect(() => { const t = setInterval(() => setNow(Date.now() + skew), 250); return () => clearInterval(t); }, [skew]);
  useEffect(() => { if (left <= 0) submit(); }, [left, submit]);
  useEffect(() => { if (strikes >= STRIKES) submit(); }, [strikes, submit]);

  // lock-down: report leaving, trap back/reload, keep full screen
  useEffect(() => {
    const flag = (kind: string) => {
      if (ending.current) return;
      // blur + hidden + fullscreen-exit usually fire together for one exit: count it once
      const t = Date.now(); if (t - lastFlag.current < 1500) return; lastFlag.current = t;
      fetch("/api/quiz", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "flag", kind }), keepalive: true }).catch(() => null);
      setWarn(true); setStrikes(n => n + 1);
    };
    const vis = () => { if (ending.current) return; if (document.hidden) flag("left_screen"); };
    const blur = () => { if (ending.current) return; flag("lost_focus"); };
    const fsc = () => {
      if (ending.current) return;
      const on = !!document.fullscreenElement;
      setFs(on);
      if (!on) flag("exited_fullscreen");
    };
    const unload = (e: BeforeUnloadEvent) => { if (ending.current) return; e.preventDefault(); e.returnValue = ""; };
    const pop = () => { if (ending.current) return; history.pushState(null, "", location.href); flag("back_button"); };
    history.pushState(null, "", location.href);
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("blur", blur);
    document.addEventListener("fullscreenchange", fsc);
    window.addEventListener("beforeunload", unload);
    window.addEventListener("popstate", pop);
    const block = (e: Event) => e.preventDefault();
    document.addEventListener("contextmenu", block);
    document.addEventListener("copy", block);
    document.documentElement.classList.add("rf-locked");
    setFs(!!document.fullscreenElement || !document.documentElement.requestFullscreen);

    detachListeners.current = () => {
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("blur", blur);
      document.removeEventListener("fullscreenchange", fsc);
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener("popstate", pop);
      document.removeEventListener("contextmenu", block);
      document.removeEventListener("copy", block);
      document.documentElement.classList.remove("rf-locked");
    };

    return () => {
      detachListeners.current();
    };
  }, []);

  const pick = async (n: number) => {
    setPicks(p => ({ ...p, [q.id]: n }));
    try { await call({ action: "answer", question_id: q.id, choice: n }); }
    catch (e) { if (/Time is up|submitted/i.test(String(e))) submit(); }
    if (i < a.questions.length - 1) setTimeout(() => setI(x => Math.min(x + 1, a.questions.length - 1)), 260);
  };

  const pct = Math.max(0, Math.min(1, left / total));
  const hot = left < 15000;
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="rf-lock" role="dialog" aria-modal="true" aria-label="Rapid Fire">
      <div className="rf-glow" />
      <header className="rf-top">
        <div className="flex items-center gap-2"><Zap size={16} className="text-[#FFC46B]" /><b className="tracking-[.3em]">RAPID FIRE</b><span className="text-[#9A90D6]">· {sec.title}</span></div>
        <div className={`rf-timer ${hot ? "hot" : ""}`}><Timer size={16} /> <span className="num">{fmt(Math.ceil(left / 1000))}</span></div>
      </header>
      <div className="rf-bar"><span style={{ transform: `scaleX(${pct})` }} className={hot ? "hot" : ""} /></div>

      <main className="rf-body">
        <div className="rf-dots">{a.questions.map((x, n) => <button key={x.id} aria-label={`Question ${n + 1}`} data-on={n === i} data-done={picks[x.id] != null} onClick={() => setI(n)} />)}</div>
        <p className="rf-qno">Question {i + 1} <span>/ {a.questions.length}</span></p>
        <h2 key={q.id} className="rf-q">{cleanPrompt(q.prompt)}</h2>
        <div key={q.id + "o"} className="rf-opts">
          {q.options.map((o, n) => (
            <button key={n} className="rf-opt" data-on={picks[q.id] === n} style={{ "--tone": TONE[n % 4], animationDelay: `${n * 60}ms` } as React.CSSProperties} onClick={() => pick(n)}>
              <span className="rf-letter">{LETTER[n]}</span><span className="min-w-0 flex-1 text-left">{cleanPrompt(o)}</span>
            </button>
          ))}
        </div>
      </main>

      <footer className="rf-foot">
        <button className="rf-nav" disabled={i === 0 || submitting} onClick={() => setI(i - 1)}><ChevronLeft size={18} /> Prev</button>
        <span className="text-sm text-[#9A90D6]">{answered}/{a.questions.length} answered</span>
        {i < a.questions.length - 1
          ? <button className="rf-nav" disabled={submitting} onClick={() => setI(i + 1)}>Next <ChevronRight size={18} /></button>
          : <button className="rf-submit" disabled={submitting} onClick={() => setConfirmSubmit(true)}>{submitting ? "Submitting…" : "Submit section"}</button>}
      </footer>

      {confirmSubmit && !ending.current && (
        <div className="rf-warn" style={{ background: "rgba(14,11,43,.96)" }}>
          <CheckCircle2 size={40} className="text-[#3FD8FF]" />
          <p className="font-display mt-3 text-2xl font-black text-white">Submit section?</p>
          <p className="mt-2 max-w-xs text-sm text-[#B9B2E8]">
            {answered < a.questions.length
              ? `You answered ${answered} of ${a.questions.length} questions (${a.questions.length - answered} unanswered). Once submitted, answers for this section are locked.`
              : "Once submitted, your answers for this section are locked and points will be scored."}
          </p>
          <div className="mt-5 flex gap-3">
            <button className="rf-nav !border-[#B9B2E8]/40 !text-white" onClick={() => setConfirmSubmit(false)}>
              Keep reviewing
            </button>
            <button className="rf-submit !bg-[#3FD8FF] !text-[#0E0B2B]" onClick={() => { setConfirmSubmit(false); submit(); }}>
              Yes, submit
            </button>
          </div>
        </div>
      )}

      {(warn || !fs) && !ending.current && !confirmSubmit && (
        <div className="rf-warn">
          <ShieldAlert size={36} />
          <p className="font-display mt-3 text-2xl font-black">Stay on the quiz</p>
          <p className="mt-2 max-w-xs text-sm text-[#B9B2E8]">Leaving this screen was reported to the host and the clock kept running.</p>
          <p className="mt-3 rounded-full bg-[#FF4F6E]/15 px-4 py-1.5 text-sm font-bold text-[#FF8FA3]">Strike {Math.min(strikes, STRIKES)} of {STRIKES} · at {STRIKES} this section is submitted as it is</p>
          <button className="rf-start mt-5" onClick={async () => { setWarn(false); try { await document.documentElement.requestFullscreen?.(); } catch {} }}>Back to the quiz</button>
        </div>
      )}
    </div>,
    document.body
  );
}

function fmt(sec: number) { const m = Math.floor(sec / 60), x = sec % 60; return `${m}:${String(x).padStart(2, "0")}`; }
