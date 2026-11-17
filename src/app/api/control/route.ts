import { getUserCached } from "@/lib/supabase/cached-user";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { minutesFor, projectedEnd, type TeamPowerup } from "@/lib/game";

/**
 * Single admin command endpoint. Every action is authorised as admin first,
 * then executed with the service role so RLS stays closed to participants.
 */
const int = (v: unknown, min = -1_000_000, max = 1_000_000) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error("Enter a whole number.");
  return n;
};
const str = (v: unknown, max = 200) => {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s || s.length > max) throw new Error("A required text field is missing.");
  return s;
};
const ids = (v: unknown) => {
  if (!Array.isArray(v) || !v.length || !v.every(x => typeof x === "string")) throw new Error("Select at least one team.");
  return v as string[];
};
const ACTS = ["auction", "spin", "bingo"];

export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await getUserCached(supabase as never);
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role, venue").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Admin only." }, { status: 403 });
  const myVenue: string | null = profile.venue ?? null;   // null = host, sees every venue
  const isHost = !myVenue;

  const db = createAdminClient();
  type LogRow = { team_id: string | null; kind: string; action: string; label: string; points?: number | null; minutes?: number | null };
  const log = async (rows: LogRow | LogRow[]) => {
    const list = (Array.isArray(rows) ? rows : [rows]).map(r => ({ ...r, actor: user.id }));
    if (list.length) await db.from("activity_log").insert(list); // best-effort audit trail
  };
  let body: Record<string, any>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Bad request." }, { status: 400 }); }

  try {
    const fail = (e: { message: string } | null) => { if (e) throw new Error(e.message); };
    /** Round gate: a team can only be sold to / spun / stamped while that round is LIVE for it. */
    const requireLive = async (teamId: string, activity: "auction" | "spin" | "bingo") => {
      const { data: st } = await db.from("team_stages").select("status").eq("team_id", teamId).eq("activity", activity).maybeSingle();
      if (st?.status !== "live") {
        const { data: t } = await db.from("teams").select("team_name").eq("id", teamId).maybeSingle();
        throw new Error(`${t?.team_name ?? "This team"}'s ${activity} round is ${st?.status ?? "not open"}. Open it under Rounds first.`);
      }
    };

    /* ---------- permission + venue scope, checked once for every action ---------- */
    const HOST_ONLY = ["clock", "bay", "staff_list", "staff_save", "staff_delete", "team_move", "powerup_save", "cell_save"];
    if (!isHost && HOST_ONLY.includes(body.action)) throw new Error("Only a host can do this.");
    if (!isHost && body.action === "settings") throw new Error("Only a host can change event settings.");
    if (!isHost) {
      const touched = new Set<string>();
      if (Array.isArray(body.team_ids)) body.team_ids.forEach((x: unknown) => typeof x === "string" && touched.add(x));
      if (typeof body.team_id === "string") touched.add(body.team_id);
      if (typeof body.target_id === "string") touched.add(body.target_id);
      const byRow: Record<string, [string, string]> = { undo_tx: ["transactions", "team_id"], undo_sale: ["purchases", "team_id"], trump_resolve: ["team_cards", "team_id"], spin_revoke: ["team_cards", "team_id"], card_remove: ["team_cards", "team_id"], card_unuse: ["team_cards", "team_id"], penalty_remove: ["penalties", "team_id"], ps_swap: ["team_cards", "team_id"], powerup_used: ["team_powerups", "team_id"], revoke: ["team_powerups", "team_id"] };
      if (byRow[body.action] && typeof body.id === "string") {
        const [table, col] = byRow[body.action];
        const { data: row } = await (db as any).from(table).select(col).eq("id", body.id).maybeSingle();
        if (row) touched.add((row as Record<string, string>)[col]);
      }
      if (touched.size) {
        const { data: rows } = await db.from("teams").select("id,bay").in("id", [...touched]);
        if ((rows ?? []).length !== touched.size || (rows ?? []).some(r => r.bay !== myVenue))
          throw new Error(`You can only act on ${myVenue} teams.`);
      }
    }

    switch (body.action) {
      /* ---------------- system check ---------------- */
      case "health": {
        const out: { item: string; status: string }[] = [];
        const { data: h, error: he } = await db.rpc("daemon_health");
        if (he) out.push({ item: "health function", status: "MISSING: run supabase/ALL_IN_ONE.sql" });
        else out.push(...((h ?? []) as { item: string; status: string }[]));
        // probe the exact column sets the app reads
        const probes: [string, string][] = [
          ["teams", "id,team_name,username,bay,paddle"], ["team_stages", "team_id,activity,status,closing_points,closing_end_at"],
          ["auction_items", "id,item_name,min_price,max_price,price_step,quantity,powerup_id"], ["team_powerups", "id,team_id,name,minutes_delta,target_team_id,source,used,purchase_id"],
          ["team_bingo", "team_id,idx,marked_at,marked_by"], ["bingo_cells", "idx,label,points,is_free"], ["team_members", "id,team_id,role,full_name,usn,department,year,phone,email,checked_in"],
          ["activity_log", "id,team_id,kind,action,label,points,minutes"], ["help_requests", "id,team_id,message,status"], ["team_secrets", "team_id,password,source"],
          ["event_settings", "live_lots,broadcasts,hackathon_end_at,clock_paused_at,bingo_rewards,portal_locked,starting_points"],
        ];
        for (const [t, cols] of probes) {
          const { error } = await db.from(t).select(cols).limit(1);
          out.push({ item: `columns ${t}`, status: error ? `ERROR: ${error.message}` : "OK" });
        }
        const t0 = Date.now(); await db.rpc("team_balances"); out.push({ item: "database round-trip", status: `${Date.now() - t0} ms` });
        return NextResponse.json({ ok: true, data: out });
      }

      /* ---------------- per-venue live lot + banner ---------------- */
      case "live_lot": {
        const key = isHost ? (typeof body.venue === "string" && body.venue ? body.venue : "all") : myVenue!;
        const { data: st } = await db.from("event_settings").select("live_lots").eq("id", true).maybeSingle();
        const lots = { ...(st?.live_lots ?? {}) } as Record<string, unknown>;
        lots[key] = body.lot ? { item_id: str(body.lot.item_id), price: int(body.lot.price, 0) } : null;
        fail((await db.from("event_settings").update({ live_lots: lots }).eq("id", true)).error);
        return NextResponse.json({ ok: true, message: body.lot ? "Lot on screens" : "Lot cleared" });
      }
      case "broadcast": {
        const key = isHost ? (typeof body.venue === "string" && body.venue ? body.venue : "all") : myVenue!;
        const { data: st } = await db.from("event_settings").select("broadcasts").eq("id", true).maybeSingle();
        const b = { ...(st?.broadcasts ?? {}) } as Record<string, string>;
        const text = typeof body.text === "string" ? body.text.trim().slice(0, 200) : "";
        if (text) b[key] = text; else delete b[key];
        fail((await db.from("event_settings").update({ broadcasts: b, ...(key === "all" ? { broadcast: null } : {}) }).eq("id", true)).error);
        return NextResponse.json({ ok: true, message: text ? `Banner sent to ${key === "all" ? "everyone" : key}` : "Banner cleared" });
      }

      /* ---------------- teams: create / rename / move / password / delete ---------------- */
      case "team_create": {
        const name = str(body.team_name, 80);
        const username = name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
        if (!username) throw new Error("Team name needs letters or numbers.");
        const password = typeof body.password === "string" && body.password.length >= 6 ? body.password : `${username}_123`;
        const bay = isHost ? (body.bay || null) : myVenue;
        const { data: maxP } = await db.from("teams").select("paddle").order("paddle", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
        const { data: team, error: te } = await db.from("teams").insert({ team_name: name, username, bay, paddle: (maxP?.paddle ?? 0) + 1 }).select("id").single();
        if (te) throw new Error(te.code === "23505" ? "A team with this name already exists." : te.message);
        const { data: au, error: ae } = await db.auth.admin.createUser({ email: `${username.toLowerCase()}@teams.daemonhour.invalid`, password, email_confirm: true, user_metadata: { team_name: name, team_username: username } });
        if (ae || !au?.user) { await db.from("teams").delete().eq("id", team.id); throw new Error(ae?.message ?? "Could not create login."); }
        const pe = (await db.from("profiles").insert({ id: au.user.id, team_id: team.id, role: "team", must_change_password: Boolean(body.force_change) })).error;
        if (pe) { await db.auth.admin.deleteUser(au.user.id); await db.from("teams").delete().eq("id", team.id); throw new Error(pe.message); }
        const { data: es } = await db.from("event_settings").select("starting_points,starting_points_published").eq("id", true).maybeSingle();
        if (es?.starting_points_published && Number(es.starting_points)) await db.from("transactions").insert({ team_id: team.id, description: "Initial event points", points: Number(es.starting_points), transaction_type: "bonus", created_by: user.id });
        await db.from("team_secrets").upsert({ team_id: team.id, password, source: "organiser", updated_at: new Date().toISOString() });
        await log({ team_id: team.id, kind: "team", action: "created", label: `Team created in ${bay ?? "no venue"}` });
        return NextResponse.json({ ok: true, message: `${name} created · login ${username} / ${password}` });
      }
      case "team_rename": {
        const id = str(body.team_id); const name = str(body.team_name, 80);
        const { error } = await db.from("teams").update({ team_name: name }).eq("id", id);
        if (error) throw new Error(error.code === "23505" ? "That name is taken." : error.message);
        await log({ team_id: id, kind: "team", action: "renamed", label: `Renamed to ${name} (login unchanged)` });
        return NextResponse.json({ ok: true, message: "Renamed. The login username stays the same." });
      }
      case "team_move": {
        const teamIds = ids(body.team_ids);
        const bay = typeof body.bay === "string" && body.bay ? body.bay.slice(0, 40) : null;
        fail((await db.from("teams").update({ bay }).in("id", teamIds)).error);
        await log(teamIds.map(team_id => ({ team_id, kind: "team", action: "moved", label: `Moved to ${bay ?? "unassigned"}` })));
        return NextResponse.json({ ok: true, message: `${teamIds.length} team(s) → ${bay ?? "unassigned"}` });
      }
      case "team_password": {
        const id = str(body.team_id);
        const { data: t } = await db.from("teams").select("username").eq("id", id).single();
        const password = typeof body.password === "string" && body.password.length >= 6 ? body.password : `${t?.username}_123`;
        const { data: prof } = await db.from("profiles").select("id").eq("team_id", id).eq("role", "team").maybeSingle();
        if (!prof) throw new Error("This team has no login account.");
        const { error } = await db.auth.admin.updateUserById(prof.id, { password });
        fail(error);
        await db.from("profiles").update({ must_change_password: false }).eq("id", prof.id);
        await db.from("team_secrets").upsert({ team_id: id, password, source: "organiser", updated_at: new Date().toISOString() });
        try { await (db.from("teams") as any).update({ password_changed_at: null }).eq("id", id); } catch {}
        await log({ team_id: id, kind: "team", action: "password", label: "Password reset by organiser" });
        return NextResponse.json({ ok: true, message: `Password set to ${password}` });
      }
      case "team_delete": {
        const teamIds = ids(body.team_ids);
        if (String(body.pin ?? "") !== (process.env.ADMIN_DELETE_PIN || "123")) throw new Error("Wrong delete password.");
        const { data: profs } = await db.from("profiles").select("id").in("team_id", teamIds);
        // children first: anything that may not cascade
        await db.from("team_powerups").update({ target_team_id: null }).in("target_team_id", teamIds);
        for (const t of ["team_powerups", "team_bingo", "team_stages", "purchases", "transactions", "activity_log", "team_members", "team_secrets", "help_requests", "team_spins", "manual_spin_records"]) {
          const { error } = await db.from(t).delete().in("team_id", teamIds);
          if (error && !/does not exist|schema cache/i.test(error.message)) throw new Error(`Could not clear ${t}: ${error.message}`);
        }
        await db.from("profiles").delete().in("team_id", teamIds);
        for (const p of profs ?? []) await db.auth.admin.deleteUser(p.id);
        fail((await db.from("teams").delete().in("id", teamIds)).error);
        await log({ team_id: null, kind: "team", action: "deleted", label: `Deleted ${teamIds.length} team(s)` });
        return NextResponse.json({ ok: true, message: `Deleted ${teamIds.length} team(s) and their logins` });
      }

      /* ---------------- passwords, members, help desk ---------------- */
      case "secrets": {
        let q = db.from("team_secrets").select("team_id,password,source,updated_at");
        if (!isHost) { const { data: ts } = await db.from("teams").select("id").eq("bay", myVenue!); q = q.in("team_id", (ts ?? []).map(t => t.id)); }
        const { data, error } = await q; fail(error);
        return NextResponse.json({ ok: true, data });
      }
      case "member_save": {
        const teamId = str(body.team_id);
        const clean = (v: unknown, n = 80) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
        const row = { team_id: teamId, role: body.role === "lead" ? "lead" : "member", full_name: str(body.full_name, 80), usn: clean(body.usn, 20)?.toUpperCase() ?? null, department: clean(body.department, 60), year: clean(body.year, 10), phone: clean(body.phone, 20), email: clean(body.email, 120), college: clean(body.college, 80) };
        if (row.role === "lead") await db.from("team_members").update({ role: "member" }).eq("team_id", teamId).eq("role", "lead").neq("id", body.id ?? "00000000-0000-0000-0000-000000000000");
        const q = body.id ? db.from("team_members").update(row).eq("id", body.id).eq("team_id", teamId) : db.from("team_members").insert(row);
        fail((await q).error);
        await log({ team_id: teamId, kind: "team", action: body.id ? "member_updated" : "member_added", label: `${row.role === "lead" ? "Lead" : "Member"}: ${row.full_name}` });
        return NextResponse.json({ ok: true, message: body.id ? "Member updated" : "Member added" });
      }
      case "member_delete": {
        const { data: m } = await db.from("team_members").select("team_id,full_name").eq("id", str(body.id)).maybeSingle();
        if (!m) throw new Error("Member not found.");
        if (!isHost) { const { data: t } = await db.from("teams").select("bay").eq("id", m.team_id).maybeSingle(); if (t?.bay !== myVenue) throw new Error(`You can only act on ${myVenue} teams.`); }
        fail((await db.from("team_members").delete().eq("id", str(body.id))).error);
        await log({ team_id: m.team_id, kind: "team", action: "member_removed", label: m.full_name });
        return NextResponse.json({ ok: true, message: "Member removed" });
      }
      case "member_checkin": {
        const { data: m } = await db.from("team_members").select("team_id").eq("id", str(body.id)).maybeSingle();
        if (!m) throw new Error("Member not found.");
        if (!isHost) { const { data: t } = await db.from("teams").select("bay").eq("id", m.team_id).maybeSingle(); if (t?.bay !== myVenue) throw new Error(`You can only act on ${myVenue} teams.`); }
        fail((await db.from("team_members").update({ checked_in: Boolean(body.checked_in) }).eq("id", str(body.id))).error);
        return NextResponse.json({ ok: true, message: body.checked_in ? "Checked in" : "Check-in undone" });
      }
      case "members_import": {
        // rows: [{ team, role, full_name, usn, department, year, phone, email }]
        if (!Array.isArray(body.rows) || !body.rows.length) throw new Error("Nothing to import.");
        const { data: teams } = await db.from("teams").select("id,team_name,username,bay");
        const find = (n: string) => (teams ?? []).find(t => t.team_name.toLowerCase().trim() === n.toLowerCase().trim() || t.username.toLowerCase() === n.toLowerCase().trim());
        const rows: Record<string, unknown>[] = []; const missing = new Set<string>();
        for (const r of body.rows.slice(0, 1000)) {
          const t = find(String(r.team ?? ""));
          if (!t) { missing.add(String(r.team ?? "?")); continue; }
          if (!isHost && t.bay !== myVenue) { missing.add(`${t.team_name} (other venue)`); continue; }
          if (!String(r.full_name ?? "").trim()) continue;
          rows.push({ team_id: t.id, role: /lead/i.test(String(r.role ?? "")) ? "lead" : "member", full_name: String(r.full_name).trim().slice(0, 80), usn: String(r.usn ?? "").trim().toUpperCase().slice(0, 20) || null, department: String(r.department ?? "").trim().slice(0, 60) || null, year: String(r.year ?? "").trim().slice(0, 10) || null, phone: String(r.phone ?? "").trim().slice(0, 20) || null, email: String(r.email ?? "").trim().slice(0, 120) || null });
        }
        if (body.replace) await db.from("team_members").delete().in("team_id", [...new Set(rows.map(r => r.team_id as string))]);
        // only one lead per team: keep the first
        const seen = new Set<string>();
        rows.forEach(r => { if (r.role === "lead") { if (seen.has(r.team_id as string)) r.role = "member"; seen.add(r.team_id as string); } });
        if (!body.replace && seen.size) await db.from("team_members").update({ role: "member" }).in("team_id", [...seen]).eq("role", "lead");
        if (rows.length) fail((await db.from("team_members").insert(rows)).error);
        return NextResponse.json({ ok: true, message: `Imported ${rows.length} people${missing.size ? ` · skipped: ${[...missing].slice(0, 5).join(", ")}${missing.size > 5 ? "…" : ""}` : ""}` });
      }
      case "help_resolve": {
        const { data: h } = await db.from("help_requests").select("team_id").eq("id", str(body.id)).maybeSingle();
        if (!h) throw new Error("Request not found.");
        if (!isHost) { const { data: t } = await db.from("teams").select("bay").eq("id", h.team_id).maybeSingle(); if (t?.bay !== myVenue) throw new Error(`You can only act on ${myVenue} teams.`); }
        fail((await db.from("help_requests").update({ status: "resolved", resolved_at: new Date().toISOString() }).eq("id", str(body.id))).error);
        return NextResponse.json({ ok: true, message: "Marked as handled" });
      }

      /* ---------------- reset tool ---------------- */
      case "reset": {
        if (String(body.pin ?? "") !== (process.env.ADMIN_DELETE_PIN || "123")) throw new Error("Wrong password.");
        const parts: string[] = Array.isArray(body.parts) ? body.parts : [];
        if (!parts.length) throw new Error("Choose what to reset.");
        const GLOBAL = ["clock", "lots", "banners", "catalogue_sales"];
        if (!isHost && parts.some(p => GLOBAL.includes(p))) throw new Error("Only a host can reset event-wide settings.");
        // which teams? explicit list, else everything in scope
        let teamIds: string[] = Array.isArray(body.team_ids) && body.team_ids.length ? body.team_ids : [];
        if (!teamIds.length) {
          const { data: ts } = await (isHost ? db.from("teams").select("id") : db.from("teams").select("id").eq("bay", myVenue!));
          teamIds = (ts ?? []).map(t => t.id);
        }
        if (!isHost) {
          const { data: rows } = await db.from("teams").select("id,bay").in("id", teamIds);
          if ((rows ?? []).some(r => r.bay !== myVenue)) throw new Error(`You can only reset ${myVenue} teams.`);
        }
        const done: string[] = [];
        const del = async (table: string) => fail((await db.from(table).delete().in("team_id", teamIds)).error);
        if (parts.includes("purchases") || parts.includes("points")) {
          const { data: pr } = await db.from("purchases").select("transaction_id").in("team_id", teamIds);
          const { data: cs } = await db.from("team_cards").select("applied").in("team_id", teamIds);
          const cardTx = (cs ?? []).map((c: any) => c.applied?.tx).filter(Boolean);
          if (cardTx.length) await db.from("transactions").delete().in("id", cardTx);   // +points cards
          await del("team_cards");
          await db.from("team_powerups").delete().in("team_id", teamIds).not("purchase_id", "is", null);
          await del("purchases");
          const txIds = (pr ?? []).map(r => r.transaction_id).filter(Boolean);
          if (txIds.length) await db.from("transactions").delete().in("id", txIds); // refund what was spent
          done.push("auction wins (refunded)");
        }
        if (parts.includes("points")) {
          // main points only; the auction wallet is reset by "Auction wins"
          const { error } = await db.from("transactions").delete().in("team_id", teamIds).eq("wallet", "main");
          if (error) await del("transactions");            // wallet column not there yet: old behaviour
          done.push("points → 0");
        }
        if (parts.includes("cards")) {
          // cards teams hold (spin results, trump copies…), penalties, ledgers, problem statements, bingo direction
          const { data: cs } = await db.from("team_cards").select("applied").in("team_id", teamIds);
          const cardTx = (cs ?? []).map((c: any) => c.applied?.tx).filter(Boolean);
          if (cardTx.length) await db.from("transactions").delete().in("id", cardTx);
          await db.from("team_powerups").delete().in("team_id", teamIds).not("card_id", "is", null);
          await del("team_cards"); await del("penalties"); await del("team_ledger");
          await db.from("teams").update({ problem_statement: null, ps_locked: false, bingo_mode: null }).in("id", teamIds);
          done.push("cards, penalties, problem statements");
        }
        if (parts.includes("powerups")) { await del("team_powerups"); await db.from("team_powerups").delete().in("target_team_id", teamIds); done.push("power-ups"); }
        if (parts.includes("bingo")) { await del("team_bingo"); done.push("bingo marks"); }
        if (parts.includes("rounds")) { await del("team_stages"); done.push("rounds → upcoming"); }
        if (parts.includes("help")) { await del("help_requests"); done.push("help requests"); }
        if (parts.includes("history")) { await del("activity_log"); await del("penalties"); done.push("history"); }
        if (parts.includes("starting_points")) {
          const { data: es } = await db.from("event_settings").select("starting_points").eq("id", true).maybeSingle();
          const sp = Number(es?.starting_points ?? 0);
          if (sp) { fail((await db.from("transactions").insert(teamIds.map(team_id => ({ team_id, description: "Starting points", points: sp, transaction_type: "bonus", created_by: user.id })))).error); done.push(`+${sp} starting points`); }
        }
        if (parts.includes("clock")) { await db.from("event_settings").update({ hackathon_end_at: null, hackathon_started_at: null, clock_paused_at: null }).eq("id", true); done.push("clock"); }
        if (parts.includes("lots")) { await db.from("event_settings").update({ live_lots: {}, live_lot: null }).eq("id", true); done.push("live lots"); }
        if (parts.includes("banners")) { await db.from("event_settings").update({ broadcasts: {}, broadcast: null }).eq("id", true); done.push("banners"); }
        if (!parts.includes("history")) await log(teamIds.map(team_id => ({ team_id, kind: "reset", action: "reset", label: `Reset: ${done.join(", ")}` })));
        return NextResponse.json({ ok: true, message: `Reset ${teamIds.length} team(s): ${done.join(", ")}` });
      }

      /* ---------------- staff (hosts + venue admins) ---------------- */
      case "staff_list": {
        const { data: profs } = await db.from("profiles").select("id,venue").eq("role", "admin");
        const out: { id: string; venue: string | null; email: string; last: string | null; me: boolean }[] = [];
        for (const p of profs ?? []) {
          const { data } = await db.auth.admin.getUserById(p.id);
          out.push({ id: p.id, venue: p.venue, email: data?.user?.email ?? "?", last: data?.user?.last_sign_in_at ?? null, me: p.id === user.id });
        }
        return NextResponse.json({ ok: true, data: out });
      }
      case "staff_save": {
        const venue = typeof body.venue === "string" && body.venue ? body.venue.slice(0, 40) : null;
        if (body.id) {
          if (body.id === user.id && venue) throw new Error("You can't limit your own host account.");
          fail((await db.from("profiles").update({ venue }).eq("id", body.id).eq("role", "admin")).error);
          if (typeof body.password === "string" && body.password) {
            if (body.password.length < 8) throw new Error("Password must be at least 8 characters.");
            fail((await db.auth.admin.updateUserById(body.id, { password: body.password })).error);
          }
          return NextResponse.json({ ok: true, message: "Organiser updated" });
        }
        const email = str(body.email, 120).toLowerCase();
        if (typeof body.password !== "string" || body.password.length < 8) throw new Error("Password must be at least 8 characters.");
        let uid: string | null = null;
        const { data: created, error: ce } = await db.auth.admin.createUser({ email, password: body.password, email_confirm: true });
        if (ce) {
          // already exists → promote the existing account
          const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
          const found = list?.users?.find(u => u.email?.toLowerCase() === email);
          if (!found) throw new Error(ce.message);
          uid = found.id;
          await db.auth.admin.updateUserById(uid, { password: body.password });
        } else uid = created.user.id;
        fail((await db.from("profiles").upsert({ id: uid, role: "admin", venue, team_id: null, must_change_password: false })).error);
        return NextResponse.json({ ok: true, message: `${email} can now sign in as ${venue ?? "host"}` });
      }
      case "staff_delete": {
        const id = str(body.id);
        if (id === user.id) throw new Error("You can't remove yourself.");
        const { count } = await db.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin").is("venue", null);
        const { data: target } = await db.from("profiles").select("venue").eq("id", id).maybeSingle();
        if (!target?.venue && (count ?? 0) <= 1) throw new Error("Keep at least one host.");
        await db.from("profiles").delete().eq("id", id);
        // If the auth user can't be deleted (older DB with strict links), block the login instead.
        const { error: delErr } = await db.auth.admin.deleteUser(id);
        if (delErr) await db.auth.admin.updateUserById(id, { ban_duration: "876000h" });
        return NextResponse.json({ ok: true, message: delErr ? "Organiser access removed (login disabled)" : "Organiser removed" });
      }

      /* ---------------- stage control ---------------- */
      case "stage": {
        const teamIds = ids(body.team_ids);
        const activity = String(body.activity);
        const status = String(body.status);
        if (!(ACTS.includes(activity) || activity === "quiz" || activity === "all") || !["upcoming", "live", "closed"].includes(status)) throw new Error("Unknown stage.");
        const acts = activity === "all" ? ACTS : [activity];
        if (status === "upcoming") {
          // Reset = forget the round entirely, so it shows as upcoming for every selected team.
          fail((await db.from("team_stages").delete().in("team_id", teamIds).in("activity", acts)).error);
          await log(teamIds.map(team_id => ({ team_id, kind: "round", action: "reset", label: `${acts.join(", ")} reset to upcoming` })));
          return NextResponse.json({ ok: true, message: `${acts.join(" + ")} reset for ${teamIds.length} team(s)` });
        }
        const now = new Date().toISOString();
        let snapshot: Record<string, { pts: number; end: string | null }> = {};
        if (status === "closed") {
          const [{ data: txs }, { data: tps }, { data: s }, { data: st }] = await Promise.all([
            db.from("transactions").select("team_id,points").in("team_id", teamIds),
            db.from("team_powerups").select("*"),
            db.from("event_settings").select("hackathon_end_at").eq("id", true).maybeSingle(),
            db.from("team_stages").select("team_id,activity,status"),
          ]);
          // the rounds being closed right now count as closed for the deadline snapshot
          const closing = new Set(teamIds.flatMap(id => acts.map(a => `${id}:${a}`)));
          const stagesAfter = [
            ...(st ?? []).filter(r => !closing.has(`${r.team_id}:${r.activity}`)),
            ...[...closing].map(k => { const [team_id, activity] = k.split(":"); return { team_id, activity, status: "closed" }; }),
          ];
          snapshot = Object.fromEntries(teamIds.map(id => [id, {
            pts: (txs ?? []).filter(t => t.team_id === id).reduce((a, t) => a + Number(t.points), 0),
            end: projectedEnd(s?.hackathon_end_at ?? null, minutesFor(id, (tps ?? []) as TeamPowerup[], stagesAfter)),
          }]));
        }
        const rows = teamIds.flatMap(team_id => acts.map(activity => ({
          team_id, activity, status,
          opened_at: status === "live" ? now : status === "upcoming" ? null : undefined,
          closed_at: status === "closed" ? now : null,
          closing_points: status === "closed" ? snapshot[team_id].pts : null,
          closing_end_at: status === "closed" ? snapshot[team_id].end : null,
        }))).map(r => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined)));
        fail((await db.from("team_stages").upsert(rows, { onConflict: "team_id,activity" })).error);
        if (acts.includes("quiz") && status === "closed") {
          // closing Rapid Fire submits whatever sections are still open
          const { data: open } = await db.from("quiz_runs").select("team_id,section_id").in("team_id", teamIds).is("submitted_at", null);
          for (const r of open ?? []) await db.rpc("quiz_submit_section", { p_team: r.team_id, p_section: r.section_id });
        }
        await log(teamIds.map(team_id => ({ team_id, kind: "round", action: status === "live" ? "opened" : "closed",
          label: status === "closed" ? `${acts.join(", ")} closed · points confirmed · deadline ${snapshot[team_id]?.end ? new Date(snapshot[team_id].end as string).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "not set"}` : `${acts.join(", ")} opened`,
          points: status === "closed" ? snapshot[team_id]?.pts ?? null : null })));
        return NextResponse.json({ ok: true, message: `${acts.join(" + ")} → ${status} for ${teamIds.length} team(s)` });
      }
      /* ---------------- Rapid Fire (host) ---------------- */
      case "quiz_section_save": {
        if (!isHost) throw new Error("Only a host can edit Rapid Fire.");
        const row = { title: str(body.title, 60), time_limit_sec: int(body.time_limit_sec, 10, 7200), points_per_correct: int(body.points_per_correct, -1000, 1000), idx: int(body.idx ?? 0, 0, 1000) };
        fail((await (body.id ? db.from("quiz_sections").update(row).eq("id", str(body.id)) : db.from("quiz_sections").insert(row))).error);
        return NextResponse.json({ ok: true, message: "Section saved" });
      }
      case "quiz_section_delete": {
        if (!isHost) throw new Error("Only a host can edit Rapid Fire.");
        fail((await db.from("quiz_sections").delete().eq("id", str(body.id))).error);
        return NextResponse.json({ ok: true, message: "Section deleted" });
      }
      case "quiz_question_save": {
        if (!isHost) throw new Error("Only a host can edit Rapid Fire.");
        const options = Array.isArray(body.options) ? (body.options as unknown[]).map(o => String(o ?? "").trim()).filter(Boolean) : [];
        if (options.length < 2) throw new Error("Give at least two options.");
        const correct = int(body.correct, 0, options.length - 1);
        const row = { section_id: str(body.section_id), prompt: str(body.prompt, 400), options, correct, idx: int(body.idx ?? 0, 0, 1000) };
        fail((await (body.id ? db.from("quiz_questions").update(row).eq("id", str(body.id)) : db.from("quiz_questions").insert(row))).error);
        return NextResponse.json({ ok: true, message: "Question saved" });
      }
      case "quiz_question_delete": {
        if (!isHost) throw new Error("Only a host can edit Rapid Fire.");
        fail((await db.from("quiz_questions").delete().eq("id", str(body.id))).error);
        return NextResponse.json({ ok: true, message: "Question deleted" });
      }
      case "quiz_reset": {
        const teamIds = ids(body.team_ids);
        for (const id of teamIds) fail((await db.rpc("quiz_reset", { p_team: id })).error);
        await log(teamIds.map(team_id => ({ team_id, kind: "quiz", action: "reset", label: "Rapid Fire attempt reset" })));
        return NextResponse.json({ ok: true, message: `Rapid Fire reset for ${teamIds.length} team(s)` });
      }
      case "quiz_admin": {
        const [secs, qs, runs, flags] = await Promise.all([
          db.from("quiz_sections").select("*").order("idx"),
          db.from("quiz_questions").select("*").order("idx"),
          db.from("quiz_runs").select("*"),
          db.from("quiz_flags").select("team_id,kind,created_at").order("created_at", { ascending: false }),
        ]);
        fail(secs.error);
        return NextResponse.json({ ok: true, data: { sections: secs.data, questions: qs.data, runs: runs.data, flags: flags.data } });
      }

      case "bay": {
        const teamIds = ids(body.team_ids);
        const bay = typeof body.bay === "string" && body.bay.trim() ? body.bay.trim().slice(0, 30) : null;
        fail((await db.from("teams").update({ bay }).in("id", teamIds)).error);
        return NextResponse.json({ ok: true, message: `Moved ${teamIds.length} team(s) to ${bay ?? "no bay"}` });
      }

      /* ---------------- points ---------------- */
      case "grant": {
        const teamIds = ids(body.team_ids);
        const amount = int(body.amount);
        if (amount === 0) throw new Error("Amount cannot be zero.");
        const reason = str(body.reason, 120);
        fail((await db.from("transactions").insert(teamIds.map(team_id => ({
          team_id, description: reason, points: amount, transaction_type: amount > 0 ? "bonus" : "adjustment", created_by: user.id,
        })))).error);
        await log(teamIds.map(team_id => ({ team_id, kind: "points", action: amount > 0 ? "granted" : "removed", label: reason, points: amount })));
        return NextResponse.json({ ok: true, message: `${amount > 0 ? "+" : ""}${amount} pts → ${teamIds.length} team(s)` });
      }
      case "undo_tx": {
        const { data: tx } = await db.from("transactions").select("team_id,description,points").eq("id", str(body.id)).maybeSingle();
        fail((await db.from("transactions").delete().eq("id", str(body.id)).neq("transaction_type", "purchase")).error);
        if (tx) await log({ team_id: tx.team_id, kind: "points", action: "removed", label: `Entry deleted: ${tx.description}`, points: -Number(tx.points) });
        return NextResponse.json({ ok: true, message: "Entry removed" });
      }

      /* ---------------- clock / broadcast ---------------- */
      case "settings": {
        const patch: Record<string, unknown> = {};
        if ("hackathon_end_at" in body) patch.hackathon_end_at = body.hackathon_end_at ? new Date(body.hackathon_end_at).toISOString() : null;
        if ("broadcast" in body) patch.broadcast = typeof body.broadcast === "string" && body.broadcast.trim() ? body.broadcast.trim().slice(0, 200) : null;
        if ("bingo_line_bonus" in body) patch.bingo_line_bonus = int(body.bingo_line_bonus, 0, 100000);
        if ("bingo_full_bonus" in body) patch.bingo_full_bonus = int(body.bingo_full_bonus, 0, 100000);
        if ("bingo_rewards" in body && body.bingo_rewards && typeof body.bingo_rewards === "object")
          patch.bingo_rewards = Object.fromEntries(["B", "I", "N", "G", "O", "FULL"].map(k => [k, String(body.bingo_rewards[k] ?? "").slice(0, 120)]));
        if ("portal_locked" in body) patch.portal_locked = Boolean(body.portal_locked);
        if ("portal_message" in body) patch.portal_message = typeof body.portal_message === "string" ? body.portal_message.slice(0, 200) || null : null;
        if ("starting_points" in body) patch.starting_points = int(body.starting_points, 0, 1000000);
        if ("auction_budget" in body) patch.auction_budget = int(body.auction_budget, 0, 10000000);
        if ("leaderboard_visible" in body) patch.leaderboard_visible = Boolean(body.leaderboard_visible);
        if ("live_lot" in body) patch.live_lot = body.live_lot ? { item_id: str(body.live_lot.item_id), price: int(body.live_lot.price, 0), team_ids: Array.isArray(body.live_lot.team_ids) ? body.live_lot.team_ids : undefined } : null;
        fail((await db.from("event_settings").update(patch).eq("id", true)).error);
        return NextResponse.json({ ok: true, message: "Saved" });
      }

      /* ---------------- auction ---------------- */
      case "item_save": {
        const min = body.min_price === "" || body.min_price == null ? null : int(body.min_price, 0);
        const max = body.max_price === "" || body.max_price == null ? null : int(body.max_price, 0);
        if (min != null && max != null && min > max) throw new Error("Minimum is above maximum.");
        const kind = String(body.kind ?? "note");
        if (!["time", "points", "bingo", "note", "trump"].includes(kind)) throw new Error("Pick a card type.");
        const e = (body.effect ?? {}) as Record<string, unknown>;
        let effect: Record<string, unknown> = {};
        if (body.pool === "spin" && !["time", "points", "note"].includes(kind)) throw new Error("Wheel segments are Time, Points or Note.");
        if (kind === "time") { effect = { minutes: int(e.minutes, -600, 600) }; if (!effect.minutes) throw new Error("Enter the minutes."); }
        if (kind === "points") { effect = { amount: int(e.amount, -100000, 100000) }; if (!effect.amount) throw new Error("Enter the points."); }
        if (kind === "bingo") effect = e.mode === "column" ? { mode: "column", column: int(e.column, 0, 4) } : { mode: "cell" };
        if (kind === "note") {
          const phase = ["ps", "build", "spin", "penalty", "presentation", "other"].includes(String(e.phase)) ? String(e.phase) : "other";
          const perk = ["none", "no_penalty", "pass_penalty", "swap_ps"].includes(String(e.perk)) ? String(e.perk) : "none";
          effect = { phase, perk };
        }
        const row = {
          item_name: str(body.item_name, 80),
          description: typeof body.description === "string" ? body.description.trim().slice(0, 200) || null : null,
          base_points: int(body.base_points, 0),
          min_price: min, max_price: max,
          price_step: int(body.price_step ?? 10, 1, 100000),
          powerup_id: null,
          kind, effect,
          pool: body.pool === "spin" ? "spin" : "auction",
          is_active: body.is_active !== false,
        };
        const q = body.id ? db.from("auction_items").update(row).eq("id", body.id) : db.from("auction_items").insert({ ...row, quantity: 1 });
        fail((await q).error);
        return NextResponse.json({ ok: true, message: body.id ? "Card updated" : "Card added" });
      }
      case "item_copy": {
        const { data, error } = await db.rpc("admin_copy_lot", { p_item_id: str(body.id) });
        fail(error);
        return NextResponse.json({ ok: true, message: "Copied — a new slot is open", data });
      }
      case "item_delete": {
        const id = str(body.id);
        const { data: sold } = await db.from("purchases").select("team_id,teams(bay)").eq("item_id", id);
        if (!isHost && (sold ?? []).some((r: any) => r.teams?.bay !== myVenue)) throw new Error("This card was bought by a team in another venue. Ask a host to delete it.");
        const { data: it } = await db.from("auction_items").select("item_name").eq("id", id).maybeSingle();
        const { data, error } = await db.rpc("admin_delete_lot", { p_item_id: id });
        fail(error);
        const n = Number((data as { voided?: number } | null)?.voided ?? 0);
        if (n) await log((sold ?? []).map((r: any) => ({ team_id: r.team_id, kind: "auction", action: "refunded", label: `Card deleted, sale voided: ${it?.item_name ?? "card"}` })));
        return NextResponse.json({ ok: true, message: n ? `Deleted · ${n} sale(s) voided and refunded` : "Deleted" });
      }
      case "item_toggle": {
        fail((await db.from("auction_items").update({ is_active: Boolean(body.is_active) }).eq("id", str(body.id))).error);
        return NextResponse.json({ ok: true, message: "Updated" });
      }
      case "sell": {
        await requireLive(str(body.team_id), "auction");
        const cell = body.cell === undefined || body.cell === null || body.cell === "" ? null : int(body.cell, 0, 24);
        const { data, error } = await db.rpc("admin_sell_lot", { p_item_id: str(body.item_id), p_team_id: str(body.team_id), p_price: int(body.price, 0), p_admin: user.id, p_cell: cell });
        fail(error);
        const { data: it } = await db.from("auction_items").select("item_name").eq("id", body.item_id).maybeSingle();
        await log({ team_id: body.team_id, kind: "auction", action: "sold", label: `Won lot: ${it?.item_name ?? "item"}`, points: -int(body.price, 0) });
        return NextResponse.json({ ok: true, message: `SOLD · ${data?.remaining ?? "?"} pts left`, data });
      }
      case "undo_sale": {
        const { data: pr } = await db.from("purchases").select("team_id,purchase_price,auction_items(item_name)").eq("id", str(body.id)).maybeSingle();
        fail((await db.rpc("admin_undo_sale", { p_purchase_id: str(body.id) })).error);
        if (pr) await log({ team_id: pr.team_id, kind: "auction", action: "refunded", label: `Sale voided: ${(pr as any).auction_items?.item_name ?? "item"}`, points: Number(pr.purchase_price) });
        return NextResponse.json({ ok: true, message: "Sale voided · points refunded · card effects undone" });
      }
      case "trump_resolve": {
        const cell = body.cell === undefined || body.cell === null || body.cell === "" ? null : int(body.cell, 0, 24);
        const { data, error } = await db.rpc("admin_resolve_trump", { p_card: str(body.id), p_item_id: str(body.item_id), p_cell: cell, p_admin: user.id });
        fail(error);
        const { data: c } = await db.from("team_cards").select("team_id").eq("id", body.id).maybeSingle();
        if (c) await log({ team_id: c.team_id, kind: "auction", action: "granted", label: `Trump card became: ${(data as { name?: string } | null)?.name ?? "card"}` });
        return NextResponse.json({ ok: true, message: `Trump → ${(data as { name?: string } | null)?.name ?? "card"}` });
      }

      /* ---------------- undo anything on a team ---------------- */
      case "card_remove": {
        fail((await db.rpc("admin_card_remove", { p_card: str(body.id), p_admin: user.id })).error);
        return NextResponse.json({ ok: true, message: "Card removed and its effects undone" });
      }
      case "card_unuse": {
        fail((await db.rpc("admin_card_unuse", { p_card: str(body.id), p_admin: user.id })).error);
        return NextResponse.json({ ok: true, message: "Card is usable again" });
      }
      case "penalty_remove": {
        const { data, error } = await db.rpc("admin_penalty_remove", { p_id: str(body.id), p_admin: user.id });
        fail(error);
        return NextResponse.json({ ok: true, message: `Penalty removed. ${(data as { note?: string } | null)?.note ?? ""}` });
      }
      case "ps_unlock": {
        fail((await db.rpc("admin_ps_unlock", { p_team: str(body.team_id) })).error);
        return NextResponse.json({ ok: true, message: "Problem statement can be edited again" });
      }

      /* ---------------- problem statements ---------------- */
      case "ps_set": {
        const id = str(body.team_id);
        const { data: t } = await db.from("teams").select("ps_locked").eq("id", id).maybeSingle();
        if (t?.ps_locked) throw new Error("This problem statement was swapped and is final.");
        const text = typeof body.text === "string" ? body.text.trim().slice(0, 400) : "";
        fail((await db.from("teams").update({ problem_statement: text || null }).eq("id", id)).error);
        if (text) await log({ team_id: id, kind: "auction", action: "granted", label: `Problem statement: ${text.slice(0, 120)}` });
        return NextResponse.json({ ok: true, message: text ? "Problem statement saved" : "Problem statement cleared" });
      }
      case "ps_swap": {
        fail((await db.rpc("admin_swap_ps", { p_card: str(body.id), p_target: str(body.target_id), p_admin: user.id })).error);
        return NextResponse.json({ ok: true, message: "Problem statements swapped · both are now final" });
      }

      /* ---------------- penalties ---------------- */
      case "penalty": {
        const { data, error } = await db.rpc("admin_penalty", { p_team: str(body.team_id), p_minutes: int(body.minutes ?? 0, 0, 600), p_points: int(body.points ?? 0, 0, 100000), p_reason: str(body.reason, 160), p_admin: user.id });
        fail(error);
        return NextResponse.json({ ok: true, message: (data as { message?: string } | null)?.message ?? "Penalty recorded" });
      }

      /* ---------------- power-ups ---------------- */
      case "powerup_save": {
        const row = {
          name: str(body.name, 80),
          description: typeof body.description === "string" ? body.description.trim().slice(0, 200) || null : null,
          minutes_delta: int(body.minutes_delta ?? 0, -600, 600),
          targets_rival: Boolean(body.targets_rival),
          color: ["cyan", "magenta", "amber", "violet", "lime"].includes(body.color) ? body.color : "cyan",
          is_active: body.is_active !== false,
        };
        const q = body.id ? db.from("powerups").update(row).eq("id", body.id) : db.from("powerups").insert(row);
        fail((await q).error);
        return NextResponse.json({ ok: true, message: "Power-up saved" });
      }
      case "award": {
        const teamId = str(body.team_id);
        const { data: pu, error } = await db.from("powerups").select("*").eq("id", str(body.powerup_id)).single();
        fail(error);
        const target = pu.targets_rival ? str(body.target_team_id) : null;
        if (target === teamId) throw new Error("A rival power-up cannot target its own team.");
        const minutes = body.minutes_delta === "" || body.minutes_delta == null ? pu.minutes_delta : int(body.minutes_delta, -600, 600);
        const source = ["spin", "auction", "bingo", "manual"].includes(body.source) ? body.source : "manual";
        if (source === "spin") await requireLive(teamId, "spin");
        fail((await db.from("team_powerups").insert({ team_id: teamId, powerup_id: pu.id, name: pu.name, minutes_delta: minutes, target_team_id: target, source, note: body.note || null, created_by: user.id })).error);
        await log({ team_id: teamId, kind: "powerup", action: "granted", label: `${pu.name} (${source})`, minutes: target ? null : minutes });
        if (target) await log({ team_id: target, kind: "powerup", action: "granted", label: `${pu.name} played on you`, minutes });
        return NextResponse.json({ ok: true, message: `${pu.name} granted` });
      }
      case "spin_grant": {
        const teamId = str(body.team_id);
        await requireLive(teamId, "spin");
        const { data, error } = await db.rpc("admin_spin_grant", { p_item_id: str(body.item_id), p_team_id: teamId, p_admin: user.id });
        fail(error);
        return NextResponse.json({ ok: true, message: `${(data as { name?: string } | null)?.name ?? "Result"} given` });
      }
      case "spin_revoke": {
        fail((await db.rpc("admin_spin_revoke", { p_card: str(body.id), p_admin: user.id })).error);
        return NextResponse.json({ ok: true, message: "Spin result removed and undone" });
      }
      case "powerup_used": {
        const { data: tp } = await db.from("team_powerups").select("team_id,name").eq("id", str(body.id)).maybeSingle();
        fail((await db.from("team_powerups").update({ used: Boolean(body.used) }).eq("id", str(body.id))).error);
        if (tp) await log({ team_id: tp.team_id, kind: "powerup", action: body.used ? "used" : "restored", label: tp.name });
        return NextResponse.json({ ok: true, message: body.used ? "Marked as used" : "Restored" });
      }
      case "revoke": {
        const { data: tp } = await db.from("team_powerups").select("team_id,name,minutes_delta,target_team_id").eq("id", str(body.id)).maybeSingle();
        fail((await db.from("team_powerups").delete().eq("id", str(body.id))).error);
        if (tp) await log({ team_id: tp.team_id, kind: "powerup", action: "removed", label: `${tp.name} revoked`, minutes: tp.target_team_id ? null : -tp.minutes_delta });
        if (tp?.target_team_id) await log({ team_id: tp.target_team_id, kind: "powerup", action: "removed", label: `${tp.name} lifted`, minutes: -tp.minutes_delta });
        return NextResponse.json({ ok: true, message: "Power-up revoked" });
      }

      /* ---------------- bingo ---------------- */
      case "bingo_toggle": {
        await requireLive(str(body.team_id), "bingo");
        const args = { p_team_id: str(body.team_id), p_idx: int(body.idx, 0, 24), p_admin: user.id };
        // Prefer the explicit stamp/unstamp (ui_v6) so two volunteers can't undo each other.
        let res = typeof body.on === "boolean" ? await db.rpc("admin_bingo_mark", { ...args, p_on: body.on }) : null;
        if (res?.error && /admin_bingo_mark/i.test(res.error.message)) res = await db.rpc("admin_set_bingo", { ...args, p_on: body.on });
        if (!res || (res.error && /Could not find the function|admin_set_bingo.*does not exist/i.test(res.error.message))) res = await db.rpc("admin_toggle_bingo", args);
        fail(res.error);
        const data = res.data as { marked?: boolean; noop?: boolean; columns?: number; full?: boolean } | null;
        if (data?.noop) return NextResponse.json({ ok: true, message: data.marked ? "Already stamped" : "Already cleared", data });
        return NextResponse.json({ ok: true, message: data?.marked ? `Dare stamped${data.full ? " · FULL CARD!" : data.columns ? ` · ${data.columns}/5 letters` : ""}` : "Stamp removed", data });
      }
      case "cell_save": {
        fail((await db.from("bingo_cells").update({ label: str(body.label, 120), points: int(body.points, -10000, 10000) }).eq("idx", int(body.idx, 0, 24))).error);
        return NextResponse.json({ ok: true, message: "Square updated" });
      }
      /* ---------------- hackathon clock ---------------- */
      case "clock": {
        const { data: st } = await db.from("event_settings").select("hackathon_end_at,clock_paused_at").eq("id", true).maybeSingle();
        const now = Date.now();
        let patch: Record<string, unknown> = {}; let msg = "";
        switch (body.op) {
          case "start": {
            const minutes = int(body.minutes, 1, 72 * 60);
            patch = { hackathon_started_at: new Date(now).toISOString(), hackathon_end_at: new Date(now + minutes * 60000).toISOString(), clock_paused_at: null };
            msg = `Clock started · ${Math.floor(minutes / 60)}h ${minutes % 60}m`; break;
          }
          case "pause":
            if (!st?.hackathon_end_at || st.clock_paused_at) throw new Error("Clock is not running.");
            patch = { clock_paused_at: new Date(now).toISOString() }; msg = "Clock paused"; break;
          case "resume": {
            if (!st?.clock_paused_at || !st.hackathon_end_at) throw new Error("Clock is not paused.");
            const gap = now - new Date(st.clock_paused_at).getTime();
            patch = { clock_paused_at: null, hackathon_end_at: new Date(new Date(st.hackathon_end_at).getTime() + gap).toISOString() };
            msg = "Clock resumed"; break;
          }
          case "adjust": {
            if (!st?.hackathon_end_at) throw new Error("Start the clock first.");
            const minutes = int(body.minutes, -24 * 60, 24 * 60);
            patch = { hackathon_end_at: new Date(new Date(st.hackathon_end_at).getTime() + minutes * 60000).toISOString() };
            msg = `Everyone ${minutes > 0 ? "+" : ""}${minutes} min`; break;
          }
          case "set_end": {
            patch = { hackathon_end_at: body.end_at ? new Date(body.end_at).toISOString() : null, clock_paused_at: null };
            if (body.end_at && !st?.hackathon_end_at) patch.hackathon_started_at = new Date(now).toISOString();
            msg = "Deadline set"; break;
          }
          case "reset":
            patch = { hackathon_end_at: null, hackathon_started_at: null, clock_paused_at: null }; msg = "Clock cleared"; break;
          default: throw new Error("Unknown clock action.");
        }
        fail((await db.from("event_settings").update(patch).eq("id", true)).error);
        await log({ team_id: null, kind: "clock", action: String(body.op), label: msg, minutes: body.op === "adjust" ? int(body.minutes, -1440, 1440) : null });
        return NextResponse.json({ ok: true, message: msg });
      }

      /* ---------------- history ---------------- */
      case "activity_for": {
        const q = db.from("activity_log").select("id,team_id,kind,action,label,points,minutes,created_at").order("created_at", { ascending: false }).limit(1000);
        let data, error;
        if (body.team_id) ({ data, error } = await q.eq("team_id", str(body.team_id)));
        else if (!isHost || body.venue) {
          const v = isHost ? String(body.venue) : myVenue!;
          const { data: ts } = await (v === "__unassigned" ? db.from("teams").select("id").is("bay", null) : db.from("teams").select("id").eq("bay", v));
          ({ data, error } = await q.in("team_id", (ts ?? []).map(t => t.id)));
        } else ({ data, error } = await q);
        fail(error);
        return NextResponse.json({ ok: true, data });
      }

      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (e) {
    let msg = e instanceof Error ? e.message : "Action failed.";
    if (/does not exist|schema cache|Could not find the/i.test(msg)) msg += ". The database is missing an update: run supabase/ALL_IN_ONE.sql in Supabase.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
