-- Rapid Fire: mark the round COMPLETED for every team (grey dot, "Round completed" in the ledger).
-- Safe to run any time, including after the auction has started: it only touches the quiz round.
-- Completed at 17 Nov 2026, 5:00 pm IST (after the last recovered score, 4:51 pm).
begin;

insert into public.team_stages (team_id, activity, status, opened_at, closed_at, closing_points, closing_end_at)
select t.id, 'quiz', 'closed',
       timestamptz '2026-11-17 16:00:00+05:30',
       timestamptz '2026-11-17 17:00:00+05:30',
       coalesce((select sum(x.points) from public.transactions x
                 where x.team_id = t.id and coalesce(x.wallet, 'main') <> 'auction'
                   and x.created_at <= timestamptz '2026-11-17 17:00:00+05:30'), 0),
       null
from public.teams t
on conflict (team_id, activity) do update
  set status = 'closed', opened_at = excluded.opened_at, closed_at = excluded.closed_at,
      closing_points = excluded.closing_points, closing_end_at = null;

-- one history line per team (skipped if already there)
insert into public.activity_log (team_id, kind, action, label, points, created_at)
select s.team_id, 'round', 'closed', 'Rapid Fire · round completed', s.closing_points, s.closed_at
from public.team_stages s
where s.activity = 'quiz' and s.status = 'closed'
  and not exists (select 1 from public.activity_log a
                  where a.team_id = s.team_id and a.label = 'Rapid Fire · round completed');

commit;

-- check: every team should show quiz = closed
select t.team_name, s.status, s.closed_at at time zone 'Asia/Kolkata' as completed_ist, s.closing_points
from public.teams t left join public.team_stages s on s.team_id = t.id and s.activity = 'quiz'
order by t.team_name;
