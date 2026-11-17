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

(async () => {
  console.log(`Base ${BASE} · Supabase ${ref} · ${USERS} people · ramp ${RAMP_S}s · ${MINUTES} min · change wave every ${WAVE_S}s`);
  const sessions = args.teams ? await sessionsFromCsv(args.teams) : [];
  if (args.teams) console.log(`Signed in ${sessions.length} team account(s); every person is logged in as one of them.`);
  await Promise.all(Array.from({ length: USERS }, (_, i) => person(i, sessions.length ? sessions[i % sessions.length] : null)));
  report();
})();
