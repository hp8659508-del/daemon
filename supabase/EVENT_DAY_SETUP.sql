-- ============================================================================
-- DAEMON HOUR · EVENT-DAY SETUP (one file). Run ONCE in the Supabase SQL editor,
-- BEFORE the auction starts. Every step is safe to re-run except the cleanup,
-- which wipes test cards/sales/penalties/bingo/ledgers (Rapid Fire is reloaded below).
--
--   1. ui_v13  change counters (1000-user build)        5. ui_v17  problem statement pool (30)
--   2. ui_v14  smaller change checks, clock fix         6. cleanup of all test data
--   3. ui_v15  separate auction wallet                  7. Rapid Fire scores + auction wallet = 1000
--   4. ui_v16  admin undo tools
--
-- Needs ui_v9 … ui_v12 already run (they were, if the site has cards, ledgers and Rapid Fire).
-- ============================================================================


-- >>>>>>>>>>>>>>>>>>>> ui_v13_scale.sql >>>>>>>>>>>>>>>>>>>>
-- ============================================================================
-- DAEMON HOUR · v13 — built for 1000+ screens. Run AFTER ui_v12. Re-runnable.
--
-- Instead of every screen holding a realtime subscription (capped at 200 on the
-- free plan and heavy on the database), every change bumps a small version
-- counter. Screens poll one tiny, CDN-cached endpoint (/api/pulse) and reload
-- only when *their* team's counter or the global counter moved.
-- The live auction price rides in the same tiny response.
-- ============================================================================

