-- 20 Nov · results night
-- 1) winners celebration switches (Admin → Evaluation → Winners)
alter table public.event_settings add column if not exists winners jsonb;
alter table public.event_settings add column if not exists winners_announced boolean not null default false;
grant all on public.evaluation_scores to postgres, service_role;
grant all on public.certificates      to postgres, service_role;

-- 2) wipe EVERY old banner (the stale "1 HOUR LEFT" was saved under the old venue key)
--    and make "Results are out" the only announcement
update public.event_settings
set broadcasts = jsonb_build_object('all', 'RESULTS ARE OUT!  Open the Evaluation tab to see your final score.'),
    broadcast  = null
where id = true;

select broadcasts, broadcast, winners_announced from public.event_settings where id = true;
