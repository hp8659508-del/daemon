# Local database simulation

Runs every migration against a throwaway local Postgres with a minimal Supabase stub,
seeds 50 teams / 200 participants, and lets you hammer the real SQL functions.

```bash
createdb daemon_sim
psql -d daemon_sim -f scripts/db-simulation/00_supabase_stub.sql
for f in purchase_auction_item spin_events_migration starting_points_publish_migration ui_rebuild_migration ui_v2_migration ui_v3_venues_migration ui_v4_password_status ui_v5_members_reset ui_v6_hardening; do psql -d daemon_sim -v ON_ERROR_STOP=1 -f supabase/$f.sql; done
psql -d daemon_sim -f scripts/db-simulation/10_seed.sql
psql -d daemon_sim -f supabase/ui_v3_venues_migration.sql -f supabase/ui_v5_members_reset.sql   # re-run allocation + secrets on seeded teams
pgbench -n -c 200 -j 8 -T 20 -f scripts/db-simulation/team_page_load.sql daemon_sim            # 200 team screens refreshing nonstop
```

Results on 2026-11-15 (8 vCPU): 0 failed, ~360 full team-page loads/s, avg 0.55 s under saturation.
Concurrency checks that passed: 30 parallel buyers on a qty-1 lot → exactly 1 sale; qty-3 → 3;
20 parallel buys on one team never go negative; 4 volunteers stamping the same bingo square → 1 stamp;
team delete with legacy spin records; organiser removal with authored ledger rows.
