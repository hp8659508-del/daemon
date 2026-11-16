-- ============================================================================
-- DAEMON HOUR · v9 cards — run AFTER ui_v8. Safe to re-run.
--
-- Auction lots become typed "cards":
--   time   : minutes on the buyer's deadline (applied automatically)
--   points : +N auction points (applied automatically)
--   bingo  : stamps the buyer's bingo sheet (one box the admin picks, or a whole column)
--   note   : a perk recorded on the team for evaluation (phase-tagged);
--            some perks are tracked once: no_penalty, pass_penalty, swap_ps
--   trump  : becomes a copy of any other card (sold or unsold) that the team picks
--
-- Every lot sells once. More copies come from "Copy" (a new slot).
-- Also: problem statements per team (+ the swap perk), penalties with shields,
-- voiding a sale (refund + undo its effects), deleting a lot.
-- ============================================================================

-- 1. Card type on lots ---------------------------------------------------------
alter table public.auction_items add column if not exists kind text not null default 'note';
alter table public.auction_items add column if not exists effect jsonb not null default '{}'::jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'auction_items_kind_check') then
    alter table public.auction_items add constraint auction_items_kind_check check (kind in ('time','points','bingo','note','trump'));
  end if;
end $$;
-- older lots linked to a time power-up become time cards
update public.auction_items i set kind = 'time', effect = jsonb_build_object('minutes', p.minutes_delta)
  from public.powerups p
 where i.powerup_id = p.id and i.kind = 'note' and i.effect = '{}'::jsonb and p.minutes_delta <> 0;

-- 2. Problem statements -------------------------------------------------------
alter table public.teams add column if not exists problem_statement text;
alter table public.teams add column if not exists ps_locked boolean not null default false;