create table if not exists public.dh_versions (
  key text primary key,                 -- 'global' or a team id
  v bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.dh_versions enable row level security;
insert into public.dh_versions(key, v) values ('global', 1) on conflict do nothing;

create or replace function public.dh_bump_key(p_key text)
returns void language sql security definer set search_path = '' as $$
  insert into public.dh_versions(key, v, updated_at) values (p_key, 1, now())
  on conflict (key) do update set v = public.dh_versions.v + 1, updated_at = now()
$$;

-- team-scoped tables: bump that team (and the target team for rival power-ups)
create or replace function public.dh_bump_team() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r jsonb := to_jsonb(coalesce(new, old)); o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else null end; k text;
begin
  k := coalesce(r->>'team_id', case when tg_table_name = 'teams' then r->>'id' end);
  if k is not null then perform public.dh_bump_key(k); end if;
  if r ? 'target_team_id' and r->>'target_team_id' is not null then perform public.dh_bump_key(r->>'target_team_id'); end if;
  if tg_op = 'UPDATE' and tg_table_name <> 'teams' and o->>'team_id' is distinct from r->>'team_id' and o->>'team_id' is not null then
    perform public.dh_bump_key(o->>'team_id');
  end if;
  -- a sale changes what everyone's catalogue shows (sold / buyer), so it is global too
  if tg_table_name = 'purchases' then perform public.dh_bump_key('global'); end if;
  return null;
end $$;

-- global tables: everyone reloads (spread out by the client)
create or replace function public.dh_bump_global() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- the live auction price travels inside the pulse itself; changing it alone must not reload 1000 screens
  if tg_table_name = 'event_settings' and tg_op = 'UPDATE'
     and (to_jsonb(new) - 'live_lots' - 'updated_at') = (to_jsonb(old) - 'live_lots' - 'updated_at') then
    return null;
  end if;
  perform public.dh_bump_key('global');
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['transactions','team_powerups','team_bingo','team_cards','team_stages','purchases','penalties',
                           'team_members','help_requests','teams','quiz_runs','team_ledger'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists dh_pulse on public.%I', t);
      execute format('create trigger dh_pulse after insert or update or delete on public.%I for each row execute function public.dh_bump_team()', t);
    end if;
  end loop;
  foreach t in array array['event_settings','auction_items','powerups','bingo_cells','quiz_sections','quiz_questions'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists dh_pulse on public.%I', t);
      execute format('create trigger dh_pulse after insert or update or delete on public.%I for each row execute function public.dh_bump_global()', t);
    end if;
  end loop;
end $$;

-- the whole pulse in one round trip (optionally for one team: see ui_v14)
drop function if exists public.dh_pulse();
create or replace function public.dh_pulse(p_team uuid default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'v', coalesce((select jsonb_object_agg(key, v) from public.dh_versions
                    where p_team is null or key = 'global' or key = p_team::text), '{}'::jsonb),
    'lots', coalesce((select live_lots from public.event_settings where id = true), '{}'::jsonb),
    'at', now()
  )
$$;
-- browsers read the pulse straight from Supabase (no Vercel request per poll). It holds only
-- change counters and the live auction lot, nothing private.
revoke all on function public.dh_pulse(uuid) from public;
grant execute on function public.dh_pulse(uuid) to anon, authenticated, postgres, service_role;
revoke all on function public.dh_bump_key(text) from public, anon, authenticated;
grant all on public.dh_versions to postgres, service_role;

-- indexes for the quiz under load
create index if not exists quiz_flags_team_idx on public.quiz_flags(team_id);
create index if not exists quiz_answers_question_idx on public.quiz_answers(question_id);
create index if not exists team_bingo_team_idx on public.team_bingo(team_id);


-- >>>>>>>>>>>>>>>>>>>> ui_v14_resilience.sql >>>>>>>>>>>>>>>>>>>>
-- ============================================================================
-- DAEMON HOUR · v14 — resilience. Run AFTER ui_v13_scale.sql. Re-runnable.
-- The pulse can now be asked for ONE team: a phone gets ~150 bytes instead of every
-- team's counter (1000 phones × a poll every few seconds × hours adds up against the
-- free plan's 5 GB data allowance). It also returns the server time so phones with a
-- wrong clock still show the right countdown.
-- ============================================================================
drop function if exists public.dh_pulse();
create or replace function public.dh_pulse(p_team uuid default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'v', coalesce((select jsonb_object_agg(key, v) from public.dh_versions
                    where p_team is null or key = 'global' or key = p_team::text), '{}'::jsonb),
    'lots', coalesce((select live_lots from public.event_settings where id = true), '{}'::jsonb),
    'at', now()
  )
$$;
revoke all on function public.dh_pulse(uuid) from public;
grant execute on function public.dh_pulse(uuid) to anon, authenticated, postgres, service_role;


-- >>>>>>>>>>>>>>>>>>>> ui_v15_auction_wallet.sql >>>>>>>>>>>>>>>>>>>>
-- ============================================================================
-- DAEMON HOUR · v15 — separate AUCTION wallet. Run AFTER ui_v14_resilience.sql. Re-runnable.
--
--  • MAIN points  = the real score (Rapid Fire, Bingo, Spin, penalties, Points tab,
--                   and any card that GIVES points). Shown to teams and on the leaderboard.
--  • AUCTION points = a separate wallet only for paying for auction cards.
--                   Every team starts with the auction budget (default 1000) and it
--                   never mixes into main points.
-- ============================================================================

alter table public.transactions add column if not exists wallet text not null default 'main';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'transactions_wallet_check') then
    alter table public.transactions add constraint transactions_wallet_check check (wallet in ('main','auction'));
  end if;
end $$;
create index if not exists transactions_team_wallet_idx on public.transactions(team_id, wallet);

alter table public.event_settings add column if not exists auction_budget integer not null default 1000;

-- what teams already paid at the auction comes out of the auction wallet, not their score
update public.transactions set wallet = 'auction' where transaction_type = 'purchase' and wallet = 'main';

-- main points only (score, leaderboard, ledgers)
create or replace function public.team_balances()
returns table(team_id uuid, balance bigint) language sql stable security definer set search_path = '' as $$
  select team_id, coalesce(sum(points), 0)::bigint from public.transactions where wallet = 'main' group by team_id
$$;
create or replace function public.dh_pts(p_team uuid) returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum(points),0)::bigint from public.transactions where team_id = p_team and wallet = 'main'
$$;
-- auction wallet = budget + everything spent/refunded at the auction
create or replace function public.dh_auction_pts(p_team uuid) returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce((select auction_budget from public.event_settings where id = true), 1000)::bigint
       + coalesce((select sum(points) from public.transactions where team_id = p_team and wallet = 'auction'), 0)::bigint
$$;

-- selling: pays from the AUCTION wallet
create or replace function public.admin_sell_lot(p_item_id uuid, p_team_id uuid, p_price integer, p_admin uuid, p_cell integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_item public.auction_items%rowtype; v_wallet bigint; v_sold integer; v_tx uuid; v_purchase uuid; v_card uuid; v_pb bigint; v_mb integer;
begin
  perform 1 from public.teams where id = p_team_id for update;
  if not found then raise exception 'Team not found'; end if;
  select * into v_item from public.auction_items where id = p_item_id for update;
  if not found then raise exception 'Lot not found'; end if;
  if v_item.pool = 'spin' then raise exception 'That is a spin wheel segment, not an auction card.'; end if;
  if p_price is null or p_price < 0 then raise exception 'Invalid price'; end if;
  if v_item.min_price is not null and p_price < v_item.min_price then raise exception 'Price is below the minimum (%)', v_item.min_price; end if;
  if v_item.max_price is not null and p_price > v_item.max_price then raise exception 'Price is above the maximum (%)', v_item.max_price; end if;
  select count(*) into v_sold from public.purchases where item_id = p_item_id;
  if v_sold >= greatest(v_item.quantity, 1) then raise exception 'This slot is already sold. Use Copy to open another slot.'; end if;
  if v_item.kind = 'bingo' and coalesce(v_item.effect->>'mode','cell') <> 'column' and p_cell is null then
    raise exception 'Pick the bingo box this card covers.';
  end if;
  v_wallet := public.dh_auction_pts(p_team_id);
  if v_wallet < p_price then raise exception 'Team has only % auction points', v_wallet; end if;
  v_pb := public.dh_pts(p_team_id); v_mb := public.dh_mins(p_team_id);

  if p_price > 0 then
    insert into public.transactions(team_id, description, points, transaction_type, created_by, wallet)
    values (p_team_id, 'Auction: ' || v_item.item_name, -p_price, 'purchase', p_admin, 'auction') returning id into v_tx;
  end if;
  insert into public.purchases(team_id, item_id, transaction_id, purchase_price)
  values (p_team_id, p_item_id, v_tx, p_price) returning id into v_purchase;
  insert into public.team_cards(team_id, purchase_id, item_id, name, kind, effect, source, created_by)
  values (p_team_id, v_purchase, p_item_id, v_item.item_name, v_item.kind, v_item.effect, 'auction', p_admin) returning id into v_card;
  perform public.dh_apply_card(v_card, p_cell, p_admin);          -- a "+points" card adds to MAIN points
  perform public.dh_ledger(p_team_id, 'auction', v_item.item_name || ' (paid ' || p_price || ' auction pts)', v_pb, v_mb, v_card, p_admin);
  return jsonb_build_object('purchase_id', v_purchase, 'card_id', v_card, 'kind', v_item.kind, 'remaining', public.dh_auction_pts(p_team_id));
end $$;

do $$
declare f text;
begin
  foreach f in array array['team_balances()','dh_pts(uuid)','dh_auction_pts(uuid)','admin_sell_lot(uuid, uuid, integer, uuid, integer)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to postgres, service_role', f);
  end loop;
end $$;


-- >>>>>>>>>>>>>>>>>>>> ui_v16_admin_undo.sql >>>>>>>>>>>>>>>>>>>>
-- ============================================================================
-- DAEMON HOUR · v16 — admins can undo anything on a team. Run AFTER ui_v15. Re-runnable.
--   admin_card_remove   : take a card away (void the sale / undo the spin / undo a trump copy)
--   admin_card_unuse    : a "used" card becomes usable again (an undone swap swaps back)
--   admin_penalty_remove: delete a penalty and give back what it took
--   admin_ps_unlock     : make a swapped problem statement editable again
-- ============================================================================

-- swaps now remember who they swapped with (so they can be undone)
create or replace function public.admin_swap_ps(p_card uuid, p_target uuid, p_admin uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.team_cards%rowtype; a public.teams%rowtype; b public.teams%rowtype;
begin
  select * into c from public.team_cards where id = p_card for update;
  if not found or c.effect->>'perk' <> 'swap_ps' then raise exception 'Swap card not found'; end if;
  if c.status = 'spent' then raise exception 'This team has already used its swap.'; end if;
  if c.team_id = p_target then raise exception 'Pick a different team.'; end if;
  select * into a from public.teams where id = c.team_id for update;
  select * into b from public.teams where id = p_target for update;
  if b.id is null then raise exception 'Team not found'; end if;
  if coalesce(a.problem_statement,'') = '' or coalesce(b.problem_statement,'') = '' then raise exception 'Both teams need a problem statement logged first.'; end if;
  if a.ps_locked or b.ps_locked then raise exception 'One of these problem statements was already swapped and is final.'; end if;
  update public.teams set problem_statement = b.problem_statement, ps_locked = true where id = a.id;
  update public.teams set problem_statement = a.problem_statement, ps_locked = true where id = b.id;
  update public.team_cards set status = 'spent', spent_at = now(), detail = 'Swapped with ' || b.team_name,
    applied = applied || jsonb_build_object('swap_target', b.id) where id = p_card;
  insert into public.activity_log(team_id, kind, action, label, actor) values
    (a.id, 'auction', 'swapped', 'Problem statement swapped with ' || b.team_name, p_admin),
    (b.id, 'auction', 'swapped', 'Problem statement swapped by ' || a.team_name, p_admin);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_card_unuse(p_card uuid, p_admin uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.team_cards%rowtype; v_target uuid; a public.teams%rowtype; b public.teams%rowtype;
begin
  select * into c from public.team_cards where id = p_card for update;
  if not found then raise exception 'Card not found'; end if;
  if c.status <> 'spent' then raise exception 'This card isn''t marked as used.'; end if;
  if c.effect->>'perk' = 'swap_ps' then
    v_target := nullif(c.applied->>'swap_target', '')::uuid;
    if v_target is null then   -- older swaps: find the other team by name
      select id into v_target from public.teams where 'Swapped with ' || team_name = c.detail limit 1;
    end if;
    if v_target is not null then
      select * into a from public.teams where id = c.team_id for update;
      select * into b from public.teams where id = v_target for update;
      update public.teams set problem_statement = b.problem_statement, ps_locked = false where id = a.id;
      update public.teams set problem_statement = a.problem_statement, ps_locked = false where id = b.id;
    end if;
  end if;
  update public.team_cards set status = 'held', spent_at = null, detail = null where id = p_card;
  insert into public.activity_log(team_id, kind, action, label, actor) values (c.team_id, 'auction', 'reset', 'Card made usable again: ' || c.name, p_admin);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_card_remove(p_card uuid, p_admin uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.team_cards%rowtype;
begin
  select * into c from public.team_cards where id = p_card for update;
  if not found then raise exception 'Card not found'; end if;
  if c.status = 'spent' then perform public.admin_card_unuse(p_card, p_admin); end if;   -- undo its use first
  if c.source = 'auction' and c.purchase_id is not null then
    perform public.admin_undo_sale(c.purchase_id);          -- refunds the auction wallet + undoes effects (and any trump copy)
  else
    perform public.dh_revert_card(p_card, p_admin);          -- spin result / trump copy / manual
  end if;
  -- a trump copy removed on its own: the trump card goes back to "choose a card"
  if c.source = 'trump' and c.purchase_id is not null then
    update public.team_cards set status = 'pending', detail = 'Choose which card it copies'
     where purchase_id = c.purchase_id and kind = 'trump' and status = 'resolved';
  end if;
  insert into public.activity_log(team_id, kind, action, label, actor) values (c.team_id, 'auction', 'removed', 'Card removed by an organiser: ' || c.name, p_admin);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_penalty_remove(p_id uuid, p_admin uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.penalties%rowtype;
begin
  select * into p from public.penalties where id = p_id for update;
  if not found then raise exception 'Penalty not found'; end if;
  if p.landed_team_id is not null then
    -- what it took from the team that received it (written within seconds of the penalty)
    delete from public.transactions where team_id = p.landed_team_id and description = 'Penalty: ' || p.reason
       and created_at between p.created_at - interval '10 seconds' and p.created_at + interval '10 seconds';
    delete from public.team_powerups where team_id = p.landed_team_id and name = 'Penalty: ' || p.reason
       and created_at between p.created_at - interval '10 seconds' and p.created_at + interval '10 seconds';
    delete from public.team_ledger where team_id = p.landed_team_id and round = 'penalty' and label = 'Penalty: ' || p.reason
       and created_at between p.created_at - interval '10 seconds' and p.created_at + interval '10 seconds';
  end if;
  delete from public.penalties where id = p_id;
  insert into public.activity_log(team_id, kind, action, label, actor) values (p.team_id, 'penalty', 'removed', 'Penalty removed: ' || p.reason, p_admin);
  return jsonb_build_object('ok', true, 'note', 'Shield cards used by this penalty stay used: use "Make usable again" on them if needed.');
end $$;

create or replace function public.admin_ps_unlock(p_team uuid)
returns void language sql security definer set search_path = '' as $$
  update public.teams set ps_locked = false where id = p_team
$$;

do $$
declare f text;
begin
  foreach f in array array['admin_swap_ps(uuid, uuid, uuid)','admin_card_unuse(uuid, uuid)','admin_card_remove(uuid, uuid)','admin_penalty_remove(uuid, uuid)','admin_ps_unlock(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to postgres, service_role', f);
  end loop;
end $$;


-- >>>>>>>>>>>>>>>>>>>> ui_v17_ps_pool.sql >>>>>>>>>>>>>>>>>>>>
-- ============================================================================
-- DAEMON HOUR · v17 — PROBLEM STATEMENT POOL (30). Run AFTER ui_v16. Re-runnable.
--  • problem_statements: the 30, written for beginners (goal, must-build steps, bonus, hint)
--  • admins allot one per team from the pool; teams see number + full description
--  • a swap moves the pool number too
-- ============================================================================
create table if not exists public.problem_statements (
  no integer primary key,
  title text not null,
  goal text not null,
  build jsonb not null default '[]'::jsonb,
  bonus text,
  hint text
);
alter table public.problem_statements enable row level security;
grant all on public.problem_statements to postgres, service_role;
alter table public.teams add column if not exists ps_no integer references public.problem_statements(no) on delete set null;

insert into public.problem_statements(no, title, goal, build, bonus, hint) values
  (1, 'Charge Coach', 'While the phone charges, show how fast it is charging and warn at 80% to protect the battery.', '["Show the battery % and whether the phone is charging, updating live", "Every minute, work out how much % was gained and label it Fast / Normal / Slow", "When the battery reaches 80% while charging, show an alert: “Unplug now to protect your battery”"]'::jsonb, 'Show “time to full” based on the current speed.', 'BroadcastReceiver for ACTION_BATTERY_CHANGED (level, plugged).'),
  (2, 'Drain Detective', 'Track how fast the battery drops and show which hour drained the most.', '["Save the battery % with the time, every 15 minutes while the app is open (or with a Save button)", "Show the saved readings as a list or a simple bar chart", "Highlight the “worst drain hour”: the hour with the biggest % drop"]'::jsonb, 'Keep recording in the background with WorkManager.', 'BatteryManager for the level; SharedPreferences or Room to save readings.'),
  (3, 'Unplug Reminder', 'Nag the user to unplug when the phone has been at 100% on the charger for too long.', '["Detect “charging AND battery at 100%” and start a timer", "After a set time (e.g. 2 minutes for the demo), play a loud, annoying alarm and show “Battery full: UNPLUG NOW”", "The alarm stops only when the charger is unplugged", "Count and show total “overcharge minutes saved”"]'::jsonb, 'Let the user choose the delay and the alarm sound.', 'ACTION_BATTERY_CHANGED + ACTION_POWER_DISCONNECTED; MediaPlayer for the alarm.'),
  (4, 'Heat Guard', 'Watch the battery temperature and warn when the phone gets too hot.', '["Show the battery temperature in °C, updating live", "Let the user set a limit (e.g. 40 °C)", "Above the limit, show a warning: “Your phone is hot: stop gaming or charging”", "Keep a list of every time it went over the limit (time + temperature)"]'::jsonb, 'Colour the temperature green / orange / red.', 'ACTION_BATTERY_CHANGED gives EXTRA_TEMPERATURE in tenths of a degree.'),
  (5, 'Wi-Fi Signal Mapper', 'Find the best and worst Wi-Fi spots in a building.', '["Show the current Wi-Fi signal strength (bars or dBm)", "A “Save spot” button that asks for a room name and saves it with the signal", "List all saved rooms sorted from strongest to weakest", "Mark the best room and the worst room clearly"]'::jsonb, 'Show a colour bar for each room.', 'WifiManager.getConnectionInfo().rssi (needs location permission on newer Android).'),
  (6, 'Speed Snapshot', 'Test internet speed and find the user’s fastest time of day.', '["A “Test now” button that downloads one small file and times it", "Show the speed in Mbps", "Save every result with the time of day", "Show “Your fastest hour” from the saved results"]'::jsonb, 'Draw the results as a simple chart.', 'Download a fixed-size file (e.g. 1–5 MB) with HttpURLConnection/OkHttp and time it.'),
  (7, 'Notification Noise Meter', 'Count which apps send the most notifications.', '["Ask for notification access with a clear explanation screen", "Count notifications per app while the app is allowed to listen", "Show a ranked list: “noisiest” app at the top, with its count"]'::jsonb, 'Show today’s total and a “quietest app” award.', 'NotificationListenerService (user enables it in Settings).'),
  (8, 'Permission Watchdog', 'Show which installed apps can use the camera, microphone or location.', '["List installed apps that request Camera, Microphone or Location", "Show small icons for which of the three each app has", "Flag apps that “probably shouldn’t need it” (e.g. a calculator with microphone access)"]'::jsonb, 'Tap an app to open its Settings page.', 'PackageManager.getInstalledPackages(GET_PERMISSIONS) → requestedPermissions.'),
  (9, 'App Update Age', 'Find apps that haven’t been updated in a long time, a security check.', '["List installed apps with their last update date", "Sort with the oldest first", "Mark apps not updated for 90+ days as “Needs attention”", "Show a score: “X of Y apps are up to date”"]'::jsonb, 'Button to open the app’s Play Store page.', 'PackageInfo.lastUpdateTime from PackageManager.'),
  (10, 'Data Budget Buddy', 'Set a daily mobile-data limit and warn the user before they cross it.', '["Let the user set a daily limit in MB", "Show mobile data used today as a progress ring", "Alert at 80% of the limit and again at 100%"]'::jsonb, 'Remember the last 7 days and show them as bars.', 'TrafficStats.getMobileRxBytes()/getMobileTxBytes(); save today’s starting value.'),
  (11, 'Night Owl Tracker', 'Track late-night phone use and give a “sleep disturbance” score.', '["Record each time the screen turns on between 11 PM and 6 AM", "Show tonight’s count and total minutes", "Turn it into a simple score out of 100 (more night use = lower score)"]'::jsonb, 'Show the last 7 nights as a chart.', 'Register for ACTION_SCREEN_ON / ACTION_SCREEN_OFF while the app (or a service) runs.'),
  (12, 'Data Hog Alert', 'Spot an app using a lot of mobile data and warn the user.', '["Ask for usage access with a clear explanation screen", "Show mobile data used per app in the last hour, highest first", "Alert when any app uses more than a set amount (e.g. 50 MB) in that hour"]'::jsonb, 'Let the user “ignore” trusted apps.', 'NetworkStatsManager.querySummary (needs Usage Access in Settings).'),
  (13, 'Charger Roulette', 'Grade each charger or cable by how fast it charges.', '["When plugged in, measure how much % is gained in a short test (e.g. 3–5 minutes)", "Turn the speed into a grade from A (fast) to F (slow)", "Save the result with a name the user types (“Bedroom cable”)", "Show all chargers with their grades, best first"]'::jsonb, 'Re-test a charger and show if it got better or worse.', 'ACTION_BATTERY_CHANGED level + a timer while plugged in.'),
  (14, 'Ghost Drain Hunter', 'Find out how much battery the phone loses while the screen is off.', '["Note the battery % and time when the screen turns off", "Note them again when the screen turns on", "Show the % lost per hour while the screen was off", "Flag “Something is draining your phone in your pocket” above a set rate"]'::jsonb, 'Keep a history of each screen-off period.', 'ACTION_SCREEN_OFF / ACTION_SCREEN_ON + battery level.'),
  (15, 'Pick-Up Reflex', 'Measure how quickly the user reacts to a notification, a “how hooked are you?” score.', '["The app sends its own test notification at a random moment", "Measure the time until the user taps it", "Show the reaction time and a label: “Lightning”, “Normal”, “Calm”", "Keep a list of past results and the average"]'::jsonb, 'A 5-round “challenge mode” with a final score.', 'NotificationCompat + a PendingIntent that opens the app; compare timestamps.'),
  (16, 'Phone Age Report', 'Make one shareable “report card” about the user’s phone.', '["Show the phone model, Android version and storage used/free", "Show the oldest app’s install date as “phone in use since”", "Show the battery health and temperature", "Put it all on one nice card with a “phone mood” emoji"]'::jsonb, 'A Share button that shares the card as an image.', 'Build.MODEL, StatFs for storage, PackageInfo.firstInstallTime, battery intent.'),
  (17, 'Fast Drain Alarm', 'Alert when the battery drops too fast.', '["Let the user set a rule, e.g. “more than 10% in 1 hour”", "Check the battery % regularly while the app runs", "Alert when the rule is broken, showing how fast it dropped"]'::jsonb, 'Name the app most used in that hour (usage access).', 'Battery level readings over time; UsageStatsManager for the bonus.'),
  (18, 'Clock Drift Checker', 'Check how many seconds the phone’s clock is off from real internet time.', '["Fetch the current time from an internet time API", "Compare it with the phone’s clock and show “X seconds fast/slow”", "Save each check with the date to show a history"]'::jsonb, 'Colour the result green if under 2 seconds.', 'Any public time API over HTTPS (e.g. worldtimeapi.org); compare with System.currentTimeMillis().'),
  (19, 'Touch Test Lab', 'Help users find dead pixels and dead touch areas on their screen.', '["A full-screen colour test: tap to switch between red, green, blue, white and black", "A touch grid: each square lights up when the finger passes over it", "Show how many squares were reached, and mark the ones never touched"]'::jsonb, 'A “Pass / Check again” result screen.', 'A custom View with onTouchEvent; no permissions needed.'),
  (20, 'Shake Meter', 'Measure how hard and how often the phone is shaken.', '["Show live shake strength from the motion sensor", "Count each shake above a threshold", "Show the strongest shake of the session", "Save each session (shakes + strongest) to a history list"]'::jsonb, 'A 10-second “shake challenge” with a high score.', 'SensorManager + TYPE_ACCELEROMETER; strength = √(x²+y²+z²) − gravity.'),
  (21, 'QR Safety Scanner', 'Scan a QR code and warn if its link looks suspicious before opening it.', '["Scan a QR code with the camera", "Show the link it contains", "Flag warning signs: not HTTPS, IP address instead of a name, link shorteners, odd words like “login-verify”", "Buttons: “Open anyway” and “Don’t open”"]'::jsonb, 'Keep a history of scanned links with their verdict.', 'Google ML Kit barcode scanning (or the ZXing library).'),
  (22, 'Photo Twin Finder', 'Find exact duplicate photos.', '["Let the user pick a folder or several photos", "Compare files by size, then by a file hash, to find exact copies", "Show duplicates side by side with their sizes", "Show the total space that could be freed"]'::jsonb, 'Delete a chosen copy (with confirmation).', 'Photo picker / Storage Access Framework; MessageDigest (MD5) for the hash.'),
  (23, 'Website Response Checker', 'Check how fast a list of websites responds.', '["Let the user add website addresses to a list", "A “Check all” button that requests each site and times the response", "Show each site with its time in ms and a green / orange / red dot", "Mark the fastest and the slowest site"]'::jsonb, 'Show “down” for sites that don’t respond.', 'HttpURLConnection or OkHttp in a coroutine/thread; time each request.'),
  (24, 'Smart Brightness Advisor', 'Tell the user when their screen is brighter than the room needs.', '["Read the room’s light level from the light sensor", "Read the current screen brightness", "If the screen is much brighter than needed, suggest a lower level", "Show a simple “battery you could save” estimate"]'::jsonb, 'A one-tap button to apply the suggested brightness.', 'TYPE_LIGHT sensor; Settings.System.SCREEN_BRIGHTNESS to read brightness.'),
  (25, 'Compass Health Check', 'Show the compass direction and warn when magnets are disturbing it.', '["Show a live compass needle and the direction in degrees (N, E, S, W)", "Show the magnetic field strength", "Warn “Magnetic interference!” when the strength is unusual", "Show a “move your phone in a figure 8” instruction screen to recalibrate"]'::jsonb, 'Show when the reading becomes steady again.', 'TYPE_MAGNETIC_FIELD + TYPE_ACCELEROMETER with SensorManager.getRotationMatrix.'),
  (26, 'Deadline Collision Alert', 'Spot days when too many deadlines pile up.', '["Let the user add tasks with a name and a due date", "Show the tasks grouped by date", "Warn “Busy day!” on any date with 3 or more deadlines", "Show the next 7 days at a glance"]'::jsonb, 'A reminder notification the day before a busy day.', 'DatePickerDialog + a list saved with Room or SharedPreferences.'),
  (27, 'Network Info Detective', 'Show the details of the current internet connection in one place.', '["Show whether the phone is on Wi-Fi, mobile data or offline", "For Wi-Fi: show the network name, IP address, signal strength and link speed", "Update the screen when the connection changes"]'::jsonb, 'A Copy button for the details.', 'ConnectivityManager + WifiManager.getConnectionInfo() (location permission for the name).'),
  (28, 'Sunlight Exposure Monitor', 'Track how much bright light the user gets during the day.', '["Show the live light level from the light sensor", "Label it Dark / Indoor / Bright / Sunlight", "Count the minutes spent in each label while the app runs", "Show a simple daily summary"]'::jsonb, 'An alert after a long time in the dark: “Go get some sunlight!”', 'SensorManager + TYPE_LIGHT (lux).'),
  (29, 'Duplicate Contact Finder', 'Find contacts saved more than once.', '["Ask for contacts permission", "Read all contacts with their phone numbers", "Group contacts that share the same number (ignore spaces and +91)", "Show each group of duplicates"]'::jsonb, 'Also match very similar names.', 'ContactsContract with a ContentResolver query.'),
  (30, 'Parking Spot Saver', 'Save where the vehicle is parked and help the user walk back to it.', '["A “Save my parking spot” button that saves the GPS location and time", "Show the saved spot and how long ago it was saved", "Show the distance to the car from where the user is now", "A “Navigate” button that opens Google Maps to the spot"]'::jsonb, 'Add a note or photo (“Level 2, pillar B”).', 'FusedLocationProviderClient; Location.distanceTo(); a geo: intent for Maps.')
on conflict (no) do update set title = excluded.title, goal = excluded.goal, build = excluded.build, bonus = excluded.bonus, hint = excluded.hint;

-- swaps (and undoing them) carry the pool number along with the text
create or replace function public.admin_swap_ps(p_card uuid, p_target uuid, p_admin uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.team_cards%rowtype; a public.teams%rowtype; b public.teams%rowtype;
begin
  select * into c from public.team_cards where id = p_card for update;
  if not found or c.effect->>'perk' <> 'swap_ps' then raise exception 'Swap card not found'; end if;
  if c.status = 'spent' then raise exception 'This team has already used its swap.'; end if;
  if c.team_id = p_target then raise exception 'Pick a different team.'; end if;
  select * into a from public.teams where id = c.team_id for update;
  select * into b from public.teams where id = p_target for update;
  if b.id is null then raise exception 'Team not found'; end if;
  if coalesce(a.problem_statement,'') = '' or coalesce(b.problem_statement,'') = '' then raise exception 'Both teams need a problem statement allotted first.'; end if;
  if a.ps_locked or b.ps_locked then raise exception 'One of these problem statements was already swapped and is final.'; end if;
  update public.teams set problem_statement = b.problem_statement, ps_no = b.ps_no, ps_locked = true where id = a.id;
  update public.teams set problem_statement = a.problem_statement, ps_no = a.ps_no, ps_locked = true where id = b.id;
  update public.team_cards set status = 'spent', spent_at = now(), detail = 'Swapped with ' || b.team_name,
    applied = applied || jsonb_build_object('swap_target', b.id) where id = p_card;
  insert into public.activity_log(team_id, kind, action, label, actor) values
    (a.id, 'auction', 'swapped', 'Problem statement swapped with ' || b.team_name, p_admin),
    (b.id, 'auction', 'swapped', 'Problem statement swapped by ' || a.team_name, p_admin);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_card_unuse(p_card uuid, p_admin uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.team_cards%rowtype; v_target uuid; a public.teams%rowtype; b public.teams%rowtype;
begin
  select * into c from public.team_cards where id = p_card for update;
  if not found then raise exception 'Card not found'; end if;
  if c.status <> 'spent' then raise exception 'This card isn''t marked as used.'; end if;
  if c.effect->>'perk' = 'swap_ps' then
    v_target := nullif(c.applied->>'swap_target', '')::uuid;
    if v_target is null then select id into v_target from public.teams where 'Swapped with ' || team_name = c.detail limit 1; end if;
    if v_target is not null then
      select * into a from public.teams where id = c.team_id for update;
      select * into b from public.teams where id = v_target for update;
      update public.teams set problem_statement = b.problem_statement, ps_no = b.ps_no, ps_locked = false where id = a.id;
      update public.teams set problem_statement = a.problem_statement, ps_no = a.ps_no, ps_locked = false where id = b.id;
    end if;
  end if;
  update public.team_cards set status = 'held', spent_at = null, detail = null where id = p_card;
  insert into public.activity_log(team_id, kind, action, label, actor) values (c.team_id, 'auction', 'reset', 'Card made usable again: ' || c.name, p_admin);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.admin_swap_ps(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.admin_card_unuse(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_swap_ps(uuid, uuid, uuid) to postgres, service_role;
grant execute on function public.admin_card_unuse(uuid, uuid) to postgres, service_role;

-- pool content rarely changes, but if it does, screens should reload
do $$ begin
  if to_regprocedure('public.dh_bump_global()') is not null then
    drop trigger if exists dh_pulse on public.problem_statements;
    create trigger dh_pulse after insert or update or delete on public.problem_statements for each row execute function public.dh_bump_global();
  end if;
end $$;


-- >>>>>>>>>>>>>>>>>>>> cleanup_test_data.sql >>>>>>>>>>>>>>>>>>>>
-- ============================================================================
-- DAEMON HOUR · ONE-TIME CLEANUP of test data (run once, before the auction)
--
-- KEEPS:   teams, logins, members, venues, team numbers
--          Rapid Fire: questions, every team's answers and scores, and the Rapid Fire points
--          the auction cards (catalogue) and spin wheel segments, bingo squares, settings
-- REMOVES: every card a team holds (auction, spin, trump), every sale,
--          problem statements (+ swap locks), penalties, power-ups/time changes,
--          bingo stamps + row/column lock, round ledgers, help requests,
--          all points EXCEPT Rapid Fire, history EXCEPT Rapid Fire,
--          the live auction lot. Auction / Spin / Bingo rounds go back to "upcoming".
--
-- Step 1 (optional): select only the PREVIEW block below and run it to see what will go.
-- Step 2: run the whole file.
-- ============================================================================

-- PREVIEW ------------------------------------------------------------------
select 'cards held' as what, count(*) from public.team_cards
union all select 'auction sales', count(*) from public.purchases
union all select 'problem statements set', count(*) from public.teams where problem_statement is not null
union all select 'penalties', count(*) from public.penalties
union all select 'time changes', count(*) from public.team_powerups
union all select 'bingo stamps', count(*) from public.team_bingo
union all select 'points entries removed (not Rapid Fire)', count(*) from public.transactions where description not like 'Rapid fire:%'
union all select 'points entries kept (Rapid Fire)', count(*) from public.transactions where description like 'Rapid fire:%';

-- CLEANUP ------------------------------------------------------------------
begin;
  delete from public.team_cards;
  delete from public.purchases;
  delete from public.penalties;
  delete from public.team_powerups;
  delete from public.team_bingo;
  delete from public.team_ledger;
  delete from public.help_requests;
  delete from public.transactions where description not like 'Rapid fire:%';
  delete from public.activity_log where kind <> 'quiz';
  delete from public.team_stages where activity in ('auction', 'spin', 'bingo');
  update public.teams set problem_statement = null, ps_locked = false, bingo_mode = null;
  do $$ begin if exists (select 1 from information_schema.columns where table_schema='public' and table_name='teams' and column_name='ps_no') then update public.teams set ps_no = null; end if; end $$;
  update public.event_settings set live_lots = '{}'::jsonb, live_lot = null where id = true;
commit;

-- RESULT: every team's points should now equal its Rapid Fire score
select t.paddle as "#", t.team_name, coalesce(sum(x.points), 0) as points
from public.teams t left join public.transactions x on x.team_id = t.id and x.wallet = 'main'
group by t.paddle, t.team_name order by t.paddle nulls last;


-- >>>>>>>>>>>>>>>>>>>> load_rapid_fire_scores.sql >>>>>>>>>>>>>>>>>>>>
-- ============================================================================
-- DAEMON HOUR · load the recovered Rapid Fire scores + set up the auction wallet
-- Run in the Supabase SQL editor (after ui_v15_auction_wallet.sql). Safe to re-run:
-- it replaces any earlier Rapid Fire points instead of adding twice.
--
--  • MAIN points: each team's Rapid Fire score, dated 17 Nov 2026 between 4 and 5 pm IST
--    (shows in their Points and in the Round ledger → Rapid Fire tab)
--  • AUCTION wallet: 1000 for every team, used only in the auction
-- ============================================================================
begin;

create temp table rf(team text, correct int, points int) on commit drop;
insert into rf values
  ('AppVengers',             5, 100),
  ('Code berry',             4,  80),
  ('Codelulu',               5, 100),
  ('DBC',                    5, 100),
  ('Energy',                 5, 100),
  ('Alpha',                  3,  60),
  ('GPT Warriors',           1,  20),
  ('Immortals',              2,  40),
  ('Logic Legends',          5, 100),
  ('LoopX',                  3,  60),
  ('Quadra',                 5, 100),
  ('Quantum Crew',           4,  80),
  ('S⁴',                     4,  80),
  ('Straw Hats',             2,  40),
  ('Synergy',                5, 100),
  ('Team Raju',              4,  80),
  ('Techies',                5, 100),
  ('Teen-Bhai-Teeno-tabahi', 4,  80),
  ('The Outliers',           5, 100),
  ('Velocity Build',         5, 100);

-- stop if any name doesn't match a team on the site (nothing is changed)
do $$
declare missing text;
begin
  select string_agg(r.team, ', ') into missing from rf r
   where not exists (select 1 from public.teams t where lower(trim(t.team_name)) = lower(trim(r.team)));
  if missing is not null then raise exception 'These names are not on the site (fix the spelling above): %', missing; end if;
end $$;

-- replace any earlier Rapid Fire points / history
delete from public.transactions where description like 'Rapid fire:%';
delete from public.activity_log where kind = 'quiz' and action = 'granted';

-- add each score at a time between 16:00 and 17:00 IST on 17 Nov (spread in team order)
with x as (
  select t.id as team_id, r.correct, r.points,
         timestamptz '2026-11-17 16:05:00+05:30' + (row_number() over (order by t.paddle nulls last, t.team_name) * interval '2 minutes 20 seconds') as at
  from rf r join public.teams t on lower(trim(t.team_name)) = lower(trim(r.team))
), tx as (
  insert into public.transactions(team_id, description, points, transaction_type, created_at, wallet)
  select team_id, 'Rapid fire: Workshop quiz (' || correct || '/5 correct)', points, 'bonus', at, 'main' from x
  returning team_id
)
insert into public.activity_log(team_id, kind, action, label, points, created_at)
select team_id, 'quiz', 'granted', 'Rapid fire · Workshop quiz: ' || correct || '/5 correct', points, at from x;

-- auction: 1000 for everyone, nothing spent yet
update public.event_settings set auction_budget = 1000 where id = true;
delete from public.transactions t where t.wallet = 'auction' and not exists (select 1 from public.purchases p where p.transaction_id = t.id);

commit;

-- RESULT: check this list
select t.paddle as "site #", t.team_name,
       coalesce((select sum(points) from public.transactions x where x.team_id = t.id and x.description like 'Rapid fire:%'), 0) as rapid_fire,
       coalesce((select sum(points) from public.transactions x where x.team_id = t.id and x.wallet = 'main'), 0) as main_points,
       public.dh_auction_pts(t.id) as auction_wallet
from public.teams t order by t.paddle nulls last;
