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

## Admin features

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
