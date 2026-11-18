import "server-only";
import type { User } from "@supabase/supabase-js";

/**
 * Verifying a login with Supabase Auth is a network call. With 1000 screens that is
 * thousands of Auth calls a minute, which Auth rate-limits (today's 504s).
 * We verify each access token with Auth ONCE, then trust it for 60 s on this server
 * instance. Tokens are per session and expire anyway; a signed-out user's token stops
 * working here within a minute.
 */
type Sb = { auth: { getSession: () => Promise<{ data: { session: { access_token: string } | null } }>; getUser: (jwt?: string) => Promise<{ data: { user: User | null }; error?: { status?: number } | null }> } };
const tokens = new Map<string, { user: User; exp: number }>();
const inflight = new Map<string, Promise<User | null>>();
const TTL = 60_000;

/**
 * strict: the login is only treated as gone (null) when Auth says so (401/403/404, e.g. the
 * account was deleted). If Auth is just busy or down, it throws instead, so the page shows
 * "Reconnecting…" and retries rather than signing a working team out.
 */
export async function getUserCached(supabase: Sb, opts: { strict?: boolean } = {}): Promise<User | null> {
  const { data: { session } } = await supabase.auth.getSession(); // reads the cookie, no network unless refreshing
  const token = session?.access_token;
  if (!token) return null;
  const hit = tokens.get(token);
  if (hit && hit.exp > Date.now()) return hit.user;
  let p = inflight.get(token);
  if (!p) {
    p = supabase.auth.getUser(token).then(({ data, error }) => {
      if (!data.user && error && ![400, 401, 403, 404].includes(error.status ?? 0)) throw Object.assign(new Error("Auth busy"), { busy: true });
      if (data.user) {
        if (tokens.size > 20000) tokens.clear();
        tokens.set(token, { user: data.user, exp: Date.now() + TTL });
      }
      return data.user;
    }).finally(() => inflight.delete(token));
    inflight.set(token, p);
  }
  if (opts.strict) return p;
  return p.catch(() => null);
}

/** Small per-instance cache for profile rows (role / team), 20 s. */
const profiles = new Map<string, { row: unknown; exp: number }>();
export async function cachedProfile<T>(userId: string, load: () => Promise<T | null>): Promise<T | null> {
  const hit = profiles.get(userId);
  if (hit && hit.exp > Date.now()) return hit.row as T;
  const row = await load();
  if (row) { if (profiles.size > 20000) profiles.clear(); profiles.set(userId, { row, exp: Date.now() + 20_000 }); }
  return row;
}
export function forgetProfile(userId: string) { profiles.delete(userId); }
