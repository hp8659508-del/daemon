# DAEMON HOUR · Event-day runbook

## A. The night before (settings code can't change)

| # | Where | Set to | Why |
|---|---|---|---|
| 1 | Supabase → Authentication → **Sessions / JWT expiry** | **28800** (8 h) or more | Everyone signs in at the start. With the default 1 h, 1000 phones all renew their login in the same minute, an hour in. That's a hidden second "sign-in rush" mid-event. 8 h means no renewals during the event. |
| 2 | Supabase → Authentication → **Rate Limits** | Sign-ins/sign-ups and **token refreshes**: maximum allowed | Campus Wi-Fi = one internet address for everyone; the limits are per address. |
| 3 | Supabase → **Billing** | **Pro** for the event day (downgrade after) | More database + sign-in CPU, 250 GB data instead of 5 GB, daily backups. |
| 4 | Supabase → SQL editor | Run `ui_v14_resilience.sql`, then `select * from daemon_health();`, and every row should say OK | Smaller change-checks, phone clock correction. |
| 5 | Laptop | `npm run build` passes, then push; Vercel shows **Ready** on the newest commit | A failed build silently leaves the old version live. |
| 6 | Laptop | Run all load-test modes once more (watch 1000, login, propagation, quiz) | Proves this exact build. |

## B. Event morning

1. **Deploy freeze.** No pushes once doors open. (A deploy mid-event swaps the app under 1000 open screens.)
2. Open on a spare laptop and leave visible: **Supabase → Reports** (database CPU) and **Vercel → Logs** filtered to errors.
3. Test teams: sign in on 2 phones, check LIVE chip is green, give +1 / undo, watch it arrive.
4. **Sign-ins:** put "Sign in now" on the projector 10–15 min before the start, during the welcome. Tell everyone: *don't sign out, just keep the tab*.

## C. During the event

- **Before each round:** Teams tab → **Full backup** (downloads everything as a file).
- **Rapid Fire tab:** close it when you're not using it (it checks results every 15 s).
- **Database CPU above ~80% for a few minutes:** Supabase → Settings → Compute → upgrade one size (≈2 min, site stays up).
- **A phone shows OFFLINE · RETRYING:** its Wi-Fi dropped. It recovers by itself when the connection returns. Switching to mobile data helps.
- **A screen says "Reconnecting…":** wait; it retries by itself. Only if it stays more than a minute: reload.
- **Something is badly wrong after a change:** Vercel → Deployments → previous → **Instant Rollback** (10 s).

## D. What protects what (for reference)

| Risk | Protection |
|---|---|
| 1000 screens reloading at once | Screens reload only when *their* team or the event changed, spread over seconds; each team's data is loaded once per change and shared by teammates |
| Sign-in rush / rate limits | Login page retries for ~1 min with a "Busy · retrying" message; sessions last the whole day |
| Mid-event login renewal rush | JWT expiry 8 h (setting A1) |
| Supabase Auth overload (504) | Login checks verified once a minute per server, never in the middleware |
| Free-plan data allowance | Each change-check asks only for its own team (~150 bytes), checks every 6 s, pauses when the tab is hidden |
| Phone with the wrong clock | Countdown uses the server's clock |
| Wi-Fi drops | OFFLINE chip, automatic catch-up the moment the connection returns |
| Quiz answer lost on bad Wi-Fi | Each answer retries up to 5×; "saving…" shows until it's stored |
| Team added/removed during the quiz | Question shuffle is tied to team number, so nobody's paper changes |
| Old Android browsers | Fallbacks for newer CSS in the quiz |
| Phones' batteries over 6 h | Hourglasses draw at 15–30 fps, slower on weak phones, and stop when off-screen |
| Two admins clicking at once | Database locks: a lot sells once, a bingo box stamps once |
| Accidental wipe | Resets need the PIN; Full backup before each round |
| Crashes | Error screens retry by themselves; worst case the page reloads itself |
