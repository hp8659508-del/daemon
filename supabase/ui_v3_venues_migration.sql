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

