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
