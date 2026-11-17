import { getUserCached } from "@/lib/supabase/cached-user";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/* ---------- per-team shuffle ----------
 * Question order and option order differ per team. Team #k (by stable order of ids) gets
 * section 1's question order = permutation (k mod n!) and its first question's options =
 * permutation (k / n! mod 4!), so up to 144 teams are guaranteed different papers; every
 * other section/question is shuffled from a hash of team + question for extra variety. */
const fact = (n: number): number => (n <= 1 ? 1 : n * fact(n - 1));
function nthPerm(n: number, k: number) {
  const pool = Array.from({ length: n }, (_, i) => i), out: number[] = [];
  k = ((k % fact(n)) + fact(n)) % fact(n);
  for (let i = n; i > 0; i--) { const f = fact(i - 1); out.push(pool.splice(Math.floor(k / f), 1)[0]); k %= f; }
  return out;
}
function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
async function teamOrdinal(db: ReturnType<typeof createAdminClient>, teamId: string) {
  const { data } = await db.from("teams").select("id").order("id");
  return Math.max(0, (data ?? []).findIndex(t => t.id === teamId));
}
async function firstSectionId(db: ReturnType<typeof createAdminClient>) {
  return (await db.from("quiz_sections").select("id").order("idx").limit(1)).data?.[0]?.id ?? null;
}
/** display order of questions in a section, and option permutation (display → original) per question */
function shuffleFor<T extends { id: string; options: unknown }>(teamId: string, k: number, sectionId: string, isFirst: boolean, qs: T[]) {
  const n = qs.length;
  const qOrder = isFirst ? nthPerm(n, k) : nthPerm(n, hash(teamId + sectionId));
  const ordered = qOrder.map(i => qs[i]);
  const optPerm = ordered.map((q, pos) => {
    const m = (q.options as unknown[]).length;
    return isFirst && pos === 0 ? nthPerm(m, Math.floor(k / fact(n))) : nthPerm(m, hash(teamId + q.id));
  });
  return { ordered, optPerm };
}

/**
 * Rapid Fire for a team. Never returns correct answers.
 * POST { action: "state" | "start" | "answer" | "submit" | "flag", section_id?, question_id?, choice?, kind? }
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await getUserCached(supabase as never);
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("team_id").eq("id", user.id).maybeSingle();
  const teamId = profile?.team_id as string | undefined;
  if (!teamId) return NextResponse.json({ error: "Only team accounts take Rapid Fire." }, { status: 403 });
  const db = createAdminClient();
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Bad request." }, { status: 400 }); }
  const fail = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s });
  const live = async () => (await db.from("team_stages").select("status").eq("team_id", teamId).eq("activity", "quiz").maybeSingle()).data?.status ?? "upcoming";

  try {
    const action = String(body.action ?? "state");
    if (action === "start") {
      if (await live() !== "live") return fail("Rapid Fire isn't open for your team.");
      const { error } = await db.rpc("quiz_start_section", { p_team: teamId, p_section: String(body.section_id) });
      if (error) return fail(error.message);
    } else if (action === "answer") {
      if (await live() !== "live") return fail("Rapid Fire is closed.");
      const qid = String(body.question_id);
      const { data: q } = await db.from("quiz_questions").select("id,section_id").eq("id", qid).maybeSingle();
      if (!q) return fail("Question not found");
      const { data: secQs } = await db.from("quiz_questions").select("id,idx,options").eq("section_id", q.section_id).order("idx");
      const k = await teamOrdinal(db, teamId);
      const { ordered, optPerm } = shuffleFor(teamId, k, q.section_id, (await firstSectionId(db)) === q.section_id, secQs ?? []);
      const pos = ordered.findIndex(x => x.id === qid);
      const original = optPerm[pos]?.[Number(body.choice)];
      if (original === undefined) return fail("Invalid option");
      const { error } = await db.rpc("quiz_answer", { p_team: teamId, p_question: qid, p_choice: original });
      if (error) return fail(error.message);
      return NextResponse.json({ ok: true });
    } else if (action === "submit") {
      const { error } = await db.rpc("quiz_submit_section", { p_team: teamId, p_section: String(body.section_id) });
      if (error) return fail(error.message);
    } else if (action === "flag") {
      await db.from("quiz_flags").insert({ team_id: teamId, kind: String(body.kind ?? "left_screen").slice(0, 40) });
      return NextResponse.json({ ok: true });
    }

    // ---- state ----
    await db.rpc("quiz_sweep", { p_team: teamId });
    const [st, secs, runs, flags] = await Promise.all([
      live(),
      db.from("quiz_sections").select("id,idx,title,time_limit_sec,points_per_correct").order("idx"),
      db.from("quiz_runs").select("section_id,started_at,ends_at,submitted_at,correct,points").eq("team_id", teamId),
      db.from("quiz_flags").select("id", { count: "exact", head: true }).eq("team_id", teamId),
    ]);
    const sections = secs.data ?? [];
    const runOf = (id: string) => (runs.data ?? []).find(r => r.section_id === id) ?? null;
    const { data: counts } = await db.from("quiz_questions").select("section_id");
    const active = sections.find(s => { const r = runOf(s.id); return r && !r.submitted_at; }) ?? null;
    let questions: { id: string; prompt: string; options: string[]; choice: number | null }[] = [];
    if (active) {
      const [{ data: qs }, { data: ans }] = await Promise.all([
        db.from("quiz_questions").select("id,idx,prompt,options").eq("section_id", active.id).order("idx"),
        db.from("quiz_answers").select("question_id,choice").eq("team_id", teamId),
      ]);
      const k = await teamOrdinal(db, teamId);
      const { ordered, optPerm } = shuffleFor(teamId, k, active.id, sections[0]?.id === active.id, qs ?? []);
      questions = ordered.map((q, pos) => {
        const perm = optPerm[pos], opts = q.options as string[];
        const saved = (ans ?? []).find(a => a.question_id === q.id)?.choice;
        return { id: q.id, prompt: String((q as unknown as { prompt: string }).prompt), options: perm.map(o => opts[o]), choice: saved === undefined || saved === null ? null : perm.indexOf(saved) };
      });
    }
    return NextResponse.json({
      status: st,
      team_id: teamId,
      now: new Date().toISOString(),
      flags: flags.count ?? 0,
      sections: sections.map(s => ({ ...s, questions: (counts ?? []).filter(c => c.section_id === s.id).length, run: runOf(s.id) })),
      active: active ? { id: active.id, ends_at: runOf(active.id)!.ends_at, questions } : null,
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Something went wrong.", 500);
  }
}
