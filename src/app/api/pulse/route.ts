import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/pulse — the one tiny thing 1000 screens poll.
 * { v: { global: n, <teamId>: n, … }, lots: { <venue>: { item_id, price } }, at }
 * Cached by Vercel's CDN for 1 s (and served stale for up to 5 s while it refreshes),
 * so however many screens poll, the database sees about one request per second.
 * Contains only counters and the live lot (no names, points or answers).
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { data, error } = await createAdminClient().rpc("dh_pulse");
    if (error) throw error;
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=1, stale-while-revalidate=5",
        "CDN-Cache-Control": "public, s-maxage=1, stale-while-revalidate=5",
        "Vercel-CDN-Cache-Control": "public, s-maxage=1, stale-while-revalidate=5",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "pulse failed" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
