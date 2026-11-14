-- ============================================================================
-- DAEMON HOUR · ui v2 migration  (run AFTER ui_rebuild_migration.sql)
-- Additive and re-runnable.
--   • Hackathon clock: start / pause / resume / set duration
--   • Activity log: every grant, removal, sale, stamp and round change per team
--   • Bingo: the finalised sheet is forced in; bonuses per completed COLUMN
--     (B-I-N-G-O) + full card; editable reward text per letter
-- ============================================================================

alter table public.event_settings
  add column if not exists hackathon_started_at timestamptz,
  add column if not exists clock_paused_at      timestamptz,
  add column if not exists bingo_full_bonus     integer not null default 100,
  add column if not exists bingo_rewards        jsonb   not null default '{}'::jsonb;

-- ---------- activity log ----------
create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references public.teams(id) on delete cascade,
  kind text not null,          -- points | powerup | auction | bingo | round | clock
  action text not null,        -- granted | removed | used | restored | sold | refunded | stamped | unstamped | opened | closed | reset
  label text not null,
  points integer,
  minutes integer,
  actor uuid,
  created_at timestamptz not null default now()
);
create index if not exists activity_log_team_idx on public.activity_log(team_id, created_at desc);
alter table public.activity_log enable row level security;
drop policy if exists "activity own or staff" on public.activity_log;
create policy "activity own or staff" on public.activity_log for select to authenticated
  using (team_id = public.current_team_id() or public.is_staff());
grant select on public.activity_log to authenticated;
grant all on public.activity_log to postgres, service_role;
revoke insert, update, delete, truncate on public.activity_log from authenticated, anon;

-- ---------- finalised bingo sheet (overwrites whatever is there) ----------
insert into public.bingo_cells (idx, label, points, is_free) values
 (0,'Get club member to draw smiley on hand',10,false),
 (1,'Like all the posts of MD insta page',10,false),
 (2,'Tell the President of the club "Hi"',10,false),
 (3,'Do a Bottle Flip',10,false),
 (4,'Win rock paper scissors with club member',10,false),
 (5,'Do a Pushup',10,false),
 (6,'List 5 AI Chatbots',10,false),
 (7,'Code to sort a list',10,false),
 (8,'Take a mirror selfie',10,false),
 (9,'Take a picture with a campus landmark',10,false),
 (10,'Find someone who plays chess',10,false),
 (11,'Find a laptop with a sticker',10,false),
 (12,'MD Club',0,true),
 (13,'Code to Print n prime numbers',10,false),
 (14,'Draw MD Club Logo',10,false),
 (15,'Draw something on your face',10,false),
 (16,'Code to print n even numbers',10,false),
 (17,'Exchange GitHub id with someone',10,false),
 (18,'Take a pic of Tango Menu',10,false),
 (19,'Give a High-Five with a club member',10,false),
 (20,'Find a pink flower in campus',10,false),
 (21,'Take a pic with Core Member',10,false),
 (22,'Get signature from a club member',10,false),
 (23,'Record yourself singing a song',10,false),
 (24,'Write a loop pattern code',10,false)
on conflict (idx) do update set label = excluded.label, is_free = excluded.is_free,
  points = case when public.bingo_cells.points is null then excluded.points else public.bingo_cells.points end;
-- Clear marks on the centre square if it was ever stamped as a normal cell
delete from public.team_bingo where idx = 12;

