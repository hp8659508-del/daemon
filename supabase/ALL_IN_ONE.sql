-- DAEMON HOUR · ALL-IN-ONE database setup / repair. Paste into the Supabase SQL editor and run.
-- Safe to run any number of times. Ends by printing a health report: every row should say OK.

-- ======================= ui_v7_schema_doctor.sql =======================
-- ============================================================================
-- DAEMON HOUR · v7 — SCHEMA DOCTOR
-- Brings every table the app uses to exactly the shape the code expects,
-- whatever state the database is in (older tables from earlier versions,
-- half-applied migrations, legacy NOT NULL columns, missing unique keys).
-- Safe to run any number of times, before or after the other migrations.
-- ============================================================================

-- 1. Every column the app reads or writes ------------------------------------
do $$
declare
  spec text[][] := array[
    -- table, column, type + default
    ['teams','bay','text'], ['teams','paddle','integer'], ['teams','password_changed_at','timestamptz'],
    ['profiles','venue','text'], ['profiles','must_change_password','boolean not null default false'],
    ['auction_items','min_price','integer'], ['auction_items','max_price','integer'], ['auction_items','price_step','integer not null default 10'],
    ['auction_items','quantity','integer not null default 1'], ['auction_items','description','text'], ['auction_items','powerup_id','uuid'],
    ['auction_items','is_active','boolean not null default true'], ['auction_items','base_points','integer not null default 0'],
    ['team_stages','opened_at','timestamptz'], ['team_stages','closed_at','timestamptz'], ['team_stages','closing_points','integer'], ['team_stages','closing_end_at','timestamptz'],
    ['powerups','description','text'], ['powerups','minutes_delta','integer not null default 0'], ['powerups','targets_rival','boolean not null default false'],
    ['powerups','color','text not null default ''cyan'''], ['powerups','is_active','boolean not null default true'], ['powerups','created_at','timestamptz not null default now()'],
    ['team_powerups','powerup_id','uuid'], ['team_powerups','name','text'], ['team_powerups','minutes_delta','integer not null default 0'], ['team_powerups','target_team_id','uuid'],
    ['team_powerups','source','text not null default ''manual'''], ['team_powerups','note','text'], ['team_powerups','used','boolean not null default false'],
    ['team_powerups','purchase_id','uuid'], ['team_powerups','created_by','uuid'], ['team_powerups','created_at','timestamptz not null default now()'],
    ['bingo_cells','idx','integer'], ['bingo_cells','label','text'], ['bingo_cells','points','integer not null default 10'], ['bingo_cells','is_free','boolean not null default false'],
    ['team_bingo','idx','integer'], ['team_bingo','marked_by','uuid'], ['team_bingo','marked_at','timestamptz not null default now()'],
    ['team_members','role','text not null default ''member'''], ['team_members','full_name','text'], ['team_members','usn','text'], ['team_members','department','text'],
    ['team_members','year','text'], ['team_members','phone','text'], ['team_members','email','text'], ['team_members','college','text'],
    ['team_members','checked_in','boolean not null default false'], ['team_members','created_at','timestamptz not null default now()'],
    ['activity_log','minutes','integer'], ['activity_log','points','integer'], ['activity_log','actor','uuid'],
    ['help_requests','message','text'], ['help_requests','status','text not null default ''open'''], ['help_requests','resolved_at','timestamptz'],
    ['team_secrets','password','text'], ['team_secrets','source','text not null default ''default'''], ['team_secrets','updated_at','timestamptz not null default now()'],
    ['event_settings','hackathon_end_at','timestamptz'], ['event_settings','hackathon_started_at','timestamptz'], ['event_settings','clock_paused_at','timestamptz'],
    ['event_settings','live_lot','jsonb'], ['event_settings','live_lots','jsonb not null default ''{}''::jsonb'], ['event_settings','broadcast','text'],
    ['event_settings','broadcasts','jsonb not null default ''{}''::jsonb'], ['event_settings','bingo_line_bonus','integer not null default 50'],
    ['event_settings','bingo_full_bonus','integer not null default 100'], ['event_settings','bingo_rewards','jsonb not null default ''{}''::jsonb'],
    ['event_settings','leaderboard_visible','boolean not null default false'], ['event_settings','portal_locked','boolean not null default false'],
    ['event_settings','portal_message','text'], ['event_settings','starting_points','integer not null default 0']
  ];
  i int;
begin
  for i in 1..array_length(spec, 1) loop
    if to_regclass('public.' || spec[i][1]) is not null then
      execute format('alter table public.%I add column if not exists %I %s', spec[i][1], spec[i][2], spec[i][3]);
    end if;
  end loop;
end $$;

-- 2. Carry data over from older column names --------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='team_bingo' and column_name='cell_index') then
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='team_bingo' and column_name='completed') then
      execute 'delete from public.team_bingo where completed is false';
    end if;
    execute 'update public.team_bingo set idx = cell_index where idx is null';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='team_members' and column_name='member_name') then
    execute 'update public.team_members set full_name = member_name where full_name is null';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='team_members' and column_name='member_order') then
    execute 'update public.team_members set role = ''lead'' where member_order = 1 and not exists (select 1 from public.team_members m2 where m2.team_id = team_members.team_id and m2.role = ''lead'')';
  end if;
  if to_regclass('public.team_bingo') is not null then delete from public.team_bingo where idx is null; end if;
  if to_regclass('public.team_members') is not null then update public.team_members set full_name = 'Member' where full_name is null or trim(full_name) = ''; end if;
  if to_regclass('public.team_powerups') is not null then update public.team_powerups set name = 'Power-up' where name is null; end if;
end $$;

-- 3. Older NOT NULL columns the app never writes must not block inserts -------
do $$
declare r record;
  known text[] := array[
    'teams.id','teams.team_name','teams.username',
    'profiles.id','profiles.role',
    'transactions.id','transactions.team_id','transactions.description','transactions.points','transactions.transaction_type',
    'auction_items.id','auction_items.item_name',
    'purchases.id','purchases.team_id','purchases.item_id','purchases.purchase_price',
    'team_stages.team_id','team_stages.activity','team_stages.status',
    'powerups.id','powerups.name',
    'team_powerups.id','team_powerups.team_id','team_powerups.source',
    'bingo_cells.idx','bingo_cells.label',
    'team_bingo.team_id','team_bingo.idx',
    'team_members.id','team_members.team_id','team_members.role','team_members.full_name',
    'activity_log.id','activity_log.kind','activity_log.action','activity_log.label',
    'help_requests.id','help_requests.team_id','help_requests.status',
    'team_secrets.team_id','event_settings.id'];
begin
  for r in
    select c.table_name, c.column_name from information_schema.columns c
    where c.table_schema = 'public' and c.is_nullable = 'NO' and c.column_default is null
      and c.table_name in ('teams','profiles','transactions','auction_items','purchases','team_stages','powerups','team_powerups',
                           'bingo_cells','team_bingo','team_members','activity_log','help_requests','team_secrets','event_settings')
      and (c.table_name || '.' || c.column_name) <> all(known)
      and not exists (  -- leave primary-key columns alone
        select 1 from pg_index ix join pg_attribute a on a.attrelid = ix.indrelid and a.attnum = any(ix.indkey)
        where ix.indrelid = ('public.' || c.table_name)::regclass and ix.indisprimary and a.attname = c.column_name)
  loop
    execute format('alter table public.%I alter column %I drop not null', r.table_name, r.column_name);
    raise notice 'relaxed legacy NOT NULL: %.%', r.table_name, r.column_name;
  end loop;
end $$;

-- 4. Unique keys the app relies on (upserts / one-per-team rules) -------------
do $$
begin
  if to_regclass('public.team_stages') is not null then
    delete from public.team_stages a using public.team_stages b where a.ctid < b.ctid and a.team_id = b.team_id and a.activity = b.activity;
    create unique index if not exists team_stages_team_activity_key on public.team_stages(team_id, activity);
  end if;
  if to_regclass('public.team_bingo') is not null then
    delete from public.team_bingo a using public.team_bingo b where a.ctid < b.ctid and a.team_id = b.team_id and a.idx = b.idx;
    create unique index if not exists team_bingo_team_idx_key on public.team_bingo(team_id, idx);
  end if;
  if to_regclass('public.bingo_cells') is not null then
    delete from public.bingo_cells a using public.bingo_cells b where a.ctid < b.ctid and a.idx = b.idx;
    create unique index if not exists bingo_cells_idx_key on public.bingo_cells(idx);
  end if;
  if to_regclass('public.team_secrets') is not null then
    create unique index if not exists team_secrets_team_key on public.team_secrets(team_id);
  end if;
  if to_regclass('public.event_settings') is not null and not exists (select 1 from public.event_settings) then
    insert into public.event_settings default values;
  end if;
end $$;

-- 5. Service role can always reach everything ---------------------------------
grant usage on schema public to postgres, service_role;
grant all on all tables in schema public to postgres, service_role;
grant all on all sequences in schema public to postgres, service_role;
grant execute on all functions in schema public to postgres, service_role;

