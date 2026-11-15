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
