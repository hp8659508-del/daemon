-- View Bingo scores & stamped boxes per team
select 
  t.paddle as "no", 
  t.team_name,
  (select count(*) from public.team_bingo b where b.team_id = t.id) as boxes_stamped,
  coalesce((select sum(points) from public.transactions x where x.team_id = t.id and x.description like 'Bingo: %'), 0) as box_points,
  coalesce((select sum(points) from public.transactions x where x.team_id = t.id and x.description like 'Bingo%bonus%'), 0) as line_bonus,
  coalesce((select sum(points) from public.transactions x where x.team_id = t.id and (x.description like 'Bingo: %' or x.description like 'Bingo%bonus%')), 0) as total_bingo_pts
from public.teams t 
order by t.paddle;
