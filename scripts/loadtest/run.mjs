#!/usr/bin/env node
/**
 * Daemon Hour load test — simulate N people on the site at once.
 * Needs only Node 18+ (no installs).
 *
 *   node scripts/loadtest/run.mjs \
 *     --base https://daemon-hour.vercel.app \
 *     --supabase https://xtwoofywhwuiokdbmsrf.supabase.co --anon <ANON_KEY> \
 *     --users 1000 --minutes 3 \
 *     --teams scripts/loadtest/teams.csv          # optional: username,password per line
 *
 * What each virtual person does (like a real phone on the event day):
 *   • opens the site (login page)
 *   • checks for changes every 5 s (the pulse, straight from Supabase), as the real app does
 *   • if --teams is given: is signed in as one of those teams and loads the team dashboard
 *   • every 30 s an "event-wide change" wave: every signed-in person reloads their
 *     dashboard within 6 s (the worst case: e.g. a sale everyone sees)
 * At the end: requests, errors by type, and response times (p50 / p95 / p99) per kind.
 * Start small (--users 50), then 200, 500, 1000. Stop with Ctrl+C any time (it prints the report).
 *
 * Other modes (add --mode …):
 *   login        --users 1000 --ramp 20         1000 sign-ins within 20 s (campus gate rush)
 *   propagation  --admin-email a@b --admin-pass … [--rounds 10]
 *                                               admin click → visible on screens, timed (net 0 points)
 *   quiz                                        every team in teams.csv starts, answers and submits
 *                                               a Rapid Fire section at the same instant
 */
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith("--") ? [...a, [x.slice(2), all[i + 1]?.startsWith("--") ? "1" : all[i + 1] ?? "1"]] : a), []));
const BASE = (args.base || "https://daemon-hour.vercel.app").replace(/\/$/, "");
const SB = (args.supabase || "").replace(/\/$/, "");
const ANON = args.anon || "";
const USERS = Number(args.users || 100);
const MINUTES = Number(args.minutes || 2);
const RAMP_S = Number(args.ramp || 60);
const WAVE_S = Number(args.wave || 30);
if (!SB || !ANON) { console.error("Pass --supabase <url> and --anon <anon key> (Supabase → Project Settings → API)."); process.exit(1); }

const stats = new Map(); // kind -> { n, err: Map, ms: [] }
function rec(kind, ms, ok, code) {
  let s = stats.get(kind); if (!s) stats.set(kind, (s = { n: 0, err: new Map(), ms: [] }));
  s.n++; s.ms.push(ms); if (!ok) s.err.set(code, (s.err.get(code) || 0) + 1);
}
async function hit(kind, url, init = {}, timeoutMs = 20000) {
  const t0 = performance.now(); const ac = new AbortController(); const to = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ac.signal, redirect: "manual" });
    await r.arrayBuffer().catch(() => null);
    const ok = r.status < 400 || r.status === 401;
    rec(kind, performance.now() - t0, ok, r.status);
    return r;
  } catch (e) { rec(kind, performance.now() - t0, false, e.name === "AbortError" ? "timeout" : "network"); return null; }
  finally { clearTimeout(to); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ref = new URL(SB).hostname.split(".")[0];

/* ---- sign in the team accounts once (shared by many virtual people, like teammates) ---- */
async function sessionsFromCsv(file) {
  const fs = await import("node:fs");
  const rows = fs.readFileSync(file, "utf8").split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith("#")).map(l => l.split(",").map(x => x.trim()));
  const out = [];
  for (const [user, pass] of rows) {
    const email = user.includes("@") ? user : `${user.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase()}@teams.daemonhour.invalid`;
    const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pass }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { console.warn(`  sign-in failed for ${user}: ${r.status} ${j.msg || j.error_description || ""}`); continue; }
    out.push({ user, cookie: authCookie(j) });
    await sleep(400); // be gentle with the Auth rate limit
  }
  return out;
}
// @supabase/ssr cookie format: sb-<ref>-auth-token = "base64-" + base64url(JSON session), chunked at 3180 chars
function authCookie(session) {
  const value = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  const name = `sb-${ref}-auth-token`;
  if (value.length <= 3180) return `${name}=${value}`;
  const parts = []; for (let i = 0; i * 3180 < value.length; i++) parts.push(`${name}.${i}=${value.slice(i * 3180, (i + 1) * 3180)}`);
  return parts.join("; ");
}

let stop = false; const endAt = Date.now() + MINUTES * 60000;
let wave = 0; const waveTimer = setInterval(() => { wave++; }, WAVE_S * 1000);

