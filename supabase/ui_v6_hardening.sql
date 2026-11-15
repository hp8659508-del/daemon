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

