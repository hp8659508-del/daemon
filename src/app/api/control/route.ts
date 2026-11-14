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
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Admin only." }, { status: 403 });

  const db = createAdminClient();
  let body: Record<string, any>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Bad request." }, { status: 400 }); }

  try {
    const fail = (e: { message: string } | null) => { if (e) throw new Error(e.message); };
    switch (body.action) {
      /* ---------------- stage control ---------------- */
      case "stage": {
        const teamIds = ids(body.team_ids);
        const activity = String(body.activity);
        const status = String(body.status);
        if (!ACTS.includes(activity) || !["upcoming", "live", "closed"].includes(status)) throw new Error("Unknown stage.");
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
        const rows = teamIds.map(team_id => ({
          team_id, activity, status,
          opened_at: status === "live" ? now : status === "upcoming" ? null : undefined,
          closed_at: status === "closed" ? now : null,
          closing_points: status === "closed" ? snapshot[team_id].pts : null,
          closing_end_at: status === "closed" ? snapshot[team_id].end : null,
        })).map(r => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined)));
        fail((await db.from("team_stages").upsert(rows, { onConflict: "team_id,activity" })).error);
        return NextResponse.json({ ok: true, message: `${activity} → ${status} for ${teamIds.length} team(s)` });
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
        return NextResponse.json({ ok: true, message: `${amount > 0 ? "+" : ""}${amount} pts → ${teamIds.length} team(s)` });
      }
      case "undo_tx": {
        fail((await db.from("transactions").delete().eq("id", str(body.id)).neq("transaction_type", "purchase")).error);
        return NextResponse.json({ ok: true, message: "Entry removed" });
      }

      /* ---------------- clock / broadcast ---------------- */
      case "settings": {
        const patch: Record<string, unknown> = {};
        if ("hackathon_end_at" in body) patch.hackathon_end_at = body.hackathon_end_at ? new Date(body.hackathon_end_at).toISOString() : null;
        if ("broadcast" in body) patch.broadcast = typeof body.broadcast === "string" && body.broadcast.trim() ? body.broadcast.trim().slice(0, 200) : null;
        if ("bingo_line_bonus" in body) patch.bingo_line_bonus = int(body.bingo_line_bonus, 0, 100000);
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
        return NextResponse.json({ ok: true, message: `SOLD · ${data?.remaining ?? "?"} pts left`, data });
      }
      case "undo_sale": {
        fail((await db.rpc("admin_undo_sale", { p_purchase_id: str(body.id) })).error);
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
        return NextResponse.json({ ok: true, message: `${pu.name} granted` });
      }
      case "powerup_used": {
        fail((await db.from("team_powerups").update({ used: Boolean(body.used) }).eq("id", str(body.id))).error);
        return NextResponse.json({ ok: true, message: body.used ? "Marked as used" : "Restored" });
      }
      case "revoke": {
        fail((await db.from("team_powerups").delete().eq("id", str(body.id))).error);
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
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Action failed." }, { status: 400 });
  }
}
