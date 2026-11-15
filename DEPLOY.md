# Deploying Daemon Hour (for the deploy agent)

Follow in order. Stop and report if any step fails.

## 1. Database (Supabase → SQL editor)
1. Paste the whole of `supabase/ALL_IN_ONE.sql` and run it. It is safe to run on any state of the
   database (fresh, older tables, half-applied migrations) and safe to run repeatedly.
2. The last statement prints a health report. Every row must say `OK`.
   - `realtime publication` not OK → Database → Replication → enable `supabase_realtime` for:
     transactions, purchases, team_stages, team_powerups, team_bingo, event_settings, activity_log, team_members, help_requests.
3. Authentication → Rate Limits → raise "sign-ins/sign-ups" to at least 300 per 5 min
   (all teams log in from the same campus Wi-Fi IP).

## 2. Build check (local)
```
npm ci
npm run build
```
Must finish with no errors. (There is no ESLint in this project; the build only type-checks.)

## 3. Vercel
- Framework: Next.js. Root: repo root. Branch: `ui`.
- Environment variables (Production + Preview):
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`  (server only, never NEXT_PUBLIC_)
  - `ADMIN_DELETE_PIN`           (password for deleting teams / reset; default 123)
- Settings → Functions → Region: the one closest to the Supabase project region (e.g. `bom1` for ap-south-1).

## 4. Smoke test after deploy
1. Host login → Control → Clock & event → **System check** → "All good".
2. Two team logins on two phones (one per venue) + one venue admin.
3. Open auction for one team → put a lot on the block → sell → team sees points drop within ~1 s.
4. Stamp a bingo square → team sees the stamp; tap again → removed.
5. Team taps **Need help** → red strip on the admin console → Done.
6. Reset that test team (Reset panel, password) → points back to start.
