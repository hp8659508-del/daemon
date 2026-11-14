-- ============================================================================
-- DAEMON HOUR · "ui" branch migration
-- Run ONCE in the Supabase SQL editor, after the existing migrations.
-- Additive only: no existing rows are deleted. Safe to re-run (idempotent).
--
-- What it adds
--   • event_settings  : hackathon clock, live auction lot, broadcast ticker,
--                       bingo line bonus, leaderboard visibility
--   • teams.bay       : venue group ("Bay A", "Lab 2") for batch control
--   • team_stages     : per-team state of each activity (upcoming/live/closed)
--   • auction_items   : min/max/step price range, quantity, linked power-up
--   • powerups        : catalogue (time delta in minutes, self or rival)
--   • team_powerups   : what each team holds (source, used, target team)
--   • bingo_cells     : the 5×5 board (editable)   • team_bingo : marks
--   • RPCs (service-role only): admin_sell_lot, admin_undo_sale,
--                               admin_toggle_bingo
--   • Team-side purchasing is REVOKED: the admin buys on the team's behalf.
-- ============================================================================

-- ---------- event settings ----------
alter table public.event_settings
  add column if not exists hackathon_end_at   timestamptz,
  add column if not exists live_lot           jsonb,
  add column if not exists broadcast          text,
  add column if not exists bingo_line_bonus   integer not null default 50,
  add column if not exists leaderboard_visible boolean not null default false;

-- ---------- teams ----------
alter table public.teams add column if not exists bay text;

-- ---------- stages ----------
create table if not exists public.team_stages (
  team_id   uuid not null references public.teams(id) on delete cascade,
  activity  text not null check (activity in ('auction','spin','bingo')),
  status    text not null default 'upcoming' check (status in ('upcoming','live','closed')),
  opened_at timestamptz,
  closed_at timestamptz,
  closing_points integer,
  closing_end_at timestamptz,
  primary key (team_id, activity)
);

-- ---------- auction items ----------
alter table public.auction_items
  add column if not exists min_price  integer,
  add column if not exists max_price  integer,
  add column if not exists price_step integer not null default 10,
  add column if not exists quantity   integer not null default 1,
  add column if not exists description text,
  add column if not exists powerup_id uuid;

-- ---------- power-ups ----------
create table if not exists public.powerups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  description text,
  minutes_delta integer not null default 0,         -- +15 = extra time, -10 = penalty
  targets_rival boolean not null default false,     -- time delta lands on another team
  color text not null default 'cyan',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'auction_items_powerup_fk') then
    alter table public.auction_items
      add constraint auction_items_powerup_fk foreign key (powerup_id) references public.powerups(id) on delete set null;
  end if;
end $$;

