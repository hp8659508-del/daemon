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

-- the whole pulse in one round trip
create or replace function public.dh_pulse()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'v', coalesce((select jsonb_object_agg(key, v) from public.dh_versions), '{}'::jsonb),
    'lots', coalesce((select live_lots from public.event_settings where id = true), '{}'::jsonb),
    'at', now()
  )
$$;
-- browsers read the pulse straight from Supabase (no Vercel request per poll). It holds only
-- change counters and the live auction lot, nothing private.
revoke all on function public.dh_pulse() from public;
grant execute on function public.dh_pulse() to anon, authenticated, postgres, service_role;
revoke all on function public.dh_bump_key(text) from public, anon, authenticated;
grant all on public.dh_versions to postgres, service_role;

-- indexes for the quiz under load
create index if not exists quiz_flags_team_idx on public.quiz_flags(team_id);
create index if not exists quiz_answers_question_idx on public.quiz_answers(question_id);
create index if not exists team_bingo_team_idx on public.team_bingo(team_id);
