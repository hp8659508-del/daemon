-- ============================================================================
-- 20 Nov fixes · (1) Bingo: every box = 20 points  (2) Evaluation marks from the sheet
-- Safe to re-run. Does NOT publish evaluation.
-- ============================================================================

-- (1) BINGO ------------------------------------------------------------------
begin;
-- every box is worth 20 (the free centre square stays free — it's never stamped)
update public.bingo_cells set points = 20 where not is_free;

-- Rebuild every team's box payments from the boxes they have stamped RIGHT NOW
-- (no re-entering): one "Bingo: <dare>" row of +20 per stamped box, at the time it was stamped.
-- Old per-box rows (10/15/20, undo rows) are replaced. Line / full-card bonuses are untouched.
delete from public.transactions where description like 'Bingo: %' or description like 'Bingo undo: %';
insert into public.transactions (team_id, description, points, transaction_type, wallet, created_by, created_at)
select b.team_id, 'Bingo: ' || c.label, 20, 'bonus', 'main', b.marked_by, b.marked_at
from public.team_bingo b join public.bingo_cells c on c.idx = b.idx
where not c.is_free;
update public.activity_log set points = 20  where kind = 'bingo' and action = 'stamped'   and points is distinct from 20;
update public.activity_log set points = -20 where kind = 'bingo' and action = 'unstamped' and points is distinct from -20;

-- the grey "Round completed" line shows confirmed points: keep it in step
update public.team_stages s set closing_points = (
  select coalesce(sum(x.points),0) from public.transactions x
  where x.team_id = s.team_id and coalesce(x.wallet,'main') <> 'auction' and x.created_at <= s.closed_at)
where s.status = 'closed' and s.closed_at is not null and s.activity in ('bingo','eval','auction','spin');
commit;

select t.paddle no, t.team_name,
  (select count(*) from public.team_bingo b where b.team_id = t.id) boxes_stamped,
  coalesce((select sum(points) from public.transactions x where x.team_id = t.id and x.description like 'Bingo: %'), 0) box_points,
  coalesce((select sum(points) from public.transactions x where x.team_id = t.id and x.description like 'Bingo%bonus%'), 0) line_bonus
from public.teams t order by t.paddle;

-- (2) EVALUATION -------------------------------------------------------------
begin;
create temp table ev(no int, name text, rw int, uq int, pr int, pt int, note text) on commit drop;
insert into ev values
 ( 1,'AppVengers',            12,14,15,17, null),
 ( 3,'Code berry',            10,10,12,11, null),
 ( 4,'Codelulu',              14,12,15,13, 'UI'),
 ( 5,'DBC',                   12,11, 9,14, null),
 ( 6,'Energy',                12,12,13,11, null),
 ( 8,'Alpha',                 16,15,17,18, 'Only team to have exact app metrics; screenshots'),
 ( 9,'Frontier',               9, 9, 8, 9, null),
 (11,'Hakuna Matata',         12,11,15,13, 'Screenshots'),
 (12,'Immortal',              12,11,10,13, null),
 (13,'Logic Legends',          9,10,11,10, null),
 (14,'LoopX',                  7, 9,11, 7, null),
 (16,'NuronX',                 0, 0, 0, 0, null),
 (17,'Quadra',                10,11,10,12, null),
 (18,'Quantum Crew',          14,11,12,15, null),
 (19,'S⁴',                    16,13,18,19, null),
 (20,'Sentinel',              15,12,14,14, null),
 (21,'Straw Hats',            16,19,18,20, null),
 (22,'Synergy',               12,12,14,13, null),
 (23,'Team Raju',             11,12,12,13, null),
 (24,'Team TRPS',             12,15,13,11, null),
 (25,'Techies',                9,10,12,13, null),
 (26,'Teen-Bhai-Teeno-tabahi',10,11, 8,11, null),
 (27,'The Outliers',          11,12,12,10, null),
 (28,'TriCore',               14,13,14,13, null),
 (29,'Velocity Build',        14,14,14,14, null),
 (30,'Aligators',             10,13, 9,12, null);

create temp table evm on commit drop as
select e.*, t.id team_id, t.team_name, t.paddle from ev e
left join public.teams t on rtrim(regexp_replace(lower(t.team_name),'[^a-z0-9⁴]','','g'),'s') = rtrim(regexp_replace(lower(e.name),'[^a-z0-9⁴]','','g'),'s');
do $$ declare m text; begin
  select string_agg(no||' '||name, ', ') into m from evm where team_id is null;
  if m is not null then raise exception 'Not found on the site: %. Nothing changed.', m; end if;
end $$;

insert into public.evaluation_scores (team_id, impact, innovation, presentation, prototype, remarks, updated_at)
select team_id, rw, uq, pr, pt, note, now() from evm
on conflict (team_id) do update set impact=excluded.impact, innovation=excluded.innovation,
  presentation=excluded.presentation, prototype=excluded.prototype, remarks=excluded.remarks, updated_at=now();


insert into public.activity_log (team_id, kind, action, label)
select team_id, 'eval', 'marked', 'Evaluation marks loaded: '||(rw+uq+pr+pt)||'/80' from evm;
commit;

select t.paddle no, t.team_name, e.impact real_world, e.innovation uniq, e.presentation, e.prototype,
       e.impact+e.innovation+e.presentation+e.prototype total
from public.teams t left join public.evaluation_scores e on e.team_id = t.id order by t.paddle;
