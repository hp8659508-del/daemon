-- ============================================================================
-- DAEMON HOUR · v10 — spin wheel segments as cards + round ledgers.
-- Run AFTER ui_v9_cards.sql. Safe to re-run.
--
--  • Spin wheel segments live next to auction cards (pool = 'spin'). Giving a
--    segment to a team applies it the same way: time, points, or a note.
--  • Every ability a team receives is written to team_ledger with the team's
--    points and deadline minutes BEFORE and AFTER, per round
--    (auction / spin / bingo / penalty).
--  • Replaces the wheel with the 8 segments.
-- ============================================================================

alter table public.auction_items add column if not exists pool text not null default 'auction';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'auction_items_pool_check') then
    alter table public.auction_items add constraint auction_items_pool_check check (pool in ('auction','spin'));
  end if;
end $$;

-- team_cards may now come from the wheel
alter table public.team_cards drop constraint if exists team_cards_source_check;
alter table public.team_cards add constraint team_cards_source_check check (source in ('auction','trump','manual','spin'));
alter table public.team_powerups add column if not exists card_id uuid references public.team_cards(id) on delete cascade;

-- ---------- ledger ----------
create table if not exists public.team_ledger (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  round text not null check (round in ('auction','spin','bingo','penalty')),
  label text not null,
  card_id uuid references public.team_cards(id) on delete cascade,
  points_before bigint not null,
  points_after bigint not null,
  minutes_before integer not null,
  minutes_after integer not null,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists team_ledger_team_idx on public.team_ledger(team_id, created_at);
alter table public.team_ledger enable row level security;

create or replace function public.dh_pts(p_team uuid) returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum(points),0)::bigint from public.transactions where team_id = p_team
$$;
create or replace function public.dh_mins(p_team uuid) returns integer language sql stable security definer set search_path = '' as $$
  select coalesce(sum(minutes_delta),0)::int from public.team_powerups
   where (target_team_id is null and team_id = p_team) or target_team_id = p_team
