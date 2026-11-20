-- ============================================================================
-- DAEMON HOUR v19 · Evaluation round (out of 80) + certificates
-- Safe to re-run. Nothing is visible to teams until you publish from Admin → Evaluation.
-- ============================================================================

-- 1) marks: 4 criteria × 20 = 80. A team with no row = "not evaluated" (not 0).
create table if not exists public.evaluation_scores (
  team_id      uuid primary key references public.teams(id) on delete cascade,
  impact       int check (impact between 0 and 20),
  innovation   int check (innovation between 0 and 20),
  presentation int check (presentation between 0 and 20),
  prototype    int check (prototype between 0 and 20),
  remarks      text,
  updated_at   timestamptz not null default now(),
  updated_by   uuid
);
alter table public.evaluation_scores enable row level security;   -- server (service role) only

-- 2) certificates: files live in a PRIVATE storage bucket; teams only get short signed links
create table if not exists public.certificates (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  member_name text,                     -- null = for the whole team
  label       text not null default 'Participation',
  file_path   text not null unique,
  file_name   text not null,
  created_at  timestamptz not null default now()
);
create index if not exists certificates_team on public.certificates(team_id);
alter table public.certificates enable row level security;

do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('certificates', 'certificates', false, 15728640, array['application/pdf','image/png','image/jpeg'])
    on conflict (id) do update set public = false;
  end if;
end $$;

-- 3) publish switches (all OFF = teams see nothing)
alter table public.event_settings add column if not exists eval_published   boolean not null default false;
alter table public.event_settings add column if not exists eval_columns     jsonb   not null default '["impact","innovation","presentation","prototype"]'::jsonb;
alter table public.event_settings add column if not exists eval_show_remarks boolean not null default false;
alter table public.event_settings add column if not exists certs_published  boolean not null default false;

-- 4) team screens refresh when their marks / certificates change
do $$ declare t text; begin
  if to_regprocedure('public.dh_bump_team()') is not null then
    foreach t in array array['evaluation_scores','certificates'] loop
      execute format('drop trigger if exists dh_pulse on public.%I', t);
      execute format('create trigger dh_pulse after insert or update or delete on public.%I for each row execute function public.dh_bump_team()', t);
    end loop;
  end if;
end $$;

-- the server (service_role) must be able to read/write these; teams never touch them directly
grant all on public.evaluation_scores to postgres, service_role;
grant all on public.certificates      to postgres, service_role;

select 'v19 evaluation ready' as status;

-- v19.1 winners celebration (Admin → Evaluation → Announce winners)
alter table public.event_settings add column if not exists winners jsonb;
alter table public.event_settings add column if not exists winners_announced boolean not null default false;