-- ---------- bingo: column bonuses + full card ----------
create or replace function public.admin_toggle_bingo(p_team_id uuid, p_idx integer, p_admin uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_cell public.bingo_cells%rowtype; v_marked boolean; v_set integer[];
  v_cols integer := 0; v_full integer := 0; v_paid_cols integer; v_paid_full integer;
  v_col_bonus integer; v_full_bonus integer; c integer;
begin
  perform 1 from public.teams where id = p_team_id for update;
  select * into v_cell from public.bingo_cells where idx = p_idx;
  if not found then raise exception 'Square not found'; end if;
  if v_cell.is_free then raise exception 'The centre square is always free'; end if;

  if exists (select 1 from public.team_bingo where team_id = p_team_id and idx = p_idx) then
    delete from public.team_bingo where team_id = p_team_id and idx = p_idx;
    if v_cell.points <> 0 then
      insert into public.transactions(team_id, description, points, transaction_type, created_by)
      values (p_team_id, 'Bingo undo: ' || v_cell.label, -v_cell.points, 'adjustment', p_admin);
    end if;
    insert into public.activity_log(team_id, kind, action, label, points, actor) values (p_team_id,'bingo','unstamped',v_cell.label,-v_cell.points,p_admin);
    v_marked := false;
  else
    insert into public.team_bingo(team_id, idx, marked_by) values (p_team_id, p_idx, p_admin);
    if v_cell.points <> 0 then
      insert into public.transactions(team_id, description, points, transaction_type, created_by)
      values (p_team_id, 'Bingo: ' || v_cell.label, v_cell.points, 'bonus', p_admin);
    end if;
    insert into public.activity_log(team_id, kind, action, label, points, actor) values (p_team_id,'bingo','stamped',v_cell.label,v_cell.points,p_admin);
    v_marked := true;
  end if;

  select array_agg(idx) into v_set from (
    select idx from public.team_bingo where team_id = p_team_id
    union select idx from public.bingo_cells where is_free) s;
  v_set := coalesce(v_set, '{}');
  for c in 0..4 loop
    if array[c, c+5, c+10, c+15, c+20] <@ v_set then v_cols := v_cols + 1; end if;
  end loop;
  if v_cols = 5 then v_full := 1; end if;

  select bingo_line_bonus, bingo_full_bonus into v_col_bonus, v_full_bonus from public.event_settings where id = true;
  select coalesce(sum(case when description = 'Bingo column bonus' then 1 when description = 'Bingo column bonus undo' then -1 else 0 end),0),
         coalesce(sum(case when description = 'Bingo full card bonus' then 1 when description = 'Bingo full card bonus undo' then -1 else 0 end),0)
    into v_paid_cols, v_paid_full from public.transactions where team_id = p_team_id;

  while v_paid_cols < v_cols loop
    insert into public.transactions(team_id, description, points, transaction_type, created_by) values (p_team_id,'Bingo column bonus',coalesce(v_col_bonus,0),'bonus',p_admin);
    insert into public.activity_log(team_id, kind, action, label, points, actor) values (p_team_id,'bingo','granted','Column completed',coalesce(v_col_bonus,0),p_admin);
    v_paid_cols := v_paid_cols + 1;
  end loop;
  while v_paid_cols > v_cols loop
    insert into public.transactions(team_id, description, points, transaction_type, created_by) values (p_team_id,'Bingo column bonus undo',-coalesce(v_col_bonus,0),'adjustment',p_admin);
    insert into public.activity_log(team_id, kind, action, label, points, actor) values (p_team_id,'bingo','removed','Column bonus reversed',-coalesce(v_col_bonus,0),p_admin);
    v_paid_cols := v_paid_cols - 1;
  end loop;
  if v_paid_full < v_full then
    insert into public.transactions(team_id, description, points, transaction_type, created_by) values (p_team_id,'Bingo full card bonus',coalesce(v_full_bonus,0),'bonus',p_admin);
    insert into public.activity_log(team_id, kind, action, label, points, actor) values (p_team_id,'bingo','granted','Full card BINGO',coalesce(v_full_bonus,0),p_admin);
  elsif v_paid_full > v_full then
    insert into public.transactions(team_id, description, points, transaction_type, created_by) values (p_team_id,'Bingo full card bonus undo',-coalesce(v_full_bonus,0),'adjustment',p_admin);
    insert into public.activity_log(team_id, kind, action, label, points, actor) values (p_team_id,'bingo','removed','Full card bonus reversed',-coalesce(v_full_bonus,0),p_admin);
  end if;

  return jsonb_build_object('marked', v_marked, 'columns', v_cols, 'full', v_full = 1);
end $$;
revoke all on function public.admin_toggle_bingo(uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.admin_toggle_bingo(uuid, integer, uuid) to postgres, service_role;

do $$ begin
  begin execute 'alter publication supabase_realtime add table public.activity_log';
  exception when duplicate_object then null; when undefined_object then null; end;
end $$;
