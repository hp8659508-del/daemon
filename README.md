# DAEMON HOUR

Next.js dashboard connected to the existing DAEMON HOUR Supabase project.

## Requirements

- Node.js 20.9 or later
- npm
- Access to the existing Supabase project

## Local setup

1. Extract the ZIP.
2. Copy `.env.example` to `.env.local` only if you do not already have a working `.env.local` file.
3. Configure these values in `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_OR_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SERVICE_ROLE_KEY
```

Keep the service-role key server-side only. Never prefix it with `NEXT_PUBLIC_`, put it in browser code, or share it. When updating an existing local installation, keep your existing `.env.local`; do not replace it with the example file.

Install and start the app:

```bash
npm install
npm run dev
```

Then open http://localhost:3000 and sign in with the existing administrator account.

## `ui` branch: Daemon Hour 2.0

**Before first run:** paste `supabase/ui_rebuild_migration.sql` into the Supabase SQL editor and run it once. It only adds columns and tables and is safe to re-run. It also turns off team-side buying and spinning, since organisers now record everything.

### Team leads (`/dashboard`)
- An instrument panel at the top: a hackathon countdown to **their own** deadline (base deadline ± power-ups), their points, their paddle number, and their rank if you choose to show it.
- Tabs: **Auction · Spin · Bingo · Loadout**. A round tab stays locked until an organiser opens it for that team. While open it is live. Once closed it freezes into a read-only record showing the points and deadline at the moment it closed.
- Auction: the current lot and its price update on screen as the auctioneer adjusts it, with an "afford / short by" hint. Also shows the full catalogue, the team's wins and a big paddle number to raise.
- Bingo: the uploaded card as a paper card. Stamps appear as club members clear dares, and completed lines are highlighted.
- Loadout: power-ups (including rival effects played on the team), a deadline timeline showing how each power-up moved their end time, and the full points ledger.
- The screen updates instantly over Supabase Realtime, falls back to polling, and refreshes when the window regains focus.

### Organisers (`/dashboard/control`), keys 1–7 switch tabs
1. **Rounds**: select teams (by bay, shift-click range, or all) and Open, Close or Reset any activity. Teams can be tagged with a venue bay.
2. **Auction**: lots with min, max and step prices and a quantity, optionally granting a power-up. The price is set on the block with −/+ keys and a slider and is pushed live to screens. Pick the winning paddle and hit **Sold** to buy on the team's behalf, with a balance check and an atomic database function. Any sale can be undone with a refund.
3. **Spin**: pick the team, then the segment the physical wheel landed on, then the target team for rival power-ups. Minutes can be overridden. Every result can be revoked.
4. **Bingo**: tap a square to stamp it for a team. Points and line bonuses are added or reversed automatically. Squares and their point values can be edited in place.
5. **Points**: give or deduct points for any selection of teams with a reason the teams can see. Bonus entries can be undone.
6. **Power-ups**: the catalogue (± minutes, self or rival, colour), manual grants, and a list of everything in play with **Use** and **Revoke** buttons.
7. **Event**: the official deadline, the announcement banner shown on all team screens, the bingo line bonus, leaderboard visibility and live standings.

## Admin features (legacy)

- **Teams:** open a team's activity page from the team list. The activity page now has a team selector and a combined newest-first history for transactions, auction purchases, digital spins, and physical spins.
- **Spin events:** create a draft wheel event with 2–30 outcomes, publish it to teams, and close it later. Outcome labels, point values, and relative weights are validated before saving. Database errors are surfaced in the admin interface to make failures easier to diagnose.
- **Physical spins:** select a team, record the result and notes, and optionally apply a whole-number point adjustment to that team's transaction ledger.
- **Auction items:** add and edit items, activate or hide them, and delete an item with a confirmation prompt. Items with no purchase history are permanently deleted; items with purchase history are archived to preserve linked records and can be activated again.

## Database safety

This project update does not reset, replace, or migrate your existing Supabase data. It does not automatically run SQL. The included SQL files are reference/inspection scripts; do not run a migration unless you have checked that it is intended for the current database.

The server-side admin routes use the service-role key. Keep it only in `.env.local` for local development or in your hosting provider's encrypted server environment settings. Database Row Level Security remains important and should continue to enforce team isolation.

## Updating an existing local copy

1. Stop the currently running development server with `Ctrl+C` in its terminal.
2. Make a backup copy of your current project folder.
3. Extract the updated ZIP into a new folder.
4. Copy your existing `.env.local` into the new `daemon-hour-work` folder. Do not send this file to anyone.
5. In the new folder, run `npm install` and then `npm run dev`.
6. Open http://localhost:3000 and test with the existing admin login and team accounts.

Your Supabase database is external to the project folder, so replacing the application code does not delete team accounts, points, purchases, or activity records.
