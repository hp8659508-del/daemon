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
  const { data: { user } } = await supabase.auth.getUser();
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

    /* ---------- permission + venue scope, checked once for every action ---------- */
    const HOST_ONLY = ["clock", "bay", "staff_list", "staff_save", "staff_delete", "team_delete", "team_move", "powerup_save", "cell_save"];
    if (!isHost && HOST_ONLY.includes(body.action)) throw new Error("Only a host can do this.");
    if (!isHost && body.action === "settings") throw new Error("Only a host can change event settings.");
    if (!isHost) {
      const touched = new Set<string>();
      if (Array.isArray(body.team_ids)) body.team_ids.forEach((x: unknown) => typeof x === "string" && touched.add(x));
      if (typeof body.team_id === "string") touched.add(body.team_id);
      const byRow: Record<string, [string, string]> = { undo_tx: ["transactions", "team_id"], undo_sale: ["purchases", "team_id"], powerup_used: ["team_powerups", "team_id"], revoke: ["team_powerups", "team_id"] };
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
        try { await (db.from("teams") as any).update({ password_changed_at: null }).eq("id", id); } catch {}
        await log({ team_id: id, kind: "team", action: "password", label: "Password reset by organiser" });
        return NextResponse.json({ ok: true, message: `Password set to ${password}` });
      }
      case "team_delete": {
        const teamIds = ids(body.team_ids);
        const { data: profs } = await db.from("profiles").select("id").in("team_id", teamIds);
        // children first: anything that may not cascade
        await db.from("team_powerups").update({ target_team_id: null }).in("target_team_id", teamIds);
        for (const t of ["team_powerups", "team_bingo", "team_stages", "purchases", "transactions", "activity_log"]) await db.from(t).delete().in("team_id", teamIds);
        await db.from("profiles").delete().in("team_id", teamIds);
        for (const p of profs ?? []) await db.auth.admin.deleteUser(p.id);
        fail((await db.from("teams").delete().in("id", teamIds)).error);
        await log({ team_id: null, kind: "team", action: "deleted", label: `Deleted ${teamIds.length} team(s)` });
        return NextResponse.json({ ok: true, message: `Deleted ${teamIds.length} team(s) and their logins` });
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
        await db.auth.admin.deleteUser(id);
        return NextResponse.json({ ok: true, message: "Organiser removed" });
      }

      /* ---------------- stage control ---------------- */
      case "stage": {
        const teamIds = ids(body.team_ids);
        const activity = String(body.activity);
        const status = String(body.status);
        if (!(ACTS.includes(activity) || activity === "all") || !["upcoming", "live", "closed"].includes(status)) throw new Error("Unknown stage.");
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
          const [{ data: txs }, { data: tps }, { data: s }] = await Promise.all([
            db.from("transactions").select("team_id,points").in("team_id", teamIds),
            db.from("team_powerups").select("*"),
            db.from("event_settings").select("hackathon_end_at").eq("id", true).maybeSingle(),
          ]);
          snapshot = Object.fromEntries(teamIds.map(id => [id, {
            pts: (txs ?? []).filter(t => t.team_id === id).reduce((a, t) => a + Number(t.points), 0),
            end: projectedEnd(s?.hackathon_end_at ?? null, minutesFor(id, (tps ?? []) as TeamPowerup[])),
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
        await log(teamIds.map(team_id => ({ team_id, kind: "round", action: status === "live" ? "opened" : "closed", label: `${acts.join(", ")} ${status === "live" ? "opened" : "closed"}`, points: status === "closed" ? snapshot[team_id]?.pts ?? null : null })));
        return NextResponse.json({ ok: true, message: `${acts.join(" + ")} → ${status} for ${teamIds.length} team(s)` });
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
        const row = {
          item_name: str(body.item_name, 80),
          description: typeof body.description === "string" ? body.description.trim().slice(0, 200) || null : null,
          base_points: int(body.base_points, 0),
          min_price: min, max_price: max,
          price_step: int(body.price_step ?? 10, 1, 100000),
          quantity: int(body.quantity ?? 1, 1, 999),
          powerup_id: body.powerup_id || null,
          is_active: body.is_active !== false,
        };
        const q = body.id ? db.from("auction_items").update(row).eq("id", body.id) : db.from("auction_items").insert(row);
        fail((await q).error);
        return NextResponse.json({ ok: true, message: body.id ? "Lot updated" : "Lot added" });
      }
      case "item_toggle": {
        fail((await db.from("auction_items").update({ is_active: Boolean(body.is_active) }).eq("id", str(body.id))).error);
        return NextResponse.json({ ok: true, message: "Updated" });
      }
      case "sell": {
        const { data, error } = await db.rpc("admin_sell_lot", { p_item_id: str(body.item_id), p_team_id: str(body.team_id), p_price: int(body.price, 0), p_admin: user.id });
        fail(error);
        const { data: it } = await db.from("auction_items").select("item_name").eq("id", body.item_id).maybeSingle();
        await log({ team_id: body.team_id, kind: "auction", action: "sold", label: `Won lot: ${it?.item_name ?? "item"}`, points: -int(body.price, 0) });
        return NextResponse.json({ ok: true, message: `SOLD · ${data?.remaining ?? "?"} pts left`, data });
      }
      case "undo_sale": {
        const { data: pr } = await db.from("purchases").select("team_id,purchase_price,auction_items(item_name)").eq("id", str(body.id)).maybeSingle();
        fail((await db.rpc("admin_undo_sale", { p_purchase_id: str(body.id) })).error);
        if (pr) await log({ team_id: pr.team_id, kind: "auction", action: "refunded", label: `Sale reversed: ${(pr as any).auction_items?.item_name ?? "item"}`, points: Number(pr.purchase_price) });
        return NextResponse.json({ ok: true, message: "Sale reversed, points refunded" });
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
        fail((await db.from("team_powerups").insert({ team_id: teamId, powerup_id: pu.id, name: pu.name, minutes_delta: minutes, target_team_id: target, source, note: body.note || null, created_by: user.id })).error);
        await log({ team_id: teamId, kind: "powerup", action: "granted", label: `${pu.name} (${source})`, minutes: target ? null : minutes });
        if (target) await log({ team_id: target, kind: "powerup", action: "granted", label: `${pu.name} played on you`, minutes });
        return NextResponse.json({ ok: true, message: `${pu.name} granted` });
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
        const { data, error } = await db.rpc("admin_toggle_bingo", { p_team_id: str(body.team_id), p_idx: int(body.idx, 0, 24), p_admin: user.id });
        fail(error);
        return NextResponse.json({ ok: true, message: data?.marked ? `Dare cleared · ${data.lines} line(s)` : "Square un-marked", data });
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
    return NextResponse.json({ error: e instanceof Error ? e.message : "Action failed." }, { status: 400 });
  }
}