async function person(i, session) {
  await sleep((i / USERS) * RAMP_S * 1000);                      // ramp up
  if (stop) return;
  await hit("page /login", `${BASE}/login`);
  if (session) await hit("page /dashboard", `${BASE}/dashboard`, { headers: { cookie: session.cookie } });
  let seenWave = wave;
  while (!stop && Date.now() < endAt) {
    await hit("pulse (Supabase)", `${SB}/rest/v1/rpc/dh_pulse`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" }, body: "{}" });
    if (session && wave !== seenWave) {                           // event-wide change → reload within 6 s
      seenWave = wave; await sleep(Math.random() * 6000);
      await hit("page /dashboard", `${BASE}/dashboard`, { headers: { cookie: session.cookie, RSC: "1" } });
    }
    await sleep(5000 + Math.random() * 1500);
  }
}

function pct(a, p) { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; }
function report() {
  clearInterval(waveTimer);
  console.log(`\n================ RESULTS · ${USERS} people · ${MINUTES} min ================`);
  let bad = false;
  for (const [k, s] of stats) {
    const errs = [...s.err.values()].reduce((a, b) => a + b, 0);
    const rate = (100 * errs) / s.n;
    if (rate > 1 || pct(s.ms, 95) > 5000) bad = true;
    console.log(`\n${k}\n  requests: ${s.n}   errors: ${errs} (${rate.toFixed(2)}%)${errs ? "  → " + [...s.err].map(([c, n]) => `${c}×${n}`).join(", ") : ""}`);
    console.log(`  time ms  p50 ${pct(s.ms, 50).toFixed(0)}   p95 ${pct(s.ms, 95).toFixed(0)}   p99 ${pct(s.ms, 99).toFixed(0)}   max ${Math.max(...s.ms).toFixed(0)}`);
  }
  console.log(`\nVERDICT: ${bad ? "❌ NOT READY — errors above 1% or p95 above 5 s. Send this output to Claude." : "✅ READY for this many people."}\n`);
  process.exit(0);
}
process.on("SIGINT", () => { stop = true; report(); });

/* ======================= extra modes ======================= */
const MODE = args.mode || "watch";
const SBH = { apikey: ANON, "Content-Type": "application/json" };
async function signIn(user, pass) {
  const email = user.includes("@") ? user : `${user.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase()}@teams.daemonhour.invalid`;
  const t0 = performance.now();
  const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: SBH, body: JSON.stringify({ email, password: pass }) }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  rec("sign-in", performance.now() - t0, !!r && r.ok, r ? r.status : "network");
  return r && r.ok ? { user, cookie: authCookie(j) } : null;
}
async function api(kind, path, cookie, body) {
  const t0 = performance.now();
  const r = await fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify(body) }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  rec(kind, performance.now() - t0, !!r && r.ok, r ? r.status : "network");
  return { ok: !!r && r.ok, j };
}
async function pulse() {
  const r = await fetch(`${SB}/rest/v1/rpc/dh_pulse`, { method: "POST", headers: { ...SBH, Authorization: `Bearer ${ANON}` }, body: "{}" }).catch(() => null);
  return r && r.ok ? r.json() : null;
}
function readCsv(file) {
  return import("node:fs").then(fs => fs.readFileSync(file, "utf8").split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith("#")).map(l => l.split(",").map(x => x.trim())));
}

/* LOGIN STORM: everyone signs in within --ramp seconds (default 20) */
async function modeLogin() {
  const rows = await readCsv(args.teams);
  const ramp = Number(args.ramp || 20) * 1000;
  console.log(`Login storm: ${USERS} sign-ins over ${ramp / 1000}s, rotating ${rows.length} accounts`);
  // behaves exactly like the real login page: on "busy" (429/5xx) it waits and retries (same schedule as the app)
  const WAITS = [2000, 4000, 8000, 12000, 16000, 20000];
  await Promise.all(Array.from({ length: USERS }, async (_, i) => {
    await sleep(Math.random() * ramp);
    const [u, p] = rows[i % rows.length];
    const t0 = performance.now();
    for (let a = 0; ; a++) {
      const email = u.includes("@") ? u : `${u.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase()}@teams.daemonhour.invalid`;
      const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: SBH, body: JSON.stringify({ email, password: p }) }).catch(() => null);
      const status = r ? r.status : "network";
      if (r) await r.arrayBuffer().catch(() => null);
      rec("sign-in attempts (each try)", 0, !!r && r.ok, status);
      const busy = !r || r.status === 429 || r.status >= 500;
      if (!busy || a >= WAITS.length) { rec("people signed in (after the app's retries)", performance.now() - t0, !!r && r.ok, busy ? "gave up while busy" : status); break; }
      await sleep(WAITS[a] + Math.random() * 1500);
    }
  }));
}

