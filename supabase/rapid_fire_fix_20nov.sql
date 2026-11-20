-- Rapid Fire score corrections (20 Nov): Team TRPS = 90, Frontier = 50, Sentinel = 90.
-- REPLACES each team's Rapid Fire points (not added on top); row dated 17 Nov 4–5 pm so it
-- sits in the Rapid Fire table of their Round ledger, before "Round completed".
begin;
create temp table rf_fix(name text, pts int, at timestamptz) on commit drop;
insert into rf_fix values
  ('Team TRPS', 90, '2026-11-17 16:38:00+05:30'),
  ('Frontier',  50, '2026-11-17 16:41:00+05:30'),
  ('Sentinel',  90, '2026-11-17 16:44:00+05:30');

create temp table rf_m on commit drop as
select f.*, t.id as team_id from rf_fix f
left join public.teams t on rtrim(regexp_replace(lower(t.team_name),'[^a-z0-9]','','g'),'s') = rtrim(regexp_replace(lower(f.name),'[^a-z0-9]','','g'),'s');
do $$ declare m text; begin
  select string_agg(name, ', ') into m from rf_m where team_id is null;
  if m is not null then raise exception 'Not found on the site: %. Nothing changed.', m; end if;
end $$;

delete from public.transactions x using rf_m m where x.team_id = m.team_id and x.description ilike 'Rapid fire:%';
insert into public.transactions (team_id, description, points, transaction_type, wallet, created_at)
select team_id, 'Rapid fire: Workshop quiz (set by organiser)', pts, 'adjustment', 'main', at from rf_m;

-- keep the grey "Round completed" line's confirmed points in step
update public.team_stages s set closing_points = (
  select coalesce(sum(x.points),0) from public.transactions x
  where x.team_id = s.team_id and coalesce(x.wallet,'main') <> 'auction' and x.created_at <= s.closed_at)
from rf_m m where s.team_id = m.team_id and s.activity = 'quiz' and s.status = 'closed';

insert into public.activity_log (team_id, kind, action, label, points)
select team_id, 'quiz', 'reset', 'Rapid Fire score set to ' || pts || ' by organiser', pts from rf_m;
commit;

select t.paddle no, t.team_name,
  (select sum(points) from public.transactions where team_id=t.id and description ilike 'Rapid fire:%') rapid_fire,
  (select sum(points) from public.transactions where team_id=t.id and coalesce(wallet,'main')<>'auction') main_points
from public.teams t
where rtrim(regexp_replace(lower(t.team_name),'[^a-z0-9]','','g'),'s') in ('teamtrp','frontier','sentinel') order by 1;
