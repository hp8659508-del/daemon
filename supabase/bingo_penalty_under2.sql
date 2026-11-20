-- Bingo rule penalty: −2 points for every team that did NOT complete at least 2 rows
-- or at least 2 columns (rows only OR columns only — never a mix; free centre counts as done).
-- Includes teams that didn't play Bingo. Safe to re-run: a team is never penalised twice,
-- and the penalty is taken back if a team now has 2 lines.
-- Applied directly as a rule penalty (No penalties / Pass penalties cards are not used up).
begin;
create temp table bl on commit drop as
with s as (
  select t.id team_id, t.team_name, t.paddle,
         array(select idx from public.team_bingo b where b.team_id = t.id
               union select idx from public.bingo_cells where is_free) cells
  from public.teams t
)
select team_id, team_name, paddle,
  (select count(*) from generate_series(0,4) r where array[r*5,r*5+1,r*5+2,r*5+3,r*5+4] <@ cells)::int as full_rows,
  (select count(*) from generate_series(0,4) c where array[c,c+5,c+10,c+15,c+20] <@ cells)::int as full_cols
from s;

-- reset any earlier run, then apply to everyone with fewer than 2 rows AND fewer than 2 columns
delete from public.transactions where description = 'Penalty: Bingo: fewer than 2 rows or 2 columns';
delete from public.penalties    where reason      = 'Bingo: fewer than 2 rows or 2 columns';
insert into public.penalties (team_id, landed_team_id, minutes, points, reason, outcome, detail)
select team_id, team_id, 0, 2, 'Bingo: fewer than 2 rows or 2 columns', 'applied',
       format('%s row(s), %s column(s) completed', full_rows, full_cols)
from bl where full_rows < 2 and full_cols < 2;
insert into public.transactions (team_id, description, points, transaction_type, wallet)
select team_id, 'Penalty: Bingo: fewer than 2 rows or 2 columns', -2, 'adjustment', 'main'
from bl where full_rows < 2 and full_cols < 2;
insert into public.activity_log (team_id, kind, action, label, points)
select team_id, 'penalty', 'applied', 'Penalty: Bingo: fewer than 2 rows or 2 columns', -2
from bl where full_rows < 2 and full_cols < 2;
commit;

-- the list: who got the −2
select p.paddle no, p.team_name, split_part(x.detail, ',', 1) rows_done, trim(split_part(x.detail, ',', 2)) cols_done
from public.penalties x join public.teams p on p.id = x.team_id
where x.reason = 'Bingo: fewer than 2 rows or 2 columns' order by p.paddle;
