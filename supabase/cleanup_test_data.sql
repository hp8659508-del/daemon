-- ============================================================================
-- DAEMON HOUR · ONE-TIME CLEANUP of test data (run once, before the auction)
--
-- KEEPS:   teams, logins, members, venues, team numbers
--          Rapid Fire: questions, every team's answers and scores, and the Rapid Fire points
--          the auction cards (catalogue) and spin wheel segments, bingo squares, settings
-- REMOVES: every card a team holds (auction, spin, trump), every sale,
--          problem statements (+ swap locks), penalties, power-ups/time changes,
--          bingo stamps + row/column lock, round ledgers, help requests,
--          all points EXCEPT Rapid Fire, history EXCEPT Rapid Fire,
--          the live auction lot. Auction / Spin / Bingo rounds go back to "upcoming".
--
-- Step 1 (optional): select only the PREVIEW block below and run it to see what will go.
-- Step 2: run the whole file.
-- ============================================================================

-- PREVIEW ------------------------------------------------------------------
select 'cards held' as what, count(*) from public.team_cards
union all select 'auction sales', count(*) from public.purchases
union all select 'problem statements set', count(*) from public.teams where problem_statement is not null
union all select 'penalties', count(*) from public.penalties
union all select 'time changes', count(*) from public.team_powerups
union all select 'bingo stamps', count(*) from public.team_bingo
union all select 'points entries removed (not Rapid Fire)', count(*) from public.transactions where description not like 'Rapid fire:%'
union all select 'points entries kept (Rapid Fire)', count(*) from public.transactions where description like 'Rapid fire:%';

-- CLEANUP ------------------------------------------------------------------
begin;
  delete from public.team_cards;
  delete from public.purchases;
  delete from public.penalties;
  delete from public.team_powerups;
  delete from public.team_bingo;
  delete from public.team_ledger;
  delete from public.help_requests;
  delete from public.transactions where description not like 'Rapid fire:%';
  delete from public.activity_log where kind <> 'quiz';
  delete from public.team_stages where activity in ('auction', 'spin', 'bingo');
  update public.teams set problem_statement = null, ps_locked = false, bingo_mode = null;
  do $$ begin if exists (select 1 from information_schema.columns where table_schema='public' and table_name='teams' and column_name='ps_no') then update public.teams set ps_no = null; end if; end $$;
  update public.event_settings set live_lots = '{}'::jsonb, live_lot = null where id = true;
commit;

-- RESULT: every team's points should now equal its Rapid Fire score
select t.paddle as "#", t.team_name, coalesce(sum(x.points), 0) as points
from public.teams t left join public.transactions x on x.team_id = t.id and x.wallet = 'main'
group by t.paddle, t.team_name order by t.paddle nulls last;
