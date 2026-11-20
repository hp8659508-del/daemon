-- Announce the winners: 1st Straw Hats · 2nd Velocity Build · 3rd Sentinel.
-- Each of these teams gets its full-screen celebration every time it opens its dashboard.
-- (Same as Admin → Evaluation → Winners → Announce winners. To hide: set winners_announced = false.)
alter table public.event_settings add column if not exists winners jsonb;
alter table public.event_settings add column if not exists winners_announced boolean not null default false;

with w as (
  select max(id::text) filter (where rtrim(regexp_replace(lower(team_name),'[^a-z0-9]','','g'),'s') = 'strawhat')      as first,
         max(id::text) filter (where rtrim(regexp_replace(lower(team_name),'[^a-z0-9]','','g'),'s') = 'velocitybuild') as second,
         max(id::text) filter (where rtrim(regexp_replace(lower(team_name),'[^a-z0-9]','','g'),'s') = 'sentinel')      as third
  from public.teams
)
update public.event_settings s
set winners = jsonb_build_object('first', w.first, 'second', w.second, 'third', w.third), winners_announced = true
from w where s.id = true and w.first is not null and w.second is not null and w.third is not null;

select (select team_name from public.teams where id::text = winners->>'first')  as first,
       (select team_name from public.teams where id::text = winners->>'second') as second,
       (select team_name from public.teams where id::text = winners->>'third')  as third,
       winners_announced
from public.event_settings where id = true;
