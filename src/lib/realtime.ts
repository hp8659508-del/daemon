/**
 * Low-latency event hub over Supabase Realtime *Broadcast* (websocket fan-out,
 * no database round-trip). Used for:
 *   • "lot"     – the auctioneer's live price, pushed to every screen as it moves
 *   • "refresh" – a pulse after every admin action so screens reload immediately,
 *                 even if postgres change-feeds aren't configured
 * Browser-only; one shared channel per tab.
 */
import { createClient } from "@/lib/supabase/client";

export type LotFeed = { venue: string; item_id: string | null; price: number; ts: number };
type RefreshPulse = { teams: string[] | null; ts: number };
type Channel = ReturnType<ReturnType<typeof createClient>["channel"]>;

let channel: Channel | null = null;
let ready = false;
const refreshFns = new Set<(p: RefreshPulse) => void>();
const lotFns = new Set<(l: LotFeed) => void>();
const readyFns = new Set<(ok: boolean) => void>();

function hub(): Channel | null {
  if (typeof window === "undefined") return null;
  if (channel) return channel;
  const sb = createClient();
  channel = sb.channel("daemon-hub", { config: { broadcast: { self: false, ack: false } } });
  channel.on("broadcast", { event: "refresh" }, ({ payload }) => refreshFns.forEach(f => f(payload as RefreshPulse)));
  channel.on("broadcast", { event: "lot" }, ({ payload }) => lotFns.forEach(f => f(payload as LotFeed)));
  channel.subscribe(status => { ready = status === "SUBSCRIBED"; readyFns.forEach(f => f(ready)); });
  return channel;
}

export function onRefreshPulse(fn: (p: RefreshPulse) => void) { hub(); refreshFns.add(fn); return () => { refreshFns.delete(fn); }; }
export function onLotFeed(fn: (l: LotFeed) => void) { hub(); lotFns.add(fn); return () => { lotFns.delete(fn); }; }
export function onHubReady(fn: (ok: boolean) => void) { hub(); readyFns.add(fn); fn(ready); return () => { readyFns.delete(fn); }; }

export function sendRefreshPulse(teams: string[] | null) {
  const c = hub(); if (!c) return;
  void c.send({ type: "broadcast", event: "refresh", payload: { teams, ts: Date.now() } });
}
export function sendLotFeed(lot: Omit<LotFeed, "ts">) {
  const c = hub(); if (!c) return;
  void c.send({ type: "broadcast", event: "lot", payload: { ...lot, ts: Date.now() } });
}
