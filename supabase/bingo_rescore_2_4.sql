-- Bingo rescore: every box = 2 points, every completed row/column bonus = 4 points.
-- Applies to ALL teams from the boxes they have stamped right now (no re-entering). Safe to re-run.
begin;
update public.bingo_cells set points = 2 where not is_free;
update public.event_settings set bingo_line_bonus = 4, bingo_full_bonus = 0,
  bingo_rewards = (select coalesce(jsonb_object_agg(k, '4'), '{}'::jsonb) from jsonb_object_keys(coalesce(bingo_rewards,'{}'::jsonb)) k)
where id = true;

-- box payments rebuilt from current stamps: +2 each, at the time it was stamped
delete from public.transactions where description like 'Bingo: %' or description like 'Bingo undo: %';
insert into public.transactions (team_id, description, points, transaction_type, wallet, created_by, created_at)
select b.team_id, 'Bingo: ' || c.label, 2, 'bonus', 'main', b.marked_by, b.marked_at
from public.team_bingo b join public.bingo_cells c on c.idx = b.idx where not c.is_free;

-- line bonuses already paid → 4 (reversed column bonuses → -4, so they still cancel)
update public.transactions set points =  4 where description in ('Bingo row bonus','Bingo column bonus');
update public.transactions set points = -4 where description in ('Bingo row bonus undo','Bingo column bonus undo');
delete from public.transactions where description in ('Bingo full card bonus','Bingo full card bonus undo');

update public.activity_log set points =  2 where kind = 'bingo' and action = 'stamped';
update public.activity_log set points = -2 where kind = 'bingo' and action = 'unstamped';
update public.activity_log set points =  4 where kind = 'bingo' and action = 'granted' and label in ('Row completed','Column completed');
update public.activity_log set points = -4 where kind = 'bingo' and action = 'removed' and label in ('Row bonus reversed','Column bonus reversed');

-- grey "Round completed" confirmed points follow
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
from public.teams t order by main_points desc;
