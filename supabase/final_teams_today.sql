-- ============================================================================
-- DAEMON HOUR · final teams for today (18 Nov) — from daemon_hour.xlsx
--  • team numbers (paddles) 1–29 exactly as in the sheet
--  • every team NOT in the sheet is removed (with its sign-in, cards, points, history)
--  • one venue only: everyone is in Incubation Center (Idea Lab admins move there too)
-- Stops without changing anything if a sheet name can't be matched to a team on the site.
-- ============================================================================
begin;

create temp table final_teams(paddle int, name text) on commit drop;
insert into final_teams values
  (1,'AppVengers'),(2,'Boomers'),(3,'Code berry'),(4,'Codelulu'),(5,'DBC'),
  (6,'Energy'),(7,'Firewalls'),(8,'Alpha'),(9,'Frontier'),(10,'GPT Warriors'),
  (11,'Hakuna Matata'),(12,'Immortal'),(13,'Logic Legends'),(14,'LoopX'),(15,'Mechforge'),
  (16,'NuronX'),(17,'Quadra'),(18,'Quantum Crew'),(19,'S⁴'),(20,'Sentinel'),
  (21,'Straw Hats'),(22,'Synergy'),(23,'Team Raju'),(24,'Team TRPS'),(25,'Techies'),
  (26,'Teen-Bhai-Teeno-tabahi'),(27,'The Outliers'),(28,'TriCore'),(29,'Velocity Build');

-- forgiving match: ignore case, spaces, punctuation and a trailing "s" (Immortal = Immortals)
create or replace function pg_temp.k(s text) returns text language sql immutable as
$$ select rtrim(regexp_replace(lower(coalesce(s,'')), '[^a-z0-9⁴]', '', 'g'), 's') $$;

create temp table matched on commit drop as
select f.paddle, f.name, t.id as team_id, t.team_name
from final_teams f left join public.teams t on pg_temp.k(t.team_name) = pg_temp.k(f.name);

do $$
declare missing text; dup text;
begin
  select string_agg(paddle || ' ' || name, ', ' order by paddle) into missing from matched where team_id is null;
  if missing is not null then
    raise exception 'Not found on the site: %. Nothing was changed. If a team is new, add it in Teams first; if it is spelled differently, tell me the site name.', missing;
  end if;
  select string_agg(name, ', ') into dup from (select name from matched group by name having count(*) > 1) d;
  if dup is not null then raise exception 'Matched more than one site team: %. Nothing was changed.', dup; end if;
end $$;

-- 1) remove every team that is not in the final list (sign-ins first, then the team and all its rows)
delete from auth.users where id in (
  select p.id from public.profiles p
  where p.team_id is not null and p.team_id not in (select team_id from matched));
delete from public.teams where id not in (select team_id from matched);

-- 2) new team numbers (clear first so numbers can swap without clashing)
update public.teams set paddle = null;
update public.teams t set paddle = m.paddle from matched m where t.id = m.team_id;

-- 3) one venue: Incubation Center for every team and every venue admin
update public.teams set bay = 'Incubation Center';
update public.profiles set venue = 'Incubation Center' where venue = 'Idea Lab';
update public.event_settings set live_lots = coalesce(live_lots, '{}'::jsonb) - 'Idea Lab',
                                 broadcasts = coalesce(broadcasts, '{}'::jsonb) - 'Idea Lab';

commit;

-- check: 29 rows, numbers 1–29, all Incubation Center
select t.paddle as no, t.team_name, t.bay,
       coalesce((select sum(x.points) from public.transactions x where x.team_id = t.id and coalesce(x.wallet,'main') <> 'auction'), 0) as main_points
from public.teams t order by t.paddle;