-- 6. Health report: run this after; every row should say OK ------------------
-- select * from public.daemon_health();
create or replace function public.daemon_health()
returns table(item text, status text) language plpgsql security definer set search_path = '' as $$
declare t text; f text;
begin
  foreach t in array array['teams','profiles','transactions','auction_items','purchases','team_stages','powerups','team_powerups',
                           'bingo_cells','team_bingo','team_members','activity_log','help_requests','team_secrets','event_settings'] loop
    item := 'table ' || t; status := case when to_regclass('public.' || t) is null then 'MISSING' else 'OK' end; return next;
  end loop;
  foreach f in array array['admin_sell_lot','admin_undo_sale','admin_toggle_bingo','admin_set_bingo','team_balances','is_staff','current_team_id'] loop
    item := 'function ' || f; status := case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = f) then 'OK' else 'MISSING' end; return next;
  end loop;
  item := 'bingo squares'; status := (select case when count(*) = 25 then 'OK' else count(*) || ' of 25' end from public.bingo_cells); return next;
  item := 'event settings row'; status := case when exists (select 1 from public.event_settings) then 'OK' else 'MISSING' end; return next;
  item := 'realtime publication'; status := (select case when count(*) >= 6 then 'OK' else count(*) || ' tables published' end
    from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename in ('transactions','purchases','team_stages','team_powerups','team_bingo','event_settings','activity_log','team_members','help_requests')); return next;
end $$;
revoke all on function public.daemon_health() from public, anon, authenticated;
grant execute on function public.daemon_health() to postgres, service_role;

-- ======================= purchase_auction_item.sql =======================
-- Run once in the Supabase SQL Editor.
-- Each successful purchase writes both a purchases row and a negative
-- transactions ledger row in one database transaction.