create table if not exists public.team_powerups (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  powerup_id uuid references public.powerups(id) on delete set null,
  name text not null,                               -- snapshot, survives catalogue edits
  minutes_delta integer not null default 0,
  target_team_id uuid references public.teams(id) on delete set null,
  source text not null check (source in ('auction','spin','bingo','manual')),
  note text,
  used boolean not null default false,
  purchase_id uuid,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists team_powerups_team_idx on public.team_powerups(team_id);
create index if not exists team_powerups_target_idx on public.team_powerups(target_team_id);

-- ---------- bingo ----------
create table if not exists public.bingo_cells (
  idx integer primary key check (idx between 0 and 24),
  label text not null,
  points integer not null default 10,
  is_free boolean not null default false
);

create table if not exists public.team_bingo (
  team_id uuid not null references public.teams(id) on delete cascade,
  idx integer not null references public.bingo_cells(idx) on delete cascade,
  marked_by uuid,
  marked_at timestamptz not null default now(),
  primary key (team_id, idx)
);

insert into public.bingo_cells (idx, label, points, is_free) values
 (0,'Get club member to draw smiley on hand',10,false),
 (1,'Like all the posts of MD insta page',10,false),
 (2,'Tell the President of the club "Hi"',10,false),
 (3,'Do a bottle flip',10,false),
 (4,'Win rock paper scissors with club member',10,false),
 (5,'Do a pushup',10,false),
 (6,'List 5 AI chatbots',10,false),
 (7,'Code to sort a list',10,false),
 (8,'Take a mirror selfie',10,false),
 (9,'Take a picture with a campus landmark',10,false),
 (10,'Find someone who plays chess',10,false),
 (11,'Find a laptop with a sticker',10,false),
 (12,'FREE · MD Club',0,true),
 (13,'Code to print n prime numbers',10,false),
 (14,'Draw MD Club logo',10,false),
 (15,'Draw something on your face',10,false),
 (16,'Code to print n even numbers',10,false),
 (17,'Exchange GitHub id with someone',10,false),
 (18,'Take a pic of Tango menu',10,false),
 (19,'Give a high-five with a club member',10,false),
 (20,'Find a pink flower in campus',10,false),
 (21,'Take a pic with Core Member',10,false),
 (22,'Get signature from a club member',10,false),
 (23,'Record yourself singing a song',10,false),
 (24,'Write a loop pattern code',10,false)
on conflict (idx) do nothing;

-- ---------- RLS: teams read their own rows, staff read everything ----------
alter table public.team_stages   enable row level security;
alter table public.powerups      enable row level security;
alter table public.team_powerups enable row level security;
alter table public.bingo_cells   enable row level security;
alter table public.team_bingo    enable row level security;

drop policy if exists "stages own or staff" on public.team_stages;
create policy "stages own or staff" on public.team_stages for select to authenticated
  using (team_id = public.current_team_id() or public.is_staff());

drop policy if exists "powerups readable" on public.powerups;
create policy "powerups readable" on public.powerups for select to authenticated using (true);

drop policy if exists "team powerups own target or staff" on public.team_powerups;
create policy "team powerups own target or staff" on public.team_powerups for select to authenticated
  using (team_id = public.current_team_id() or target_team_id = public.current_team_id() or public.is_staff());

drop policy if exists "bingo cells readable" on public.bingo_cells;
create policy "bingo cells readable" on public.bingo_cells for select to authenticated using (true);

drop policy if exists "team bingo own or staff" on public.team_bingo;
create policy "team bingo own or staff" on public.team_bingo for select to authenticated
  using (team_id = public.current_team_id() or public.is_staff());

grant select on public.team_stages, public.powerups, public.team_powerups, public.bingo_cells, public.team_bingo to authenticated;
revoke insert, update, delete, truncate on public.team_stages, public.powerups, public.team_powerups, public.bingo_cells, public.team_bingo from authenticated, anon;

-- Participants can no longer buy on their own: the auctioneer does it.
do $$ begin
  if exists (select 1 from pg_proc where proname = 'purchase_auction_item') then
    revoke execute on function public.purchase_auction_item(uuid) from authenticated;
  end if;
  if exists (select 1 from pg_proc where proname = 'spin_for_team') then
    revoke execute on function public.spin_for_team(uuid) from authenticated;
  end if;
end $$;

-- ---------- RPC: sell the current lot to a team (atomic) ----------
create or replace function public.admin_sell_lot(p_item_id uuid, p_team_id uuid, p_price integer, p_admin uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_item public.auction_items%rowtype;
  v_balance bigint; v_sold integer; v_tx uuid; v_purchase uuid; v_pu public.powerups%rowtype;
begin
  perform 1 from public.teams where id = p_team_id for update;
  if not found then raise exception 'Team not found'; end if;

  select * into v_item from public.auction_items where id = p_item_id for update;
  if not found then raise exception 'Item not found'; end if;
  if p_price is null or p_price < 0 then raise exception 'Invalid price'; end if;
  if v_item.min_price is not null and p_price < v_item.min_price then raise exception 'Price is below the minimum (%)', v_item.min_price; end if;
  if v_item.max_price is not null and p_price > v_item.max_price then raise exception 'Price is above the maximum (%)', v_item.max_price; end if;

  select count(*) into v_sold from public.purchases where item_id = p_item_id;
  if v_sold >= greatest(v_item.quantity, 1) then raise exception 'This item is sold out'; end if;

  select coalesce(sum(points),0) into v_balance from public.transactions where team_id = p_team_id;
  if v_balance < p_price then raise exception 'Team has only % points', v_balance; end if;

  insert into public.transactions(team_id, description, points, transaction_type, created_by)
  values (p_team_id, 'Auction: ' || v_item.item_name, -p_price, 'purchase', p_admin)
  returning id into v_tx;

  insert into public.purchases(team_id, item_id, transaction_id, purchase_price)
  values (p_team_id, p_item_id, v_tx, p_price) returning id into v_purchase;

  if v_item.powerup_id is not null then
    select * into v_pu from public.powerups where id = v_item.powerup_id;
    if found then
      insert into public.team_powerups(team_id, powerup_id, name, minutes_delta, source, purchase_id, created_by)
      values (p_team_id, v_pu.id, v_pu.name, v_pu.minutes_delta, 'auction', v_purchase, p_admin);
    end if;
  end if;

  return jsonb_build_object('purchase_id', v_purchase, 'remaining', v_balance - p_price);
end $$;

-- ---------- RPC: undo a sale (refund + remove linked power-up) ----------
create or replace function public.admin_undo_sale(p_purchase_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_tx uuid;
begin
  select transaction_id into v_tx from public.purchases where id = p_purchase_id;
  if not found then raise exception 'Sale not found'; end if;
  delete from public.team_powerups where purchase_id = p_purchase_id;
  delete from public.purchases where id = p_purchase_id;
  if v_tx is not null then delete from public.transactions where id = v_tx; end if;
end $$;

-- ---------- RPC: toggle a bingo square (points + line bonuses kept in sync) ----------
create or replace function public.admin_toggle_bingo(p_team_id uuid, p_idx integer, p_admin uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_cell public.bingo_cells%rowtype; v_marked boolean; v_lines integer := 0; v_paid integer; v_bonus integer;
  v_set integer[]; v_line integer[]; v_all integer[][] := array[
    array[0,1,2,3,4], array[5,6,7,8,9], array[10,11,12,13,14], array[15,16,17,18,19], array[20,21,22,23,24],
    array[0,5,10,15,20], array[1,6,11,16,21], array[2,7,12,17,22], array[3,8,13,18,23], array[4,9,14,19,24],
    array[0,6,12,18,24], array[4,8,12,16,20]];
  i integer;
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
    v_marked := false;
  else
    insert into public.team_bingo(team_id, idx, marked_by) values (p_team_id, p_idx, p_admin);
    if v_cell.points <> 0 then
      insert into public.transactions(team_id, description, points, transaction_type, created_by)
      values (p_team_id, 'Bingo: ' || v_cell.label, v_cell.points, 'bonus', p_admin);
    end if;
    v_marked := true;
  end if;

  select array_agg(idx) into v_set from (
    select idx from public.team_bingo where team_id = p_team_id
    union select idx from public.bingo_cells where is_free) s;
  for i in 1..12 loop
    v_line := v_all[i:i][1:5];
    if (select bool_and(x = any(coalesce(v_set, '{}'))) from unnest(v_line) x) then v_lines := v_lines + 1; end if;
  end loop;

  select bingo_line_bonus into v_bonus from public.event_settings where id = true;
  select coalesce(sum(case when description = 'Bingo line bonus' then 1 when description = 'Bingo line bonus undo' then -1 else 0 end),0)
    into v_paid from public.transactions where team_id = p_team_id;

  while v_paid < v_lines loop
    insert into public.transactions(team_id, description, points, transaction_type, created_by)
    values (p_team_id, 'Bingo line bonus', coalesce(v_bonus,0), 'bonus', p_admin);
    v_paid := v_paid + 1;
  end loop;
  while v_paid > v_lines loop
    insert into public.transactions(team_id, description, points, transaction_type, created_by)
    values (p_team_id, 'Bingo line bonus undo', -coalesce(v_bonus,0), 'adjustment', p_admin);
    v_paid := v_paid - 1;
  end loop;

  return jsonb_build_object('marked', v_marked, 'lines', v_lines);
end $$;

revoke all on function public.admin_sell_lot(uuid, uuid, integer, uuid) from public, anon, authenticated;
revoke all on function public.admin_undo_sale(uuid) from public, anon, authenticated;
revoke all on function public.admin_toggle_bingo(uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.admin_sell_lot(uuid, uuid, integer, uuid) to service_role;
grant execute on function public.admin_undo_sale(uuid) to service_role;
grant execute on function public.admin_toggle_bingo(uuid, integer, uuid) to service_role;

-- ---------- realtime: team screens update the instant the admin acts ----------
do $$
declare t text;
begin
  foreach t in array array['transactions','purchases','team_stages','team_powerups','team_bingo','event_settings'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; when undefined_object then null;
    end;
  end loop;
end $$;