-- 3. What each team holds -----------------------------------------------------
create table if not exists public.team_cards (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  purchase_id uuid references public.purchases(id) on delete cascade,
  item_id uuid references public.auction_items(id) on delete set null,
  name text not null,
  kind text not null,
  effect jsonb not null default '{}'::jsonb,
  source text not null default 'auction' check (source in ('auction','trump','manual')),
  status text not null default 'applied' check (status in ('applied','held','spent','pending','resolved')),
  detail text,
  applied jsonb not null default '{}'::jsonb,     -- what was done (tx id, stamped boxes) so a void can undo it
  spent_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists team_cards_team_idx on public.team_cards(team_id);
create index if not exists team_cards_purchase_idx on public.team_cards(purchase_id);
alter table public.team_cards enable row level security;

create table if not exists public.penalties (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,        -- who it was issued to
  landed_team_id uuid references public.teams(id) on delete set null,         -- who actually took it (null = nobody)
  minutes integer not null default 0,
  points integer not null default 0,
  reason text not null,
  outcome text not null check (outcome in ('applied','blocked','passed','passed_blocked')),
  detail text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists penalties_team_idx on public.penalties(team_id);
alter table public.penalties enable row level security;

-- 4. Apply / revert one card --------------------------------------------------
create or replace function public.dh_apply_card(p_card uuid, p_cell integer, p_admin uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.team_cards%rowtype; v_tx uuid; v_cells integer[] := '{}'; v_col integer; i integer; v_free boolean; v_amt integer; v_min integer;
begin
  select * into c from public.team_cards where id = p_card for update;
  if c.kind = 'time' then
    v_min := coalesce((c.effect->>'minutes')::int, 0);
    if v_min <> 0 then
      insert into public.team_powerups(team_id, name, minutes_delta, source, purchase_id, created_by)
      values (c.team_id, c.name, v_min, 'auction', c.purchase_id, p_admin);
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
  -- time effects are team_powerups rows tied to the purchase; removed by the caller
  delete from public.team_cards where id = p_card;
end $$;

-- 5. Selling ------------------------------------------------------------------
drop function if exists public.admin_sell_lot(uuid, uuid, integer, uuid);
create or replace function public.admin_sell_lot(p_item_id uuid, p_team_id uuid, p_price integer, p_admin uuid, p_cell integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_item public.auction_items%rowtype; v_balance bigint; v_sold integer; v_tx uuid; v_purchase uuid; v_card uuid;
begin
  perform 1 from public.teams where id = p_team_id for update;
  if not found then raise exception 'Team not found'; end if;
  select * into v_item from public.auction_items where id = p_item_id for update;
  if not found then raise exception 'Lot not found'; end if;
  if p_price is null or p_price < 0 then raise exception 'Invalid price'; end if;
  if v_item.min_price is not null and p_price < v_item.min_price then raise exception 'Price is below the minimum (%)', v_item.min_price; end if;
  if v_item.max_price is not null and p_price > v_item.max_price then raise exception 'Price is above the maximum (%)', v_item.max_price; end if;

  select count(*) into v_sold from public.purchases where item_id = p_item_id;
  if v_sold >= greatest(v_item.quantity, 1) then raise exception 'This slot is already sold. Use Copy to open another slot.'; end if;
  if v_item.kind = 'bingo' and coalesce(v_item.effect->>'mode','cell') <> 'column' and p_cell is null then
    raise exception 'Pick the bingo box this card covers.';
  end if;

  select coalesce(sum(points),0) into v_balance from public.transactions where team_id = p_team_id;
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

  return jsonb_build_object('purchase_id', v_purchase, 'card_id', v_card, 'kind', v_item.kind,
    'remaining', (select coalesce(sum(points),0) from public.transactions where team_id = p_team_id));
end $$;

-- Trump: turn a pending trump card into a copy of any other card (sold or unsold)
create or replace function public.admin_resolve_trump(p_card uuid, p_item_id uuid, p_cell integer, p_admin uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.team_cards%rowtype; v_item public.auction_items%rowtype; v_new uuid;
begin
  select * into c from public.team_cards where id = p_card for update;
  if not found or c.kind <> 'trump' then raise exception 'Trump card not found'; end if;
  if c.status <> 'pending' then raise exception 'This trump card has already been turned into a card.'; end if;
  select * into v_item from public.auction_items where id = p_item_id;
  if not found then raise exception 'Card not found'; end if;
  if v_item.kind = 'trump' then raise exception 'A trump card can''t copy another trump card.'; end if;
  insert into public.team_cards(team_id, purchase_id, item_id, name, kind, effect, source, created_by)
  values (c.team_id, c.purchase_id, v_item.id, v_item.item_name, v_item.kind, v_item.effect, 'trump', p_admin) returning id into v_new;
  perform public.dh_apply_card(v_new, p_cell, p_admin);
  update public.team_cards set status = 'resolved', detail = 'Copied: ' || v_item.item_name where id = p_card;
  return jsonb_build_object('card_id', v_new, 'name', v_item.item_name);
end $$;

-- 6. Voiding a sale / deleting / copying a lot ---------------------------------
create or replace function public.admin_undo_sale(p_purchase_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_tx uuid; v_team uuid; c record;
begin
  select transaction_id, team_id into v_tx, v_team from public.purchases where id = p_purchase_id for update;
  if not found then raise exception 'Sale not found'; end if;
  perform 1 from public.teams where id = v_team for update;
  for c in select id from public.team_cards where purchase_id = p_purchase_id order by created_at desc loop
    perform public.dh_revert_card(c.id, null);
  end loop;
  delete from public.team_powerups where purchase_id = p_purchase_id;
  delete from public.purchases where id = p_purchase_id;
  if v_tx is not null then delete from public.transactions where id = v_tx; end if;
end $$;

create or replace function public.admin_delete_lot(p_item_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p record; n integer := 0;
begin
  perform 1 from public.auction_items where id = p_item_id for update;
  if not found then raise exception 'Lot not found'; end if;
  for p in select id from public.purchases where item_id = p_item_id loop
    perform public.admin_undo_sale(p.id); n := n + 1;
  end loop;
  delete from public.auction_items where id = p_item_id;
  return jsonb_build_object('voided', n);
end $$;

create or replace function public.admin_copy_lot(p_item_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v public.auction_items%rowtype; v_base text; v_n integer; v_id uuid;
begin
  select * into v from public.auction_items where id = p_item_id;
  if not found then raise exception 'Lot not found'; end if;
  v_base := regexp_replace(v.item_name, '\s+#\d+$', '');
  select count(*) + 1 into v_n from public.auction_items where regexp_replace(item_name, '\s+#\d+$', '') = v_base;
  insert into public.auction_items(item_name, description, base_points, min_price, max_price, price_step, quantity, powerup_id, is_active, kind, effect)
  values (left(v_base || ' #' || v_n, 80), v.description, v.base_points, v.min_price, v.max_price, v.price_step, 1, v.powerup_id, true, v.kind, v.effect)
  returning id into v_id;
  return v_id;
end $$;

-- 7. Problem statements -------------------------------------------------------
create or replace function public.admin_swap_ps(p_card uuid, p_target uuid, p_admin uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.team_cards%rowtype; a public.teams%rowtype; b public.teams%rowtype;
begin
  select * into c from public.team_cards where id = p_card for update;
  if not found or c.effect->>'perk' <> 'swap_ps' then raise exception 'Swap card not found'; end if;
  if c.status = 'spent' then raise exception 'This team has already used its swap.'; end if;
  if c.team_id = p_target then raise exception 'Pick a different team.'; end if;
  select * into a from public.teams where id = c.team_id for update;
  select * into b from public.teams where id = p_target for update;
  if b.id is null then raise exception 'Team not found'; end if;
  if coalesce(a.problem_statement,'') = '' or coalesce(b.problem_statement,'') = '' then raise exception 'Both teams need a problem statement logged first.'; end if;
  if a.ps_locked or b.ps_locked then raise exception 'One of these problem statements was already swapped and is final.'; end if;
  update public.teams set problem_statement = b.problem_statement, ps_locked = true where id = a.id;
  update public.teams set problem_statement = a.problem_statement, ps_locked = true where id = b.id;
  update public.team_cards set status = 'spent', spent_at = now(), detail = 'Swapped with ' || b.team_name where id = p_card;
  insert into public.activity_log(team_id, kind, action, label, actor) values
    (a.id, 'auction', 'swapped', 'Problem statement swapped with ' || b.team_name, p_admin),
    (b.id, 'auction', 'swapped', 'Problem statement swapped by ' || a.team_name, p_admin);
  return jsonb_build_object('ok', true);
end $$;

-- 8. Penalties ----------------------------------------------------------------
create or replace function public.dh_land_penalty(p_team uuid, p_minutes integer, p_points integer, p_reason text, p_admin uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_minutes <> 0 then
    insert into public.team_powerups(team_id, name, minutes_delta, source, note, created_by)
    values (p_team, 'Penalty: ' || p_reason, -abs(p_minutes), 'manual', p_reason, p_admin);
  end if;
  if p_points <> 0 then
    insert into public.transactions(team_id, description, points, transaction_type, created_by)
    values (p_team, 'Penalty: ' || p_reason, -abs(p_points), 'adjustment', p_admin);
  end if;
end $$;

create or replace function public.admin_penalty(p_team uuid, p_minutes integer, p_points integer, p_reason text, p_admin uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.teams%rowtype; n public.teams%rowtype; v_shield uuid; v_pass uuid; v_next_shield uuid; v_msg text;
begin
  if coalesce(p_minutes,0) = 0 and coalesce(p_points,0) = 0 then raise exception 'Enter minutes or points for the penalty.'; end if;
  select * into t from public.teams where id = p_team for update;
  if not found then raise exception 'Team not found'; end if;

  -- 1) "No penalties": blocks it outright (used once)
  select id into v_shield from public.team_cards where team_id = p_team and status = 'held' and effect->>'perk' = 'no_penalty' order by created_at limit 1 for update;
  if v_shield is not null then
    update public.team_cards set status = 'spent', spent_at = now(), detail = 'Blocked: ' || p_reason where id = v_shield;
    insert into public.penalties(team_id, landed_team_id, minutes, points, reason, outcome, detail, created_by)
    values (p_team, null, p_minutes, p_points, p_reason, 'blocked', 'No penalties card used', p_admin);
    insert into public.activity_log(team_id, kind, action, label, actor) values (p_team, 'penalty', 'blocked', 'Penalty blocked (No penalties): ' || p_reason, p_admin);
    return jsonb_build_object('outcome', 'blocked', 'message', t.team_name || ' used No penalties — penalty blocked');
  end if;

  -- 2) "Pass penalties": goes to the next team in this venue, by team number (used once)
  select id into v_pass from public.team_cards where team_id = p_team and status = 'held' and effect->>'perk' = 'pass_penalty' order by created_at limit 1 for update;
  if v_pass is not null then
    select * into n from public.teams
     where id <> p_team and coalesce(bay,'') = coalesce(t.bay,'')
     order by (coalesce(paddle, 2147483647) <= coalesce(t.paddle, 2147483647)), coalesce(paddle, 2147483647), team_name
     limit 1;
    if n.id is not null then
      update public.team_cards set status = 'spent', spent_at = now(), detail = 'Passed to ' || n.team_name || ': ' || p_reason where id = v_pass;
      select id into v_next_shield from public.team_cards where team_id = n.id and status = 'held' and effect->>'perk' = 'no_penalty' order by created_at limit 1 for update;
      if v_next_shield is not null then
        update public.team_cards set status = 'spent', spent_at = now(), detail = 'Blocked a penalty passed by ' || t.team_name where id = v_next_shield;
        insert into public.penalties(team_id, landed_team_id, minutes, points, reason, outcome, detail, created_by)
        values (p_team, null, p_minutes, p_points, p_reason, 'passed_blocked', 'Passed to ' || n.team_name || ', who used No penalties — skipped', p_admin);
        insert into public.activity_log(team_id, kind, action, label, actor) values
          (p_team, 'penalty', 'passed', 'Penalty passed to ' || n.team_name || ' (skipped): ' || p_reason, p_admin),
          (n.id, 'penalty', 'blocked', 'Penalty from ' || t.team_name || ' blocked (No penalties): ' || p_reason, p_admin);
        return jsonb_build_object('outcome', 'passed_blocked', 'message', 'Passed to ' || n.team_name || ', who blocked it — penalty skipped');
      end if;
      perform public.dh_land_penalty(n.id, p_minutes, p_points, p_reason, p_admin);
      insert into public.penalties(team_id, landed_team_id, minutes, points, reason, outcome, detail, created_by)
      values (p_team, n.id, p_minutes, p_points, p_reason, 'passed', 'Passed to ' || n.team_name, p_admin);
      insert into public.activity_log(team_id, kind, action, label, points, minutes, actor) values
        (p_team, 'penalty', 'passed', 'Penalty passed to ' || n.team_name || ': ' || p_reason, null, null, p_admin),
        (n.id, 'penalty', 'received', 'Penalty passed by ' || t.team_name || ': ' || p_reason, nullif(-abs(p_points),0), nullif(-abs(p_minutes),0), p_admin);
      return jsonb_build_object('outcome', 'passed', 'message', 'Passed to ' || n.team_name);
    end if;
  end if;

  -- 3) Lands on the team
  perform public.dh_land_penalty(p_team, p_minutes, p_points, p_reason, p_admin);
  insert into public.penalties(team_id, landed_team_id, minutes, points, reason, outcome, created_by)
  values (p_team, p_team, p_minutes, p_points, p_reason, 'applied', p_admin);
  insert into public.activity_log(team_id, kind, action, label, points, minutes, actor)
  values (p_team, 'penalty', 'applied', 'Penalty: ' || p_reason, nullif(-abs(p_points),0), nullif(-abs(p_minutes),0), p_admin);
  return jsonb_build_object('outcome', 'applied', 'message', 'Penalty applied to ' || t.team_name);
end $$;

-- 9. Permissions + realtime ----------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'dh_apply_card(uuid, integer, uuid)', 'dh_revert_card(uuid, uuid)',
    'admin_sell_lot(uuid, uuid, integer, uuid, integer)', 'admin_resolve_trump(uuid, uuid, integer, uuid)',
    'admin_undo_sale(uuid)', 'admin_delete_lot(uuid)', 'admin_copy_lot(uuid)',
    'admin_swap_ps(uuid, uuid, uuid)', 'dh_land_penalty(uuid, integer, integer, text, uuid)',
    'admin_penalty(uuid, integer, integer, text, uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to postgres, service_role', f);
  end loop;
end $$;
grant all on public.team_cards, public.penalties to postgres, service_role;

do $$
declare t text;
begin
  foreach t in array array['team_cards','penalties','teams','auction_items'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; when undefined_object then null; end;
  end loop;
end $$;

-- 10. Health report now covers cards too: select * from public.daemon_health();
create or replace function public.daemon_health()
returns table(item text, status text) language plpgsql security definer set search_path = '' as $$
declare t text; f text;
begin
  foreach t in array array['teams','profiles','transactions','auction_items','purchases','team_stages','powerups','team_powerups',
                           'bingo_cells','team_bingo','team_members','activity_log','help_requests','team_secrets','event_settings','team_cards','penalties'] loop
    item := 'table ' || t; status := case when to_regclass('public.' || t) is null then 'MISSING' else 'OK' end; return next;
  end loop;
  foreach f in array array['admin_sell_lot','admin_undo_sale','admin_toggle_bingo','admin_set_bingo','team_balances','is_staff','current_team_id','admin_resolve_trump','admin_delete_lot','admin_copy_lot','admin_swap_ps','admin_penalty','dh_apply_card'] loop
    item := 'function ' || f; status := case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = f) then 'OK' else 'MISSING' end; return next;
  end loop;
  item := 'card types on lots'; status := case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='auction_items' and column_name='kind') then 'OK' else 'MISSING' end; return next;
  item := 'bingo squares'; status := (select case when count(*) = 25 then 'OK' else count(*) || ' of 25' end from public.bingo_cells); return next;
  item := 'event settings row'; status := case when exists (select 1 from public.event_settings) then 'OK' else 'MISSING' end; return next;
  item := 'realtime publication'; status := (select case when count(*) >= 6 then 'OK' else count(*) || ' tables published' end
    from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename in ('transactions','purchases','team_stages','team_powerups','team_bingo','event_settings','activity_log','team_members','help_requests')); return next;
end $$;
revoke all on function public.daemon_health() from public, anon, authenticated;
grant execute on function public.daemon_health() to postgres, service_role;
