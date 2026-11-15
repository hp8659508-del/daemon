-- ============================================================================
-- DAEMON HOUR · v4 — team password changed tracking
-- Optional DDL to store the password change timestamp on the teams table.
-- The admin console also reads from activity_log seamlessly.
-- ============================================================================

alter table public.teams add column if not exists password_changed_at timestamptz;

grant all on all tables in schema public to postgres, service_role;
grant all on all sequences in schema public to postgres, service_role;
grant all on all routines in schema public to postgres, service_role;