/* PROPAGATION: how long until an admin change reaches team screens (run while a watch test runs in another terminal) */
async function modePropagation() {
  const admin = await signIn(args["admin-email"], args["admin-pass"]);
  const [[u, p]] = await readCsv(args.teams);
  const team = await signIn(u, p);
  if (!admin || !team) { console.error("Could not sign in admin or the first team."); return; }
  const st = await api("quiz state (to find team id)", "/api/quiz", team.cookie, { action: "state" });
  const tid = st.j.team_id; if (!tid) { console.error("Couldn't read the team id (is v13+ deployed?)"); return; }
  const rounds = Number(args.rounds || 10);
  console.log(`Propagation: ${rounds} × (admin gives ${u} +1, then −1). Measuring until the change reaches screens.`);
  for (let i = 0; i < rounds; i++) {
    for (const amount of [1, -1]) {
      const before = (await pulse())?.v?.[tid] ?? 0;
      const t0 = performance.now();
      await api("admin action", "/api/control", admin.cookie, { action: "grant", team_ids: [tid], amount, reason: "Load test (auto-reversed)" });
      const tAck = performance.now();
      let seen = false;
      while (performance.now() - t0 < 15000) { const pv = await pulse(); if ((pv?.v?.[tid] ?? 0) !== before) { seen = true; break; } await sleep(150); }
      rec("change visible to screens (admin click → pulse)", performance.now() - t0, seen, "not seen in 15s");
      // a real screen polls every ~5s and then reloads: worst case adds poll gap + reload
      const r0 = performance.now(); await hit("team reload after change", `${BASE}/dashboard`, { headers: { cookie: team.cookie, RSC: "1" } });
      rec("worst case on a phone (≈ +5s poll gap + reload)", (tAck - t0) + (performance.now() - tAck) + 5000 + (performance.now() - r0), seen, "x");
      await sleep(1500);
    }
  }
  console.log("Net points change for the team: 0 (each +1 was reversed).");
}

/* QUIZ RUSH: every team in the CSV starts the next Rapid Fire section and answers at the same moment */
async function modeQuiz() {
  const rows = await readCsv(args.teams);
  console.log(`Quiz rush: ${rows.length} teams start + answer + submit at once. ⚠ writes real quiz attempts for these TEST teams: reset them afterwards in Rapid Fire.`);
  const teams = (await Promise.all(rows.map(([u, p]) => signIn(u, p)))).filter(Boolean);
  await Promise.all(teams.map(async t => {
    const st = await api("quiz state", "/api/quiz", t.cookie, { action: "state" });
    if (st.j.status !== "live") { rec("quiz open for team", 0, false, "Rapid Fire not open for " + t.user); return; }
    const next = (st.j.sections || []).find(x => !x.run?.submitted_at);
    if (!next) { rec("quiz open for team", 0, false, "already finished: reset " + t.user); return; }
    const s2 = await api("quiz start section", "/api/quiz", t.cookie, { action: "start", section_id: next.id });
    const qs = s2.j.active?.questions || [];
    await Promise.all(qs.map(q => api("quiz answer", "/api/quiz", t.cookie, { action: "answer", question_id: q.id, choice: Math.floor(Math.random() * q.options.length) })));
    await api("quiz submit", "/api/quiz", t.cookie, { action: "submit", section_id: next.id });
  }));
}

(async () => {
  if (MODE !== "watch") {
    if (!args.teams) { console.error("--teams teams.csv is required for this mode"); process.exit(1); }
    if (MODE === "login") await modeLogin();
    else if (MODE === "propagation") await modePropagation();
    else if (MODE === "quiz") await modeQuiz();
    else { console.error("Unknown --mode (use watch | login | propagation | quiz)"); process.exit(1); }
    report(); return;
  }
  console.log(`Base ${BASE} · Supabase ${ref} · ${USERS} people · ramp ${RAMP_S}s · ${MINUTES} min · change wave every ${WAVE_S}s`);
  const sessions = args.teams ? await sessionsFromCsv(args.teams) : [];
  if (args.teams) console.log(`Signed in ${sessions.length} team account(s); every person is logged in as one of them.`);
  await Promise.all(Array.from({ length: USERS }, (_, i) => person(i, sessions.length ? sessions[i % sessions.length] : null)));
  report();
})();
