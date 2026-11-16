import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Rapid Fire for a team. Never returns correct answers.
 * POST { action: "state" | "start" | "answer" | "submit" | "flag", section_id?, question_id?, choice?, kind? }
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
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
      const { error } = await db.rpc("quiz_answer", { p_team: teamId, p_question: String(body.question_id), p_choice: Number(body.choice) });
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
      questions = (qs ?? []).map(q => ({ id: q.id, prompt: q.prompt, options: q.options as string[], choice: (ans ?? []).find(a => a.question_id === q.id)?.choice ?? null }));
    }
    return NextResponse.json({
      status: st,
      now: new Date().toISOString(),
      flags: flags.count ?? 0,
      sections: sections.map(s => ({ ...s, questions: (counts ?? []).filter(c => c.section_id === s.id).length, run: runOf(s.id) })),
      active: active ? { id: active.id, ends_at: runOf(active.id)!.ends_at, questions } : null,
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Something went wrong.", 500);
  }
}
