-- ============================================================================
-- DAEMON HOUR · v14 — resilience. Run AFTER ui_v13_scale.sql. Re-runnable.
-- The pulse can now be asked for ONE team: a phone gets ~150 bytes instead of every
-- team's counter (1000 phones × a poll every few seconds × hours adds up against the
-- free plan's 5 GB data allowance). It also returns the server time so phones with a
-- wrong clock still show the right countdown.
-- ============================================================================
drop function if exists public.dh_pulse();
create or replace function public.dh_pulse(p_team uuid default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'v', coalesce((select jsonb_object_agg(key, v) from public.dh_versions
                    where p_team is null or key = 'global' or key = p_team::text), '{}'::jsonb),
    'lots', coalesce((select live_lots from public.event_settings where id = true), '{}'::jsonb),
    'at', now()
  )
$$;
revoke all on function public.dh_pulse(uuid) from public;
grant execute on function public.dh_pulse(uuid) to anon, authenticated, postgres, service_role;