$$;
create or replace function public.dh_ledger(p_team uuid, p_round text, p_label text, p_pb bigint, p_mb integer, p_card uuid, p_admin uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.team_ledger(team_id, round, label, card_id, points_before, points_after, minutes_before, minutes_after, created_by)
  values (p_team, p_round, p_label, p_card, p_pb, public.dh_pts(p_team), p_mb, public.dh_mins(p_team), p_admin)
$$;

-- time effects carry card_id so a revoke/void removes exactly them
create or replace function public.dh_apply_card(p_card uuid, p_cell integer, p_admin uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.team_cards%rowtype; v_tx uuid; v_cells integer[] := '{}'; v_col integer; i integer; v_free boolean; v_amt integer; v_min integer;
begin
  select * into c from public.team_cards where id = p_card for update;
  if c.kind = 'time' then
    v_min := coalesce((c.effect->>'minutes')::int, 0);
    if v_min <> 0 then
      insert into public.team_powerups(team_id, name, minutes_delta, source, purchase_id, card_id, created_by)
      values (c.team_id, c.name, v_min, case when c.source = 'spin' then 'spin' else 'auction' end, c.purchase_id, c.id, p_admin);
    end if;
    update public.team_cards set status = 'applied', detail = format('%s%s min', case when v_min > 0 then '+' else '' end, v_min) where id = p_card;
  elsif c.kind = 'points' then
    v_amt := coalesce((c.effect->>'amount')::int, 0);
    if v_amt <> 0 then
      insert into public.transactions(team_id, description, points, transaction_type, created_by)
      values (c.team_id, 'Card: ' || c.name, v_amt, case when v_amt > 0 then 'bonus' else 'adjustment' end, p_admin) returning id into v_tx;
    end if;
    update public.team_cards set status = 'applied', detail = format('%s%s pts', case when v_amt > 0 then '+' else '' end, v_amt),
      applied = jsonb_build_object('tx', v_tx) where id = p_card;
  elsif c.kind = 'bingo' then
    if c.effect->>'mode' = 'column' then
      v_col := coalesce((c.effect->>'column')::int, 0);
      for i in select generate_series(v_col, 24, 5) loop
        select is_free into v_free from public.bingo_cells where idx = i;
        if coalesce(v_free, false) then continue; end if;
        if not exists (select 1 from public.team_bingo where team_id = c.team_id and idx = i) then
          perform public.admin_set_bingo(c.team_id, i, true, p_admin);
          v_cells := v_cells || i;
        end if;
      end loop;
      update public.team_cards set status = 'applied', detail = format('Column %s complete', substr('BINGO', v_col + 1, 1)),
        applied = jsonb_build_object('cells', to_jsonb(v_cells)) where id = p_card;
    else
      if p_cell is null then raise exception 'Pick the bingo box this card covers.'; end if;
      select is_free into v_free from public.bingo_cells where idx = p_cell;
      if not found then raise exception 'Bingo box not found'; end if;
      if v_free then raise exception 'The centre box is already free — pick another.'; end if;
      if exists (select 1 from public.team_bingo where team_id = c.team_id and idx = p_cell) then
        raise exception 'That box is already stamped for this team — pick another.';
      end if;
      perform public.admin_set_bingo(c.team_id, p_cell, true, p_admin);
      update public.team_cards set status = 'applied',
        detail = 'Box ' || substr('BINGO', (p_cell % 5) + 1, 1) || ((p_cell / 5) + 1)::text,
        applied = jsonb_build_object('cells', jsonb_build_array(p_cell)) where id = p_card;
    end if;
  elsif c.kind = 'trump' then
    update public.team_cards set status = 'pending', detail = 'Choose which card it copies' where id = p_card;
  else
    update public.team_cards set status = 'held' where id = p_card;
  end if;
end $$;

create or replace function public.dh_revert_card(p_card uuid, p_admin uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.team_cards%rowtype; i integer;
begin
  select * into c from public.team_cards where id = p_card for update;
  if not found then return; end if;
  if c.status = 'spent' then raise exception '"%" has already been used by the team — it can''t be undone.', c.name; end if;
  if c.kind = 'points' and c.applied ? 'tx' and c.applied->>'tx' is not null then
    delete from public.transactions where id = (c.applied->>'tx')::uuid;
  elsif c.kind = 'bingo' and c.applied ? 'cells' then
    for i in select jsonb_array_elements_text(c.applied->'cells')::int loop
      perform public.admin_set_bingo(c.team_id, i, false, p_admin);
    end loop;
  end if;
  delete from public.team_powerups where card_id = p_card;
  delete from public.team_ledger where card_id = p_card;
  delete from public.team_cards where id = p_card;
end $$;

-- ---------- selling (auction) now writes the ledger ----------
create or replace function public.admin_sell_lot(p_item_id uuid, p_team_id uuid, p_price integer, p_admin uuid, p_cell integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_item public.auction_items%rowtype; v_balance bigint; v_sold integer; v_tx uuid; v_purchase uuid; v_card uuid; v_mb integer;
begin
  perform 1 from public.teams where id = p_team_id for update;
  if not found then raise exception 'Team not found'; end if;
  select * into v_item from public.auction_items where id = p_item_id for update;
  if not found then raise exception 'Lot not found'; end if;
  if v_item.pool = 'spin' then raise exception 'That is a spin wheel segment, not an auction card.'; end if;
  if p_price is null or p_price < 0 then raise exception 'Invalid price'; end if;
  if v_item.min_price is not null and p_price < v_item.min_price then raise exception 'Price is below the minimum (%)', v_item.min_price; end if;
  if v_item.max_price is not null and p_price > v_item.max_price then raise exception 'Price is above the maximum (%)', v_item.max_price; end if;
  select count(*) into v_sold from public.purchases where item_id = p_item_id;
  if v_sold >= greatest(v_item.quantity, 1) then raise exception 'This slot is already sold. Use Copy to open another slot.'; end if;
  if v_item.kind = 'bingo' and coalesce(v_item.effect->>'mode','cell') <> 'column' and p_cell is null then
    raise exception 'Pick the bingo box this card covers.';
  end if;
  v_balance := public.dh_pts(p_team_id); v_mb := public.dh_mins(p_team_id);
  if v_balance < p_price then raise exception 'Team has only % points', v_balance; end if;

  if p_price > 0 then
    insert into public.transactions(team_id, description, points, transaction_type, created_by)
    values (p_team_id, 'Auction: ' || v_item.item_name, -p_price, 'purchase', p_admin) returning id into v_tx;
  end if;
  insert into public.purchases(team_id, item_id, transaction_id, purchase_price)
  values (p_team_id, p_item_id, v_tx, p_price) returning id into v_purchase;
  insert into public.team_cards(team_id, purchase_id, item_id, name, kind, effect, source, created_by)
  values (p_team_id, v_purchase, p_item_id, v_item.item_name, v_item.kind, v_item.effect, 'auction', p_admin) returning id into v_card;
  perform public.dh_apply_card(v_card, p_cell, p_admin);
  perform public.dh_ledger(p_team_id, 'auction', v_item.item_name || ' (bought for ' || p_price || ')', v_balance, v_mb, v_card, p_admin);
  return jsonb_build_object('purchase_id', v_purchase, 'card_id', v_card, 'kind', v_item.kind, 'remaining', public.dh_pts(p_team_id));
end $$;

create or replace function public.admin_resolve_trump(p_card uuid, p_item_id uuid, p_cell integer, p_admin uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.team_cards%rowtype; v_item public.auction_items%rowtype; v_new uuid; v_pb bigint; v_mb integer;
begin
  select * into c from public.team_cards where id = p_card for update;
  if not found or c.kind <> 'trump' then raise exception 'Trump card not found'; end if;
  if c.status <> 'pending' then raise exception 'This trump card has already been turned into a card.'; end if;
  select * into v_item from public.auction_items where id = p_item_id and pool = 'auction';
  if not found then raise exception 'Card not found'; end if;
  if v_item.kind = 'trump' then raise exception 'A trump card can''t copy another trump card.'; end if;
  v_pb := public.dh_pts(c.team_id); v_mb := public.dh_mins(c.team_id);
  insert into public.team_cards(team_id, purchase_id, item_id, name, kind, effect, source, created_by)
  values (c.team_id, c.purchase_id, v_item.id, v_item.item_name, v_item.kind, v_item.effect, 'trump', p_admin) returning id into v_new;
  perform public.dh_apply_card(v_new, p_cell, p_admin);
  update public.team_cards set status = 'resolved', detail = 'Copied: ' || v_item.item_name where id = p_card;
  perform public.dh_ledger(c.team_id, 'auction', 'Trump card → ' || v_item.item_name, v_pb, v_mb, v_new, p_admin);
  return jsonb_build_object('card_id', v_new, 'name', v_item.item_name);
end $$;

-- ---------- spin wheel ----------
create or replace function public.admin_spin_grant(p_item_id uuid, p_team_id uuid, p_admin uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_item public.auction_items%rowtype; v_card uuid; v_pb bigint; v_mb integer;
begin
  perform 1 from public.teams where id = p_team_id for update;
  if not found then raise exception 'Team not found'; end if;
  select * into v_item from public.auction_items where id = p_item_id and pool = 'spin';
  if not found then raise exception 'Wheel segment not found'; end if;
  v_pb := public.dh_pts(p_team_id); v_mb := public.dh_mins(p_team_id);
  insert into public.team_cards(team_id, item_id, name, kind, effect, source, created_by)
  values (p_team_id, v_item.id, v_item.item_name, v_item.kind, v_item.effect, 'spin', p_admin) returning id into v_card;
  perform public.dh_apply_card(v_card, null, p_admin);
  perform public.dh_ledger(p_team_id, 'spin', v_item.item_name, v_pb, v_mb, v_card, p_admin);
  insert into public.activity_log(team_id, kind, action, label, actor) values (p_team_id, 'spin', 'granted', 'Wheel: ' || v_item.item_name, p_admin);
  return jsonb_build_object('card_id', v_card, 'name', v_item.item_name);
end $$;

create or replace function public.admin_spin_revoke(p_card uuid, p_admin uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.team_cards%rowtype;
begin
  select * into c from public.team_cards where id = p_card and source = 'spin';
  if not found then raise exception 'Spin result not found'; end if;
  perform public.dh_revert_card(p_card, p_admin);
  insert into public.activity_log(team_id, kind, action, label, actor) values (c.team_id, 'spin', 'removed', 'Wheel result removed: ' || c.name, p_admin);
end $$;

-- ---------- bingo stamps with a ledger row ----------
create or replace function public.admin_bingo_mark(p_team_id uuid, p_idx integer, p_on boolean, p_admin uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_pb bigint; v_mb integer; r jsonb; v_label text;
begin
  perform 1 from public.teams where id = p_team_id for update;
  v_pb := public.dh_pts(p_team_id); v_mb := public.dh_mins(p_team_id);
  r := public.admin_set_bingo(p_team_id, p_idx, p_on, p_admin);
  if coalesce((r->>'noop')::boolean, false) then return r; end if;
  select label into v_label from public.bingo_cells where idx = p_idx;
  perform public.dh_ledger(p_team_id, 'bingo',
    (case when p_on then 'Dare done: ' else 'Stamp removed: ' end) || coalesce(v_label, 'box') ||
    (case when p_on and coalesce((r->>'full')::boolean, false) then ' · FULL CARD' else '' end),
    v_pb, v_mb, null, p_admin);
  return r;
end $$;

-- ---------- penalties write the ledger ----------
create or replace function public.dh_land_penalty(p_team uuid, p_minutes integer, p_points integer, p_reason text, p_admin uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_pb bigint := public.dh_pts(p_team); v_mb integer := public.dh_mins(p_team);
begin
  if p_minutes <> 0 then
    insert into public.team_powerups(team_id, name, minutes_delta, source, note, created_by)
    values (p_team, 'Penalty: ' || p_reason, -abs(p_minutes), 'manual', p_reason, p_admin);
  end if;
  if p_points <> 0 then
    insert into public.transactions(team_id, description, points, transaction_type, created_by)
    values (p_team, 'Penalty: ' || p_reason, -abs(p_points), 'adjustment', p_admin);
  end if;
  perform public.dh_ledger(p_team, 'penalty', 'Penalty: ' || p_reason, v_pb, v_mb, null, p_admin);
end $$;

-- ---------- the 8 wheel segments (replaces the wheel) ----------
delete from public.auction_items where pool = 'spin'
  and not exists (select 1 from public.team_cards c where c.item_id = auction_items.id);
insert into public.auction_items (item_name, description, kind, effect, base_points, price_step, quantity, is_active, pool)
select v.name, v.descr, v.kind, v.effect::jsonb, 0, 10, 1, true, 'spin'
from (values
  ('Plus 5 mins',                    'Adds 5 minutes to your deadline',             'time',   '{"minutes":5}'),
  ('Minus 5 points',                 'Takes 5 points',                              'points', '{"amount":-5}'),
  ('Plus 5 points',                  'Adds 5 points',                               'points', '{"amount":5}'),
  ('Spin again',                     'Spin the wheel one more time',                'note',   '{"phase":"spin","perk":"none"}'),
  ('Experts review for 5 minutes',   'An expert reviews your build for 5 minutes',  'note',   '{"phase":"build","perk":"none"}'),
  ('Delete/edit few lines of code',  'An organiser deletes or edits a few lines of your code', 'note', '{"phase":"build","perk":"none"}'),
  ('Don''t use AI for 10 mins',      'No AI tools for 10 minutes',                  'note',   '{"phase":"build","perk":"none"}'),
  ('Minus 3 points',                 'Takes 3 points',                              'points', '{"amount":-3}')
) as v(name, descr, kind, effect)
where not exists (select 1 from public.auction_items i where i.pool = 'spin' and i.item_name = v.name);

-- ---------- permissions + realtime ----------
do $$
declare f text;
begin
  foreach f in array array['dh_pts(uuid)','dh_mins(uuid)','dh_ledger(uuid, text, text, bigint, integer, uuid, uuid)',
    'dh_apply_card(uuid, integer, uuid)','dh_revert_card(uuid, uuid)','admin_sell_lot(uuid, uuid, integer, uuid, integer)',
    'admin_resolve_trump(uuid, uuid, integer, uuid)','admin_spin_grant(uuid, uuid, uuid)','admin_spin_revoke(uuid, uuid)',
    'admin_bingo_mark(uuid, integer, boolean, uuid)','dh_land_penalty(uuid, integer, integer, text, uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to postgres, service_role', f);
  end loop;
end $$;
grant all on public.team_ledger to postgres, service_role;
do $$ begin
  begin execute 'alter publication supabase_realtime add table public.team_ledger';
  exception when duplicate_object then null; when undefined_object then null; end;
end $$;
