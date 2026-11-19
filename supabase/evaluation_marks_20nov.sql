-- Evaluation marks from "daemon hours - Google Sheets" (20 Nov).
-- Columns: Real world (impact) · Unique (innovation) · Presentation · Prototype — 20 each, 80 total.
-- Replaces these teams' marks. If evaluation is already PUBLISHED, their main points update too.
-- Not in the sheet (left unmarked): #2 Boomers, #7 Firewalls, #10 GPT Warriors, #15 Mechforge.
-- #30 Aligators is in the sheet but isn't a team on the site → skipped.
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
 (29,'Velocity Build',        14,14,14,14, null);

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

-- keep main points in step if scores are already published (same as the Publish button)
delete from public.transactions x using evm m where x.team_id = m.team_id and x.description like 'Evaluation:%';
insert into public.transactions (team_id, description, points, transaction_type, wallet)
select team_id, 'Evaluation: final score '||(rw+uq+pr+pt)||'/80', rw+uq+pr+pt, 'adjustment', 'main' from evm
where (select eval_published from public.event_settings where id) and rw+uq+pr+pt <> 0;

insert into public.activity_log (team_id, kind, action, label)
select team_id, 'eval', 'marked', 'Evaluation marks loaded: '||(rw+uq+pr+pt)||'/80' from evm;
commit;

select t.paddle no, t.team_name, e.impact real_world, e.innovation uniq, e.presentation, e.prototype,
       e.impact+e.innovation+e.presentation+e.prototype total
from public.teams t left join public.evaluation_scores e on e.team_id = t.id order by t.paddle;
