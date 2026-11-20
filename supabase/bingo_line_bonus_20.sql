-- Bingo: a completed row/column bonus is 20 points (not 100). Safe to re-run.
begin;
update public.event_settings set bingo_line_bonus = 20,
  bingo_rewards = (select coalesce(jsonb_object_agg(k, '20'), '{}'::jsonb) from jsonb_object_keys(coalesce(bingo_rewards,'{}'::jsonb)) k)
where id = true;

-- re-price bonuses already paid (the row/column lock reversals stay, just at 20)
update public.transactions set points =  20 where description in ('Bingo row bonus','Bingo column bonus');
update public.transactions set points = -20 where description in ('Bingo row bonus undo','Bingo column bonus undo');
update public.activity_log set points =  20 where kind = 'bingo' and action = 'granted' and label in ('Row completed','Column completed');
update public.activity_log set points = -20 where kind = 'bingo' and action = 'removed' and label in ('Row bonus reversed','Column bonus reversed');

-- keep the grey "Round completed" confirmed points in step
update public.team_stages s set closing_points = (
  select coalesce(sum(x.points),0) from public.transactions x
  where x.team_id = s.team_id and coalesce(x.wallet,'main') <> 'auction' and x.created_at <= s.closed_at)
where s.status = 'closed' and s.closed_at is not null;
commit;

select t.paddle no, t.team_name,
  (select count(*) from public.team_bingo b where b.team_id = t.id) boxes,
  coalesce((select sum(points) from public.transactions x where x.team_id=t.id and x.description like 'Bingo: %'),0) box_pts,
  coalesce((select sum(points) from public.transactions x where x.team_id=t.id and x.description like 'Bingo%bonus%'),0) line_pts,
  coalesce((select sum(points) from public.transactions x where x.team_id=t.id and coalesce(x.wallet,'main')<>'auction'),0) main_points
from public.teams t order by t.paddle;