CREATE OR REPLACE FUNCTION public.purchase_auction_item(p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_team_id uuid;
  v_role text;
  v_item public.auction_items%ROWTYPE;
  v_balance bigint;
  v_purchase_id uuid;
  v_transaction_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Please sign in';
  END IF;

  SELECT role, team_id INTO v_role, v_team_id
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_role <> 'team' OR v_team_id IS NULL THEN
    RAISE EXCEPTION 'Only team accounts can purchase items';
  END IF;

  -- Serialize purchases for the same team to prevent simultaneous overspending.
  PERFORM 1 FROM public.teams WHERE id = v_team_id FOR UPDATE;

  SELECT * INTO v_item
  FROM public.auction_items
  WHERE id = p_item_id AND is_active = true
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item unavailable';
  END IF;

  IF v_item.base_points IS NULL OR v_item.base_points <= 0 THEN
    RAISE EXCEPTION 'Item unavailable';
  END IF;

  SELECT COALESCE(SUM(points), 0)::bigint INTO v_balance
  FROM public.transactions
  WHERE team_id = v_team_id;

  IF v_balance < v_item.base_points THEN
    RAISE EXCEPTION 'Insufficient points';
  END IF;

  INSERT INTO public.transactions (team_id, description, points, transaction_type, created_by)
  VALUES (
    v_team_id,
    'Auction purchase: ' || v_item.item_name,
    -v_item.base_points,
    'purchase',
    v_user_id
  )
  RETURNING id INTO v_transaction_id;

  INSERT INTO public.purchases (team_id, item_id, transaction_id, purchase_price)
  VALUES (v_team_id, v_item.id, v_transaction_id, v_item.base_points)
  RETURNING id INTO v_purchase_id;

  RETURN jsonb_build_object(
    'purchase_id', v_purchase_id,
    'item_id', v_item.id,
    'item_name', v_item.item_name,
    'purchase_price', v_item.base_points,
    'remaining_points', v_balance - v_item.base_points
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purchase_auction_item(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purchase_auction_item(uuid) TO authenticated;

-- ======================= spin_events_migration.sql =======================
-- Applied to the DAEMON HOUR Supabase project on 2026-11-13.
-- Spin outcomes are server-selected and each team can spin once per event.
create table if not exists public.spin_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null check (char_length(trim(event_name)) between 1 and 100),
  status text not null default 'draft' check (status in ('draft','published','closed')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  published_at timestamptz
);
create table if not exists public.spin_outcomes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.spin_events(id) on delete cascade,
  outcome_label text not null check (char_length(trim(outcome_label)) between 1 and 120),
  points_delta integer not null default 0,
  weight numeric not null default 1 check (weight > 0 and weight <= 1000),
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.team_spins (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.spin_events(id) on delete restrict,
  team_id uuid not null references public.teams(id) on delete restrict,
  outcome_id uuid not null references public.spin_outcomes(id) on delete restrict,
  outcome_label text not null,
  points_delta integer not null default 0,
  created_at timestamptz not null default now(),
  unique(event_id, team_id)
);
create table if not exists public.manual_spin_records (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  result_label text not null check (char_length(trim(result_label)) between 1 and 160),
  notes text,
  points_delta integer not null default 0,
  points_awarded boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.spin_events enable row level security;
alter table public.spin_outcomes enable row level security;
alter table public.team_spins enable row level security;
alter table public.manual_spin_records enable row level security;
drop policy if exists "spin events readable by authenticated" on public.spin_events;
create policy "spin events readable by authenticated" on public.spin_events for select to authenticated using (true);
drop policy if exists "spin outcomes readable by authenticated" on public.spin_outcomes;
create policy "spin outcomes readable by authenticated" on public.spin_outcomes for select to authenticated using (exists(select 1 from public.spin_events e where e.id=event_id and e.status='published') or public.is_staff());
drop policy if exists "team spins own or staff read" on public.team_spins;
create policy "team spins own or staff read" on public.team_spins for select to authenticated using (team_id=public.current_team_id() or public.is_staff());
drop policy if exists "manual spin records own or staff read" on public.manual_spin_records;
create policy "manual spin records own or staff read" on public.manual_spin_records for select to authenticated using (team_id=public.current_team_id() or public.is_staff());
grant select on public.spin_events, public.spin_outcomes, public.team_spins, public.manual_spin_records to authenticated;
revoke all on public.spin_events, public.spin_outcomes, public.team_spins, public.manual_spin_records from anon, public;
revoke insert, update, delete, truncate on public.spin_events, public.spin_outcomes, public.team_spins, public.manual_spin_records from authenticated;
create or replace function public.spin_for_team(p_event_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_team_id uuid; v_event public.spin_events%rowtype;
  v_outcome public.spin_outcomes%rowtype; v_total numeric; v_pick numeric; v_running numeric := 0;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select p.team_id into v_team_id from public.profiles p where p.id=v_uid and p.role='team';
  if v_team_id is null then raise exception 'Only team accounts can spin'; end if;
  select * into v_event from public.spin_events e where e.id=p_event_id and e.status='published' for share;
  if not found then raise exception 'This spin event is not available'; end if;
  if exists(select 1 from public.team_spins s where s.event_id=p_event_id and s.team_id=v_team_id) then raise exception 'Your team has already spun for this event'; end if;
  select sum(o.weight) into v_total from public.spin_outcomes o where o.event_id=p_event_id;
  if coalesce(v_total,0)<=0 then raise exception 'This event has no outcomes'; end if;
  v_pick := random()*v_total;
  for v_outcome in select * from public.spin_outcomes o where o.event_id=p_event_id order by o.display_order, o.id loop
    v_running := v_running + v_outcome.weight;
    if v_pick <= v_running then exit; end if;
  end loop;
  insert into public.team_spins(event_id,team_id,outcome_id,outcome_label,points_delta) values(p_event_id,v_team_id,v_outcome.id,v_outcome.outcome_label,v_outcome.points_delta);
  if v_outcome.points_delta <> 0 then
    insert into public.transactions(team_id,description,points,transaction_type,created_by)
    values(v_team_id,'Spin event: '||v_event.event_name||' — '||v_outcome.outcome_label,v_outcome.points_delta,'adjustment',v_uid);
  end if;
  return jsonb_build_object('outcome',v_outcome.outcome_label,'points_delta',v_outcome.points_delta);
end;
$$;
revoke all on function public.spin_for_team(uuid) from public, anon;
grant execute on function public.spin_for_team(uuid) to authenticated;

-- ======================= starting_points_publish_migration.sql =======================
-- DAEMON HOUR: admin-controlled, one-time event starting-points publication.
-- Existing event_settings.starting_points is retained as the published amount.

ALTER TABLE public.event_settings
  ADD COLUMN IF NOT EXISTS starting_points_published boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.publish_event_starting_points(p_points bigint)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_count integer;
BEGIN
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_admin_id AND role = 'admin') THEN
    RAISE EXCEPTION 'Administrator access required';
  END IF;
  IF p_points IS NULL OR p_points < 0 OR p_points > 1000000000 THEN
    RAISE EXCEPTION 'Enter a valid starting-points amount';
  END IF;

  PERFORM 1 FROM public.event_settings WHERE id = true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event settings row was not found'; END IF;
  IF EXISTS (SELECT 1 FROM public.event_settings WHERE id = true AND starting_points_published = true) THEN
    RAISE EXCEPTION 'Starting points have already been published';
  END IF;

  -- Normalize legacy pre-publication opening entries to the selected amount.
  WITH ranked AS (
    SELECT id, row_number() OVER (PARTITION BY team_id ORDER BY created_at NULLS LAST, id) AS rn
    FROM public.transactions WHERE description = 'Initial event points'
  )
  UPDATE public.transactions t SET points = p_points::integer
  FROM ranked r WHERE t.id = r.id AND r.rn = 1;

  WITH ranked AS (
    SELECT id, row_number() OVER (PARTITION BY team_id ORDER BY created_at NULLS LAST, id) AS rn
    FROM public.transactions WHERE description = 'Initial event points'
  )
  DELETE FROM public.transactions t USING ranked r WHERE t.id = r.id AND r.rn > 1;

  INSERT INTO public.transactions (team_id, description, points, transaction_type, created_by)
  SELECT t.id, 'Initial event points', p_points::integer, 'bonus', v_admin_id
  FROM public.teams t
  WHERE NOT EXISTS (
    SELECT 1 FROM public.transactions x
    WHERE x.team_id = t.id AND x.description = 'Initial event points'
  );

  SELECT count(*)::integer INTO v_count FROM public.teams;
  UPDATE public.event_settings
  SET starting_points = p_points::integer, starting_points_published = true
  WHERE id = true;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_event_starting_points(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_event_starting_points(bigint) TO authenticated;

-- ======================= ui_rebuild_migration.sql =======================
-- ============================================================================
-- DAEMON HOUR · "ui" branch migration
-- Run ONCE in the Supabase SQL editor, after the existing migrations.
-- Additive only: no existing rows are deleted. Safe to re-run (idempotent).
--
-- What it adds
--   • event_settings  : hackathon clock, live auction lot, broadcast ticker,
--                       bingo line bonus, leaderboard visibility
--   • teams.bay       : venue group ("Bay A", "Lab 2") for batch control
--   • team_stages     : per-team state of each activity (upcoming/live/closed)
--   • auction_items   : min/max/step price range, quantity, linked power-up
--   • powerups        : catalogue (time delta in minutes, self or rival)
--   • team_powerups   : what each team holds (source, used, target team)
--   • bingo_cells     : the 5×5 board (editable)   • team_bingo : marks
--   • RPCs (service-role only): admin_sell_lot, admin_undo_sale,
--                               admin_toggle_bingo
--   • Team-side purchasing is REVOKED: the admin buys on the team's behalf.
-- ============================================================================

-- ---------- event settings ----------
alter table public.event_settings
  add column if not exists hackathon_end_at   timestamptz,
  add column if not exists live_lot           jsonb,
  add column if not exists broadcast          text,
  add column if not exists bingo_line_bonus   integer not null default 50,
  add column if not exists leaderboard_visible boolean not null default false;

-- ---------- teams ----------
alter table public.teams add column if not exists bay text;

-- ---------- stages ----------
create table if not exists public.team_stages (
  team_id   uuid not null references public.teams(id) on delete cascade,
  activity  text not null check (activity in ('auction','spin','bingo')),
  status    text not null default 'upcoming' check (status in ('upcoming','live','closed')),
  opened_at timestamptz,
  closed_at timestamptz,
  closing_points integer,
  closing_end_at timestamptz,
  primary key (team_id, activity)
);

-- ---------- auction items ----------
alter table public.auction_items
  add column if not exists min_price  integer,
  add column if not exists max_price  integer,
  add column if not exists price_step integer not null default 10,
  add column if not exists quantity   integer not null default 1,
  add column if not exists description text,
  add column if not exists powerup_id uuid;

-- ---------- power-ups ----------
create table if not exists public.powerups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  description text,
  minutes_delta integer not null default 0,         -- +15 = extra time, -10 = penalty
  targets_rival boolean not null default false,     -- time delta lands on another team
  color text not null default 'cyan',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'auction_items_powerup_fk') then
    alter table public.auction_items
      add constraint auction_items_powerup_fk foreign key (powerup_id) references public.powerups(id) on delete set null;
  end if;
end $$;

create table if not exists public.team_powerups (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  powerup_id uuid references public.powerups(id) on delete set null,
  name text not null,                               -- snapshot, survives catalogue edits
  minutes_delta integer not null default 0,
  target_team_id uuid references public.teams(id) on delete set null,
  source text not null check (source in ('auction','spin','bingo','manual')),
  note text,
  used boolean not null default false,
  purchase_id uuid,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists team_powerups_team_idx on public.team_powerups(team_id);
create index if not exists team_powerups_target_idx on public.team_powerups(target_team_id);

-- ---------- bingo ----------
create table if not exists public.bingo_cells (
  idx integer primary key check (idx between 0 and 24),
  label text not null,
  points integer not null default 10,
  is_free boolean not null default false
);

create table if not exists public.team_bingo (
  team_id uuid not null references public.teams(id) on delete cascade,
  idx integer not null references public.bingo_cells(idx) on delete cascade,
  marked_by uuid,
  marked_at timestamptz not null default now(),
  primary key (team_id, idx)
);

insert into public.bingo_cells (idx, label, points, is_free) values
 (0,'Get club member to draw smiley on hand',10,false),
 (1,'Like all the posts of MD insta page',10,false),
 (2,'Tell the President of the club "Hi"',10,false),
 (3,'Do a bottle flip',10,false),
 (4,'Win rock paper scissors with club member',10,false),
 (5,'Do a pushup',10,false),
 (6,'List 5 AI chatbots',10,false),
 (7,'Code to sort a list',10,false),
 (8,'Take a mirror selfie',10,false),
 (9,'Take a picture with a campus landmark',10,false),
 (10,'Find someone who plays chess',10,false),
 (11,'Find a laptop with a sticker',10,false),
 (12,'FREE · MD Club',0,true),
 (13,'Code to print n prime numbers',10,false),
 (14,'Draw MD Club logo',10,false),
 (15,'Draw something on your face',10,false),
 (16,'Code to print n even numbers',10,false),
 (17,'Exchange GitHub id with someone',10,false),
 (18,'Take a pic of Tango menu',10,false),
 (19,'Give a high-five with a club member',10,false),
 (20,'Find a pink flower in campus',10,false),
 (21,'Take a pic with Core Member',10,false),
 (22,'Get signature from a club member',10,false),
 (23,'Record yourself singing a song',10,false),
 (24,'Write a loop pattern code',10,false)
on conflict (idx) do nothing;

-- ---------- RLS: teams read their own rows, staff read everything ----------
alter table public.team_stages   enable row level security;
alter table public.powerups      enable row level security;
alter table public.team_powerups enable row level security;
alter table public.bingo_cells   enable row level security;
alter table public.team_bingo    enable row level security;

drop policy if exists "stages own or staff" on public.team_stages;
create policy "stages own or staff" on public.team_stages for select to authenticated
  using (team_id = public.current_team_id() or public.is_staff());

drop policy if exists "powerups readable" on public.powerups;
create policy "powerups readable" on public.powerups for select to authenticated using (true);

drop policy if exists "team powerups own target or staff" on public.team_powerups;
create policy "team powerups own target or staff" on public.team_powerups for select to authenticated
  using (team_id = public.current_team_id() or target_team_id = public.current_team_id() or public.is_staff());

drop policy if exists "bingo cells readable" on public.bingo_cells;
create policy "bingo cells readable" on public.bingo_cells for select to authenticated using (true);

drop policy if exists "team bingo own or staff" on public.team_bingo;
create policy "team bingo own or staff" on public.team_bingo for select to authenticated
  using (team_id = public.current_team_id() or public.is_staff());

grant all on public.team_stages, public.powerups, public.team_powerups, public.bingo_cells, public.team_bingo to postgres, service_role;
grant select on public.team_stages, public.powerups, public.team_powerups, public.bingo_cells, public.team_bingo to authenticated, anon;
revoke insert, update, delete, truncate on public.team_stages, public.powerups, public.team_powerups, public.bingo_cells, public.team_bingo from authenticated, anon;

-- Participants can no longer buy on their own: the auctioneer does it.
do $$ begin
  if exists (select 1 from pg_proc where proname = 'purchase_auction_item') then
    revoke execute on function public.purchase_auction_item(uuid) from authenticated;
  end if;
  if exists (select 1 from pg_proc where proname = 'spin_for_team') then
    revoke execute on function public.spin_for_team(uuid) from authenticated;
  end if;
end $$;

-- ---------- RPC: sell the current lot to a team (atomic) ----------
create or replace function public.admin_sell_lot(p_item_id uuid, p_team_id uuid, p_price integer, p_admin uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_item public.auction_items%rowtype;
  v_balance bigint; v_sold integer; v_tx uuid; v_purchase uuid; v_pu public.powerups%rowtype;
begin
  perform 1 from public.teams where id = p_team_id for update;
  if not found then raise exception 'Team not found'; end if;

  select * into v_item from public.auction_items where id = p_item_id for update;
  if not found then raise exception 'Item not found'; end if;
  if p_price is null or p_price < 0 then raise exception 'Invalid price'; end if;
  if v_item.min_price is not null and p_price < v_item.min_price then raise exception 'Price is below the minimum (%)', v_item.min_price; end if;
  if v_item.max_price is not null and p_price > v_item.max_price then raise exception 'Price is above the maximum (%)', v_item.max_price; end if;

  select count(*) into v_sold from public.purchases where item_id = p_item_id;
  if v_sold >= greatest(v_item.quantity, 1) then raise exception 'This item is sold out'; end if;

  select coalesce(sum(points),0) into v_balance from public.transactions where team_id = p_team_id;
  if v_balance < p_price then raise exception 'Team has only % points', v_balance; end if;

  insert into public.transactions(team_id, description, points, transaction_type, created_by)
  values (p_team_id, 'Auction: ' || v_item.item_name, -p_price, 'purchase', p_admin)
  returning id into v_tx;

  insert into public.purchases(team_id, item_id, transaction_id, purchase_price)
  values (p_team_id, p_item_id, v_tx, p_price) returning id into v_purchase;

  if v_item.powerup_id is not null then
    select * into v_pu from public.powerups where id = v_item.powerup_id;
    if found then
      insert into public.team_powerups(team_id, powerup_id, name, minutes_delta, source, purchase_id, created_by)
      values (p_team_id, v_pu.id, v_pu.name, v_pu.minutes_delta, 'auction', v_purchase, p_admin);
    end if;
  end if;

  return jsonb_build_object('purchase_id', v_purchase, 'remaining', v_balance - p_price);
end $$;

-- ---------- RPC: undo a sale (refund + remove linked power-up) ----------
create or replace function public.admin_undo_sale(p_purchase_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_tx uuid;
begin
  select transaction_id into v_tx from public.purchases where id = p_purchase_id;
  if not found then raise exception 'Sale not found'; end if;
  delete from public.team_powerups where purchase_id = p_purchase_id;
  delete from public.purchases where id = p_purchase_id;
  if v_tx is not null then delete from public.transactions where id = v_tx; end if;
end $$;

-- ---------- RPC: toggle a bingo square (points + line bonuses kept in sync) ----------
create or replace function public.admin_toggle_bingo(p_team_id uuid, p_idx integer, p_admin uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_cell public.bingo_cells%rowtype; v_marked boolean; v_lines integer := 0; v_paid integer; v_bonus integer;
  v_set integer[]; v_line integer[]; v_all integer[][] := array[
    array[0,1,2,3,4], array[5,6,7,8,9], array[10,11,12,13,14], array[15,16,17,18,19], array[20,21,22,23,24],
    array[0,5,10,15,20], array[1,6,11,16,21], array[2,7,12,17,22], array[3,8,13,18,23], array[4,9,14,19,24],
    array[0,6,12,18,24], array[4,8,12,16,20]];
  i integer;
begin
  perform 1 from public.teams where id = p_team_id for update;
  select * into v_cell from public.bingo_cells where idx = p_idx;
  if not found then raise exception 'Square not found'; end if;
  if v_cell.is_free then raise exception 'The centre square is always free'; end if;

  if exists (select 1 from public.team_bingo where team_id = p_team_id and idx = p_idx) then
    delete from public.team_bingo where team_id = p_team_id and idx = p_idx;
    if v_cell.points <> 0 then
      insert into public.transactions(team_id, description, points, transaction_type, created_by)
      values (p_team_id, 'Bingo undo: ' || v_cell.label, -v_cell.points, 'adjustment', p_admin);
    end if;
    v_marked := false;
  else
    insert into public.team_bingo(team_id, idx, marked_by) values (p_team_id, p_idx, p_admin);
    if v_cell.points <> 0 then
      insert into public.transactions(team_id, description, points, transaction_type, created_by)
      values (p_team_id, 'Bingo: ' || v_cell.label, v_cell.points, 'bonus', p_admin);
    end if;
    v_marked := true;
  end if;

  select array_agg(idx) into v_set from (
    select idx from public.team_bingo where team_id = p_team_id
    union select idx from public.bingo_cells where is_free) s;
  for i in 1..12 loop
    v_line := v_all[i:i][1:5];
    if (select bool_and(x = any(coalesce(v_set, '{}'))) from unnest(v_line) x) then v_lines := v_lines + 1; end if;
  end loop;

  select bingo_line_bonus into v_bonus from public.event_settings where id = true;
  select coalesce(sum(case when description = 'Bingo line bonus' then 1 when description = 'Bingo line bonus undo' then -1 else 0 end),0)
    into v_paid from public.transactions where team_id = p_team_id;

  while v_paid < v_lines loop
    insert into public.transactions(team_id, description, points, transaction_type, created_by)
    values (p_team_id, 'Bingo line bonus', coalesce(v_bonus,0), 'bonus', p_admin);
    v_paid := v_paid + 1;
  end loop;
  while v_paid > v_lines loop
    insert into public.transactions(team_id, description, points, transaction_type, created_by)
    values (p_team_id, 'Bingo line bonus undo', -coalesce(v_bonus,0), 'adjustment', p_admin);
    v_paid := v_paid - 1;
  end loop;

  return jsonb_build_object('marked', v_marked, 'lines', v_lines);
end $$;

revoke all on function public.admin_sell_lot(uuid, uuid, integer, uuid) from public, anon, authenticated;
revoke all on function public.admin_undo_sale(uuid) from public, anon, authenticated;
revoke all on function public.admin_toggle_bingo(uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.admin_sell_lot(uuid, uuid, integer, uuid) to postgres, service_role;
grant execute on function public.admin_undo_sale(uuid) to postgres, service_role;
grant execute on function public.admin_toggle_bingo(uuid, integer, uuid) to postgres, service_role;

-- ---------- realtime: team screens update the instant the admin acts ----------
do $$
declare t text;
begin
  foreach t in array array['transactions','purchases','team_stages','team_powerups','team_bingo','event_settings'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; when undefined_object then null;
    end;
  end loop;
end $$;

-- ======================= ui_v7_schema_doctor.sql =======================
-- ============================================================================
-- DAEMON HOUR · v7 — SCHEMA DOCTOR
-- Brings every table the app uses to exactly the shape the code expects,
-- whatever state the database is in (older tables from earlier versions,
-- half-applied migrations, legacy NOT NULL columns, missing unique keys).
-- Safe to run any number of times, before or after the other migrations.
-- ============================================================================

-- 1. Every column the app reads or writes ------------------------------------
do $$
declare
  spec text[][] := array[
    -- table, column, type + default
    ['teams','bay','text'], ['teams','paddle','integer'], ['teams','password_changed_at','timestamptz'],
    ['profiles','venue','text'], ['profiles','must_change_password','boolean not null default false'],
    ['auction_items','min_price','integer'], ['auction_items','max_price','integer'], ['auction_items','price_step','integer not null default 10'],
    ['auction_items','quantity','integer not null default 1'], ['auction_items','description','text'], ['auction_items','powerup_id','uuid'],
    ['auction_items','is_active','boolean not null default true'], ['auction_items','base_points','integer not null default 0'],
    ['team_stages','opened_at','timestamptz'], ['team_stages','closed_at','timestamptz'], ['team_stages','closing_points','integer'], ['team_stages','closing_end_at','timestamptz'],
    ['powerups','description','text'], ['powerups','minutes_delta','integer not null default 0'], ['powerups','targets_rival','boolean not null default false'],
    ['powerups','color','text not null default ''cyan'''], ['powerups','is_active','boolean not null default true'], ['powerups','created_at','timestamptz not null default now()'],
    ['team_powerups','powerup_id','uuid'], ['team_powerups','name','text'], ['team_powerups','minutes_delta','integer not null default 0'], ['team_powerups','target_team_id','uuid'],
    ['team_powerups','source','text not null default ''manual'''], ['team_powerups','note','text'], ['team_powerups','used','boolean not null default false'],
    ['team_powerups','purchase_id','uuid'], ['team_powerups','created_by','uuid'], ['team_powerups','created_at','timestamptz not null default now()'],
    ['bingo_cells','idx','integer'], ['bingo_cells','label','text'], ['bingo_cells','points','integer not null default 10'], ['bingo_cells','is_free','boolean not null default false'],
    ['team_bingo','idx','integer'], ['team_bingo','marked_by','uuid'], ['team_bingo','marked_at','timestamptz not null default now()'],
    ['team_members','role','text not null default ''member'''], ['team_members','full_name','text'], ['team_members','usn','text'], ['team_members','department','text'],
    ['team_members','year','text'], ['team_members','phone','text'], ['team_members','email','text'], ['team_members','college','text'],
    ['team_members','checked_in','boolean not null default false'], ['team_members','created_at','timestamptz not null default now()'],
    ['activity_log','minutes','integer'], ['activity_log','points','integer'], ['activity_log','actor','uuid'],
    ['help_requests','message','text'], ['help_requests','status','text not null default ''open'''], ['help_requests','resolved_at','timestamptz'],
    ['team_secrets','password','text'], ['team_secrets','source','text not null default ''default'''], ['team_secrets','updated_at','timestamptz not null default now()'],
    ['event_settings','hackathon_end_at','timestamptz'], ['event_settings','hackathon_started_at','timestamptz'], ['event_settings','clock_paused_at','timestamptz'],
    ['event_settings','live_lot','jsonb'], ['event_settings','live_lots','jsonb not null default ''{}''::jsonb'], ['event_settings','broadcast','text'],
    ['event_settings','broadcasts','jsonb not null default ''{}''::jsonb'], ['event_settings','bingo_line_bonus','integer not null default 50'],
    ['event_settings','bingo_full_bonus','integer not null default 100'], ['event_settings','bingo_rewards','jsonb not null default ''{}''::jsonb'],
    ['event_settings','leaderboard_visible','boolean not null default false'], ['event_settings','portal_locked','boolean not null default false'],
    ['event_settings','portal_message','text'], ['event_settings','starting_points','integer not null default 0']
  ];
  i int;
begin
  for i in 1..array_length(spec, 1) loop
    if to_regclass('public.' || spec[i][1]) is not null then
      execute format('alter table public.%I add column if not exists %I %s', spec[i][1], spec[i][2], spec[i][3]);
    end if;
  end loop;
end $$;

-- 2. Carry data over from older column names --------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='team_bingo' and column_name='cell_index') then
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='team_bingo' and column_name='completed') then
      execute 'delete from public.team_bingo where completed is false';
    end if;
    execute 'update public.team_bingo set idx = cell_index where idx is null';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='team_members' and column_name='member_name') then
    execute 'update public.team_members set full_name = member_name where full_name is null';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='team_members' and column_name='member_order') then
    execute 'update public.team_members set role = ''lead'' where member_order = 1 and not exists (select 1 from public.team_members m2 where m2.team_id = team_members.team_id and m2.role = ''lead'')';
  end if;
  if to_regclass('public.team_bingo') is not null then delete from public.team_bingo where idx is null; end if;
  if to_regclass('public.team_members') is not null then update public.team_members set full_name = 'Member' where full_name is null or trim(full_name) = ''; end if;
  if to_regclass('public.team_powerups') is not null then update public.team_powerups set name = 'Power-up' where name is null; end if;
end $$;

-- 3. Older NOT NULL columns the app never writes must not block inserts -------
do $$
declare r record;
  known text[] := array[
    'teams.id','teams.team_name','teams.username',
    'profiles.id','profiles.role',
    'transactions.id','transactions.team_id','transactions.description','transactions.points','transactions.transaction_type',
    'auction_items.id','auction_items.item_name',
    'purchases.id','purchases.team_id','purchases.item_id','purchases.purchase_price',
    'team_stages.team_id','team_stages.activity','team_stages.status',
    'powerups.id','powerups.name',
    'team_powerups.id','team_powerups.team_id','team_powerups.source',
    'bingo_cells.idx','bingo_cells.label',
    'team_bingo.team_id','team_bingo.idx',
    'team_members.id','team_members.team_id','team_members.role','team_members.full_name',
    'activity_log.id','activity_log.kind','activity_log.action','activity_log.label',
    'help_requests.id','help_requests.team_id','help_requests.status',
    'team_secrets.team_id','event_settings.id'];
begin
  for r in
    select c.table_name, c.column_name from information_schema.columns c
    where c.table_schema = 'public' and c.is_nullable = 'NO' and c.column_default is null
      and c.table_name in ('teams','profiles','transactions','auction_items','purchases','team_stages','powerups','team_powerups',
                           'bingo_cells','team_bingo','team_members','activity_log','help_requests','team_secrets','event_settings')
      and (c.table_name || '.' || c.column_name) <> all(known)
      and not exists (  -- leave primary-key columns alone
        select 1 from pg_index ix join pg_attribute a on a.attrelid = ix.indrelid and a.attnum = any(ix.indkey)
        where ix.indrelid = ('public.' || c.table_name)::regclass and ix.indisprimary and a.attname = c.column_name)
  loop
    execute format('alter table public.%I alter column %I drop not null', r.table_name, r.column_name);
    raise notice 'relaxed legacy NOT NULL: %.%', r.table_name, r.column_name;
  end loop;
end $$;

-- 4. Unique keys the app relies on (upserts / one-per-team rules) -------------
do $$
begin
  if to_regclass('public.team_stages') is not null then
    delete from public.team_stages a using public.team_stages b where a.ctid < b.ctid and a.team_id = b.team_id and a.activity = b.activity;
    create unique index if not exists team_stages_team_activity_key on public.team_stages(team_id, activity);
  end if;
  if to_regclass('public.team_bingo') is not null then
    delete from public.team_bingo a using public.team_bingo b where a.ctid < b.ctid and a.team_id = b.team_id and a.idx = b.idx;
    create unique index if not exists team_bingo_team_idx_key on public.team_bingo(team_id, idx);
  end if;
  if to_regclass('public.bingo_cells') is not null then
    delete from public.bingo_cells a using public.bingo_cells b where a.ctid < b.ctid and a.idx = b.idx;
    create unique index if not exists bingo_cells_idx_key on public.bingo_cells(idx);
  end if;
  if to_regclass('public.team_secrets') is not null then
    create unique index if not exists team_secrets_team_key on public.team_secrets(team_id);
  end if;
  if to_regclass('public.event_settings') is not null and not exists (select 1 from public.event_settings) then
    insert into public.event_settings default values;
  end if;
end $$;

-- 5. Service role can always reach everything ---------------------------------
grant usage on schema public to postgres, service_role;
grant all on all tables in schema public to postgres, service_role;
grant all on all sequences in schema public to postgres, service_role;
grant execute on all functions in schema public to postgres, service_role;

-- 6. Health report: run this after; every row should say OK ------------------
-- select * from public.daemon_health();
create or replace function public.daemon_health()
returns table(item text, status text) language plpgsql security definer set search_path = '' as $$
declare t text; f text;
begin
  foreach t in array array['teams','profiles','transactions','auction_items','purchases','team_stages','powerups','team_powerups',
                           'bingo_cells','team_bingo','team_members','activity_log','help_requests','team_secrets','event_settings'] loop
    item := 'table ' || t; status := case when to_regclass('public.' || t) is null then 'MISSING' else 'OK' end; return next;
  end loop;
  foreach f in array array['admin_sell_lot','admin_undo_sale','admin_toggle_bingo','admin_set_bingo','team_balances','is_staff','current_team_id'] loop
    item := 'function ' || f; status := case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = f) then 'OK' else 'MISSING' end; return next;
  end loop;
  item := 'bingo squares'; status := (select case when count(*) = 25 then 'OK' else count(*) || ' of 25' end from public.bingo_cells); return next;
  item := 'event settings row'; status := case when exists (select 1 from public.event_settings) then 'OK' else 'MISSING' end; return next;
  item := 'realtime publication'; status := (select case when count(*) >= 6 then 'OK' else count(*) || ' tables published' end
    from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename in ('transactions','purchases','team_stages','team_powerups','team_bingo','event_settings','activity_log','team_members','help_requests')); return next;
end $$;
revoke all on function public.daemon_health() from public, anon, authenticated;
grant execute on function public.daemon_health() to postgres, service_role;

-- ======================= ui_v2_migration.sql =======================
-- ============================================================================
-- DAEMON HOUR · ui v2 migration  (run AFTER ui_rebuild_migration.sql)
-- Additive and re-runnable.
--   • Hackathon clock: start / pause / resume / set duration
--   • Activity log: every grant, removal, sale, stamp and round change per team
--   • Bingo: the finalised sheet is forced in; bonuses per completed COLUMN
--     (B-I-N-G-O) + full card; editable reward text per letter
-- ============================================================================

alter table public.event_settings
  add column if not exists hackathon_started_at timestamptz,
  add column if not exists clock_paused_at      timestamptz,
  add column if not exists bingo_full_bonus     integer not null default 100,
  add column if not exists bingo_rewards        jsonb   not null default '{}'::jsonb;

-- ---------- activity log ----------
create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references public.teams(id) on delete cascade,
  kind text not null,          -- points | powerup | auction | bingo | round | clock
  action text not null,        -- granted | removed | used | restored | sold | refunded | stamped | unstamped | opened | closed | reset
  label text not null,
  points integer,
  minutes integer,
  actor uuid,
  created_at timestamptz not null default now()
);
create index if not exists activity_log_team_idx on public.activity_log(team_id, created_at desc);
alter table public.activity_log enable row level security;
drop policy if exists "activity own or staff" on public.activity_log;
create policy "activity own or staff" on public.activity_log for select to authenticated
  using (team_id = public.current_team_id() or public.is_staff());
grant select on public.activity_log to authenticated;
grant all on public.activity_log to postgres, service_role;
revoke insert, update, delete, truncate on public.activity_log from authenticated, anon;

-- ---------- finalised bingo sheet (overwrites whatever is there) ----------
insert into public.bingo_cells (idx, label, points, is_free) values
 (0,'Get club member to draw smiley on hand',10,false),
 (1,'Like all the posts of MD insta page',10,false),
 (2,'Tell the President of the club "Hi"',10,false),
 (3,'Do a Bottle Flip',10,false),
 (4,'Win rock paper scissors with club member',10,false),
 (5,'Do a Pushup',10,false),
 (6,'List 5 AI Chatbots',10,false),
 (7,'Code to sort a list',10,false),
 (8,'Take a mirror selfie',10,false),
 (9,'Take a picture with a campus landmark',10,false),
 (10,'Find someone who plays chess',10,false),
 (11,'Find a laptop with a sticker',10,false),
 (12,'MD Club',0,true),
 (13,'Code to Print n prime numbers',10,false),
 (14,'Draw MD Club Logo',10,false),
 (15,'Draw something on your face',10,false),
 (16,'Code to print n even numbers',10,false),
 (17,'Exchange GitHub id with someone',10,false),
 (18,'Take a pic of Tango Menu',10,false),
 (19,'Give a High-Five with a club member',10,false),
 (20,'Find a pink flower in campus',10,false),
 (21,'Take a pic with Core Member',10,false),
 (22,'Get signature from a club member',10,false),
 (23,'Record yourself singing a song',10,false),
 (24,'Write a loop pattern code',10,false)
on conflict (idx) do update set label = excluded.label, is_free = excluded.is_free,
  points = case when public.bingo_cells.points is null then excluded.points else public.bingo_cells.points end;
-- Clear marks on the centre square if it was ever stamped as a normal cell
delete from public.team_bingo where idx = 12;

-- ---------- bingo: column bonuses + full card ----------
create or replace function public.admin_toggle_bingo(p_team_id uuid, p_idx integer, p_admin uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_cell public.bingo_cells%rowtype; v_marked boolean; v_set integer[];
  v_cols integer := 0; v_full integer := 0; v_paid_cols integer; v_paid_full integer;
  v_col_bonus integer; v_full_bonus integer; c integer;
begin
  perform 1 from public.teams where id = p_team_id for update;
  select * into v_cell from public.bingo_cells where idx = p_idx;
  if not found then raise exception 'Square not found'; end if;
  if v_cell.is_free then raise exception 'The centre square is always free'; end if;

  if exists (select 1 from public.team_bingo where team_id = p_team_id and idx = p_idx) then
    delete from public.team_bingo where team_id = p_team_id and idx = p_idx;
    if v_cell.points <> 0 then
      insert into public.transactions(team_id, description, points, transaction_type, created_by)
      values (p_team_id, 'Bingo undo: ' || v_cell.label, -v_cell.points, 'adjustment', p_admin);
    end if;
    insert into public.activity_log(team_id, kind, action, label, points, actor) values (p_team_id,'bingo','unstamped',v_cell.label,-v_cell.points,p_admin);
    v_marked := false;
  else
    insert into public.team_bingo(team_id, idx, marked_by) values (p_team_id, p_idx, p_admin);
    if v_cell.points <> 0 then
      insert into public.transactions(team_id, description, points, transaction_type, created_by)
      values (p_team_id, 'Bingo: ' || v_cell.label, v_cell.points, 'bonus', p_admin);
    end if;
    insert into public.activity_log(team_id, kind, action, label, points, actor) values (p_team_id,'bingo','stamped',v_cell.label,v_cell.points,p_admin);
    v_marked := true;
  end if;

  select array_agg(idx) into v_set from (
    select idx from public.team_bingo where team_id = p_team_id
    union select idx from public.bingo_cells where is_free) s;
  v_set := coalesce(v_set, '{}');
  for c in 0..4 loop
    if array[c, c+5, c+10, c+15, c+20] <@ v_set then v_cols := v_cols + 1; end if;
  end loop;
  if v_cols = 5 then v_full := 1; end if;

  select bingo_line_bonus, bingo_full_bonus into v_col_bonus, v_full_bonus from public.event_settings where id = true;
  select coalesce(sum(case when description = 'Bingo column bonus' then 1 when description = 'Bingo column bonus undo' then -1 else 0 end),0),
         coalesce(sum(case when description = 'Bingo full card bonus' then 1 when description = 'Bingo full card bonus undo' then -1 else 0 end),0)
    into v_paid_cols, v_paid_full from public.transactions where team_id = p_team_id;

  while v_paid_cols < v_cols loop
    insert into public.transactions(team_id, description, points, transaction_type, created_by) values (p_team_id,'Bingo column bonus',coalesce(v_col_bonus,0),'bonus',p_admin);
    insert into public.activity_log(team_id, kind, action, label, points, actor) values (p_team_id,'bingo','granted','Column completed',coalesce(v_col_bonus,0),p_admin);
    v_paid_cols := v_paid_cols + 1;
  end loop;
  while v_paid_cols > v_cols loop
    insert into public.transactions(team_id, description, points, transaction_type, created_by) values (p_team_id,'Bingo column bonus undo',-coalesce(v_col_bonus,0),'adjustment',p_admin);
    insert into public.activity_log(team_id, kind, action, label, points, actor) values (p_team_id,'bingo','removed','Column bonus reversed',-coalesce(v_col_bonus,0),p_admin);
    v_paid_cols := v_paid_cols - 1;
  end loop;
  if v_paid_full < v_full then
    insert into public.transactions(team_id, description, points, transaction_type, created_by) values (p_team_id,'Bingo full card bonus',coalesce(v_full_bonus,0),'bonus',p_admin);
    insert into public.activity_log(team_id, kind, action, label, points, actor) values (p_team_id,'bingo','granted','Full card BINGO',coalesce(v_full_bonus,0),p_admin);
  elsif v_paid_full > v_full then
    insert into public.transactions(team_id, description, points, transaction_type, created_by) values (p_team_id,'Bingo full card bonus undo',-coalesce(v_full_bonus,0),'adjustment',p_admin);
    insert into public.activity_log(team_id, kind, action, label, points, actor) values (p_team_id,'bingo','removed','Full card bonus reversed',-coalesce(v_full_bonus,0),p_admin);
  end if;

  return jsonb_build_object('marked', v_marked, 'columns', v_cols, 'full', v_full = 1);
end $$;
revoke all on function public.admin_toggle_bingo(uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.admin_toggle_bingo(uuid, integer, uuid) to postgres, service_role;

do $$ begin
  begin execute 'alter publication supabase_realtime add table public.activity_log';
  exception when duplicate_object then null; when undefined_object then null; end;
end $$;

-- ======================= ui_v3_venues_migration.sql =======================
-- ============================================================================
-- DAEMON HOUR · v3 — two venues, venue admins, stable paddles
-- Run AFTER ui_rebuild_migration.sql and ui_v2_migration.sql. Re-runnable.
--
--   • profiles.venue      : NULL for hosts (see everything); 'Idea Lab' or
--                           'Incubation Center' for a venue admin (sees only
--                           that floor's teams)
--   • teams.bay           : the venue a team sits in (from the allocation sheets)
--   • teams.paddle        : a fixed paddle number that never shifts when a team
--                           is deleted or added
--   • event_settings.live_lots / broadcasts : one live auction lot and one
--                           banner per venue, so both floors can run at once
-- ============================================================================

alter table public.profiles add column if not exists venue text;
alter table public.teams    add column if not exists paddle integer;
alter table public.event_settings
  add column if not exists live_lots  jsonb not null default '{}'::jsonb,
  add column if not exists broadcasts jsonb not null default '{}'::jsonb;

-- Stable paddle numbers (alphabetical for the existing teams; new teams get max+1)
with numbered as (
  select id, row_number() over (order by lower(team_name)) as n from public.teams
)
update public.teams t set paddle = n.n from numbered n where t.id = n.id and t.paddle is null;
create unique index if not exists teams_paddle_key on public.teams(paddle) where paddle is not null;

-- ---------- Venue allocation from the sheets ----------
update public.teams set bay = 'Incubation Center' where lower(trim(team_name)) in (
  'firewalls','tejaswini k','quantum crew','logic legends','appvengers','team trps','dbc','s⁴',
  'the outliers','code berry','loopx','codevengers','hakuna matata','tricore','synergy','nuronx','mechforge');

update public.teams set bay = 'Idea Lab' where lower(trim(team_name)) in (
  'teen-bhai-teeno-tabahi','straw hats','codelulu','hallucination station','techies','frontier',
  'goodachari grid','fabulous four','team raju','sentinel','energy','immortal','boomers','d3code',
  'velocity build','gpt warriors','devsync');
-- NOTE: TriCore is listed in BOTH sheets; it is placed in Incubation Center above.
-- Not in either sheet (left unassigned, move them from the Teams tab): Quadra, TEAM GAMMA, TEST ALPHA, TEST BETA.

-- Quick check after running:
-- select bay, count(*), string_agg(team_name, ', ' order by team_name) from public.teams group by bay;

grant all on all tables in schema public to postgres, service_role;
grant all on all sequences in schema public to postgres, service_role;
grant all on all routines in schema public to postgres, service_role;


-- ======================= ui_v4_password_status.sql =======================
-- ============================================================================
-- DAEMON HOUR · v4 — team password changed tracking
-- Optional DDL to store the password change timestamp on the teams table.
-- The admin console also reads from activity_log seamlessly.
-- ============================================================================

alter table public.teams add column if not exists password_changed_at timestamptz;

grant all on all tables in schema public to postgres, service_role;
grant all on all sequences in schema public to postgres, service_role;
grant all on all routines in schema public to postgres, service_role;

-- ======================= ui_v5_members_reset.sql =======================
-- ============================================================================
-- DAEMON HOUR · v5 — team members, visible team passwords, help desk, resets
-- Re-runnable and upgrades existing team_members table cleanly.
-- ============================================================================

-- ---------- 1. Team members (lead + teammates) ----------
create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  role text not null default 'member' check (role in ('lead','member')),
  full_name text,
  usn text, department text, year text, phone text, email text, college text,
  checked_in boolean not null default false,
  created_at timestamptz not null default now()
);

-- Upgrade existing columns if team_members already existed
alter table public.team_members
  add column if not exists role text not null default 'member' check (role in ('lead','member')),
  add column if not exists full_name text,
  add column if not exists usn text,
  add column if not exists department text,
  add column if not exists year text,
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists college text,
  add column if not exists checked_in boolean not null default false;

-- Migrate data from previous schema columns if present
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='team_members' and column_name='member_name') then
    update public.team_members set full_name = member_name where full_name is null and member_name is not null;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='team_members' and column_name='member_order') then
    update public.team_members set role = 'lead' where member_order = 1;
  end if;
end $$;

update public.team_members set full_name = 'Member' where full_name is null or trim(full_name) = '';
alter table public.team_members alter column full_name set not null;

create index if not exists team_members_team_idx on public.team_members(team_id);
-- at most one lead per team
create unique index if not exists team_members_one_lead on public.team_members(team_id) where role = 'lead';

alter table public.team_members enable row level security;
drop policy if exists "members own or staff" on public.team_members;
create policy "members own or staff" on public.team_members for select to authenticated
  using (team_id = public.current_team_id() or public.is_staff());
grant select on public.team_members to authenticated;
revoke insert, update, delete, truncate on public.team_members from authenticated, anon;

-- ---------- 2. Team passwords, readable by organisers only ----------
create table if not exists public.team_secrets (
  team_id uuid primary key references public.teams(id) on delete cascade,
  password text,
  source text not null default 'default',   -- default | organiser | team
  updated_at timestamptz not null default now()
);
alter table public.team_secrets enable row level security;
revoke all on public.team_secrets from authenticated, anon;

-- Ensure password_changed_at exists on teams
alter table public.teams add column if not exists password_changed_at timestamptz;

-- Seed starting passwords
insert into public.team_secrets (team_id, password, source)
select id,
       case when password_changed_at is not null then null
            when username = 'S' then 'S_123456'
            else username || '_123' end,
       case when password_changed_at is not null then 'team' else 'default' end
from public.teams
on conflict (team_id) do nothing;

-- ---------- 3. Help desk: a team taps "Need help", the floor admin sees it ----------
create table if not exists public.help_requests (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  message text,
  status text not null default 'open' check (status in ('open','resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
alter table public.help_requests enable row level security;
drop policy if exists "help own or staff" on public.help_requests;
create policy "help own or staff" on public.help_requests for select to authenticated
  using (team_id = public.current_team_id() or public.is_staff());
grant select on public.help_requests to authenticated;
revoke insert, update, delete, truncate on public.help_requests from authenticated, anon;

-- ---------- 4. Portal switches ----------
alter table public.event_settings
  add column if not exists portal_locked  boolean not null default false,
  add column if not exists portal_message text;

grant all on all tables in schema public to postgres, service_role;
grant all on all sequences in schema public to postgres, service_role;

do $$
declare t text;
begin
  foreach t in array array['team_members','help_requests'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; when undefined_object then null; end;
  end loop;
end $$;

-- ======================= ui_v6_hardening.sql =======================
-- ============================================================================
-- DAEMON HOUR · v6 — hardening for event day (run AFTER ui_v5). Re-runnable.
--   1. Foreign keys: deleting a team or an organiser can never be blocked
--      (team rows cascade; "created_by" style links become NULL)
--   2. admin_set_bingo: stamp/unstamp is explicit, so two volunteers tapping
--      the same dare can't accidentally undo each other
--   3. team_balances(): one fast aggregate instead of shipping every ledger row
--   4. Indexes for the hot queries
-- ============================================================================

-- 1. Rebuild every FK that points at public.teams or auth.users -------------
do $$
declare r record; v_action text;
begin
  for r in
    select c.conname, n.nspname as sch, t.relname as tbl, a.attname as col,
           fn.nspname as fsch, ft.relname as ftbl, fa.attname as fcol, c.confdeltype
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
    join pg_class ft on ft.oid = c.confrelid join pg_namespace fn on fn.oid = ft.relnamespace
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    join pg_attribute fa on fa.attrelid = c.confrelid and fa.attnum = c.confkey[1]
    where c.contype = 'f' and array_length(c.conkey, 1) = 1 and n.nspname = 'public'
      and ((fn.nspname = 'public' and ft.relname = 'teams') or (fn.nspname = 'auth' and ft.relname = 'users'))
  loop
    -- team-owned rows go with the team; any other link to a person is just cleared
    if r.ftbl = 'teams' and r.col in ('team_id') then v_action := 'cascade';
    elsif r.ftbl = 'users' and r.tbl = 'profiles' and r.col = 'id' then v_action := 'cascade';
    else v_action := 'set null';
    end if;
    if (v_action = 'cascade' and r.confdeltype = 'c') or (v_action = 'set null' and r.confdeltype = 'n') then continue; end if;
    execute format('alter table %I.%I drop constraint %I', r.sch, r.tbl, r.conname);
    if v_action = 'set null' then
      execute format('alter table %I.%I alter column %I drop not null', r.sch, r.tbl, r.col);
    end if;
    execute format('alter table %I.%I add constraint %I foreign key (%I) references %I.%I(%I) on delete %s',
      r.sch, r.tbl, r.conname, r.col, r.fsch, r.ftbl, r.fcol, v_action);
  end loop;
end $$;

-- 2. Explicit bingo stamp ------------------------------------------------------
create or replace function public.admin_set_bingo(p_team_id uuid, p_idx integer, p_on boolean, p_admin uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_has boolean;
begin
  perform 1 from public.teams where id = p_team_id for update;   -- serialise per team
  if not found then raise exception 'Team not found'; end if;
  select exists(select 1 from public.team_bingo where team_id = p_team_id and idx = p_idx) into v_has;
  if v_has = p_on then
    return jsonb_build_object('marked', v_has, 'noop', true);     -- someone already did it
  end if;
  return public.admin_toggle_bingo(p_team_id, p_idx, p_admin);
end $$;
revoke all on function public.admin_set_bingo(uuid, integer, boolean, uuid) from public, anon, authenticated;
grant execute on function public.admin_set_bingo(uuid, integer, boolean, uuid) to postgres, service_role;

-- 3. Balances in one round-trip ---------------------------------------------
create or replace function public.team_balances()
returns table(team_id uuid, balance bigint) language sql stable security definer set search_path = '' as $$
  select team_id, coalesce(sum(points), 0)::bigint from public.transactions group by team_id
$$;
revoke all on function public.team_balances() from public, anon, authenticated;
grant execute on function public.team_balances() to postgres, service_role;

-- 4. Indexes for hot paths ---------------------------------------------------
create index if not exists transactions_team_idx   on public.transactions(team_id);
create index if not exists transactions_created_idx on public.transactions(created_at desc);
create index if not exists purchases_team_idx      on public.purchases(team_id);
create index if not exists purchases_item_idx      on public.purchases(item_id);
create index if not exists team_stages_team_idx    on public.team_stages(team_id);
create index if not exists help_open_idx           on public.help_requests(status) where status = 'open';
create index if not exists teams_bay_idx           on public.teams(bay);
create index if not exists profiles_team_idx       on public.profiles(team_id);

grant all on all tables in schema public to postgres, service_role;
grant all on all sequences in schema public to postgres, service_role;
grant all on all routines in schema public to postgres, service_role;


-- ======================= ui_v7_schema_doctor.sql =======================
-- ============================================================================
-- DAEMON HOUR · v7 — SCHEMA DOCTOR
-- Brings every table the app uses to exactly the shape the code expects,
-- whatever state the database is in (older tables from earlier versions,
-- half-applied migrations, legacy NOT NULL columns, missing unique keys).
-- Safe to run any number of times, before or after the other migrations.
-- ============================================================================

-- 1. Every column the app reads or writes ------------------------------------
do $$
declare
  spec text[][] := array[
    -- table, column, type + default
    ['teams','bay','text'], ['teams','paddle','integer'], ['teams','password_changed_at','timestamptz'],
    ['profiles','venue','text'], ['profiles','must_change_password','boolean not null default false'],
    ['auction_items','min_price','integer'], ['auction_items','max_price','integer'], ['auction_items','price_step','integer not null default 10'],
    ['auction_items','quantity','integer not null default 1'], ['auction_items','description','text'], ['auction_items','powerup_id','uuid'],
    ['auction_items','is_active','boolean not null default true'], ['auction_items','base_points','integer not null default 0'],
    ['team_stages','opened_at','timestamptz'], ['team_stages','closed_at','timestamptz'], ['team_stages','closing_points','integer'], ['team_stages','closing_end_at','timestamptz'],
    ['powerups','description','text'], ['powerups','minutes_delta','integer not null default 0'], ['powerups','targets_rival','boolean not null default false'],
    ['powerups','color','text not null default ''cyan'''], ['powerups','is_active','boolean not null default true'], ['powerups','created_at','timestamptz not null default now()'],
    ['team_powerups','powerup_id','uuid'], ['team_powerups','name','text'], ['team_powerups','minutes_delta','integer not null default 0'], ['team_powerups','target_team_id','uuid'],
    ['team_powerups','source','text not null default ''manual'''], ['team_powerups','note','text'], ['team_powerups','used','boolean not null default false'],
    ['team_powerups','purchase_id','uuid'], ['team_powerups','created_by','uuid'], ['team_powerups','created_at','timestamptz not null default now()'],
    ['bingo_cells','idx','integer'], ['bingo_cells','label','text'], ['bingo_cells','points','integer not null default 10'], ['bingo_cells','is_free','boolean not null default false'],
    ['team_bingo','idx','integer'], ['team_bingo','marked_by','uuid'], ['team_bingo','marked_at','timestamptz not null default now()'],
    ['team_members','role','text not null default ''member'''], ['team_members','full_name','text'], ['team_members','usn','text'], ['team_members','department','text'],
    ['team_members','year','text'], ['team_members','phone','text'], ['team_members','email','text'], ['team_members','college','text'],
    ['team_members','checked_in','boolean not null default false'], ['team_members','created_at','timestamptz not null default now()'],
    ['activity_log','minutes','integer'], ['activity_log','points','integer'], ['activity_log','actor','uuid'],
    ['help_requests','message','text'], ['help_requests','status','text not null default ''open'''], ['help_requests','resolved_at','timestamptz'],
    ['team_secrets','password','text'], ['team_secrets','source','text not null default ''default'''], ['team_secrets','updated_at','timestamptz not null default now()'],
    ['event_settings','hackathon_end_at','timestamptz'], ['event_settings','hackathon_started_at','timestamptz'], ['event_settings','clock_paused_at','timestamptz'],
    ['event_settings','live_lot','jsonb'], ['event_settings','live_lots','jsonb not null default ''{}''::jsonb'], ['event_settings','broadcast','text'],
    ['event_settings','broadcasts','jsonb not null default ''{}''::jsonb'], ['event_settings','bingo_line_bonus','integer not null default 50'],
    ['event_settings','bingo_full_bonus','integer not null default 100'], ['event_settings','bingo_rewards','jsonb not null default ''{}''::jsonb'],
    ['event_settings','leaderboard_visible','boolean not null default false'], ['event_settings','portal_locked','boolean not null default false'],
    ['event_settings','portal_message','text'], ['event_settings','starting_points','integer not null default 0']
  ];
  i int;
begin
  for i in 1..array_length(spec, 1) loop
    if to_regclass('public.' || spec[i][1]) is not null then
      execute format('alter table public.%I add column if not exists %I %s', spec[i][1], spec[i][2], spec[i][3]);
    end if;
  end loop;
end $$;

-- 2. Carry data over from older column names --------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='team_bingo' and column_name='cell_index') then
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='team_bingo' and column_name='completed') then
      execute 'delete from public.team_bingo where completed is false';
    end if;
    execute 'update public.team_bingo set idx = cell_index where idx is null';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='team_members' and column_name='member_name') then
    execute 'update public.team_members set full_name = member_name where full_name is null';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='team_members' and column_name='member_order') then
    execute 'update public.team_members set role = ''lead'' where member_order = 1 and not exists (select 1 from public.team_members m2 where m2.team_id = team_members.team_id and m2.role = ''lead'')';
  end if;
  if to_regclass('public.team_bingo') is not null then delete from public.team_bingo where idx is null; end if;
  if to_regclass('public.team_members') is not null then update public.team_members set full_name = 'Member' where full_name is null or trim(full_name) = ''; end if;
  if to_regclass('public.team_powerups') is not null then update public.team_powerups set name = 'Power-up' where name is null; end if;
end $$;

-- 3. Older NOT NULL columns the app never writes must not block inserts -------
do $$
declare r record;
  known text[] := array[
    'teams.id','teams.team_name','teams.username',
    'profiles.id','profiles.role',
    'transactions.id','transactions.team_id','transactions.description','transactions.points','transactions.transaction_type',
    'auction_items.id','auction_items.item_name',
    'purchases.id','purchases.team_id','purchases.item_id','purchases.purchase_price',
    'team_stages.team_id','team_stages.activity','team_stages.status',
    'powerups.id','powerups.name',
    'team_powerups.id','team_powerups.team_id','team_powerups.source',
    'bingo_cells.idx','bingo_cells.label',
    'team_bingo.team_id','team_bingo.idx',
    'team_members.id','team_members.team_id','team_members.role','team_members.full_name',
    'activity_log.id','activity_log.kind','activity_log.action','activity_log.label',
    'help_requests.id','help_requests.team_id','help_requests.status',
    'team_secrets.team_id','event_settings.id'];
begin
  for r in
    select c.table_name, c.column_name from information_schema.columns c
    where c.table_schema = 'public' and c.is_nullable = 'NO' and c.column_default is null
      and c.table_name in ('teams','profiles','transactions','auction_items','purchases','team_stages','powerups','team_powerups',
                           'bingo_cells','team_bingo','team_members','activity_log','help_requests','team_secrets','event_settings')
      and (c.table_name || '.' || c.column_name) <> all(known)
      and not exists (  -- leave primary-key columns alone
        select 1 from pg_index ix join pg_attribute a on a.attrelid = ix.indrelid and a.attnum = any(ix.indkey)
        where ix.indrelid = ('public.' || c.table_name)::regclass and ix.indisprimary and a.attname = c.column_name)
  loop
    execute format('alter table public.%I alter column %I drop not null', r.table_name, r.column_name);
    raise notice 'relaxed legacy NOT NULL: %.%', r.table_name, r.column_name;
  end loop;
end $$;

-- 4. Unique keys the app relies on (upserts / one-per-team rules) -------------
do $$
begin
  if to_regclass('public.team_stages') is not null then
    delete from public.team_stages a using public.team_stages b where a.ctid < b.ctid and a.team_id = b.team_id and a.activity = b.activity;
    create unique index if not exists team_stages_team_activity_key on public.team_stages(team_id, activity);
  end if;
  if to_regclass('public.team_bingo') is not null then
    delete from public.team_bingo a using public.team_bingo b where a.ctid < b.ctid and a.team_id = b.team_id and a.idx = b.idx;
    create unique index if not exists team_bingo_team_idx_key on public.team_bingo(team_id, idx);
  end if;
  if to_regclass('public.bingo_cells') is not null then
    delete from public.bingo_cells a using public.bingo_cells b where a.ctid < b.ctid and a.idx = b.idx;
    create unique index if not exists bingo_cells_idx_key on public.bingo_cells(idx);
  end if;
  if to_regclass('public.team_secrets') is not null then
    create unique index if not exists team_secrets_team_key on public.team_secrets(team_id);
  end if;
  if to_regclass('public.event_settings') is not null and not exists (select 1 from public.event_settings) then
    insert into public.event_settings default values;
  end if;
end $$;

-- 5. Service role can always reach everything ---------------------------------
grant usage on schema public to postgres, service_role;
grant all on all tables in schema public to postgres, service_role;
grant all on all sequences in schema public to postgres, service_role;
grant execute on all functions in schema public to postgres, service_role;

-- 6. Health report: run this after; every row should say OK ------------------
-- select * from public.daemon_health();
create or replace function public.daemon_health()
returns table(item text, status text) language plpgsql security definer set search_path = '' as $$
declare t text; f text;
begin
  foreach t in array array['teams','profiles','transactions','auction_items','purchases','team_stages','powerups','team_powerups',
                           'bingo_cells','team_bingo','team_members','activity_log','help_requests','team_secrets','event_settings'] loop
    item := 'table ' || t; status := case when to_regclass('public.' || t) is null then 'MISSING' else 'OK' end; return next;
  end loop;
  foreach f in array array['admin_sell_lot','admin_undo_sale','admin_toggle_bingo','admin_set_bingo','team_balances','is_staff','current_team_id'] loop
    item := 'function ' || f; status := case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = f) then 'OK' else 'MISSING' end; return next;
  end loop;
  item := 'bingo squares'; status := (select case when count(*) = 25 then 'OK' else count(*) || ' of 25' end from public.bingo_cells); return next;
  item := 'event settings row'; status := case when exists (select 1 from public.event_settings) then 'OK' else 'MISSING' end; return next;
  item := 'realtime publication'; status := (select case when count(*) >= 6 then 'OK' else count(*) || ' tables published' end
    from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename in ('transactions','purchases','team_stages','team_powerups','team_bingo','event_settings','activity_log','team_members','help_requests')); return next;
end $$;
revoke all on function public.daemon_health() from public, anon, authenticated;
grant execute on function public.daemon_health() to postgres, service_role;

select * from public.daemon_health();
