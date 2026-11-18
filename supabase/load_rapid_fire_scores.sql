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
