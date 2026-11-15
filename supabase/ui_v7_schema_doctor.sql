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
