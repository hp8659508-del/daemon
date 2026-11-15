-- ============================================================================
-- DAEMON HOUR · v8 — zero-point safety (run AFTER ui_v7). Re-runnable.
-- The live DB has transactions_points_check (points <> 0). Selling a lot for
-- 0 points, or a bingo bonus set to 0, tried to write a 0-point row and failed.
--   • admin_sell_lot: a 0-point sale records the win with no ledger row
--   • admin_toggle_bingo: 0-point bonuses are skipped instead of written
--   • the check is normalised to exactly "points <> 0" (negative = spending)
-- ============================================================================

do $$ begin
  if exists (select 1 from pg_constraint where conname = 'transactions_points_check' and conrelid = 'public.transactions'::regclass) then
    alter table public.transactions drop constraint transactions_points_check;
  end if;
  alter table public.transactions add constraint transactions_points_check check (points <> 0) not valid;
end $$;

alter table public.purchases alter column transaction_id drop not null;

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
  if v_sold >= greatest(v_item.quantity, 1) then raise exception 'This lot is sold out'; end if;

  select coalesce(sum(points),0) into v_balance from public.transactions where team_id = p_team_id;
  if v_balance < p_price then raise exception 'Team has only % points', v_balance; end if;

  if p_price > 0 then
    insert into public.transactions(team_id, description, points, transaction_type, created_by)
    values (p_team_id, 'Auction: ' || v_item.item_name, -p_price, 'purchase', p_admin)
    returning id into v_tx;
  end if;

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
    if coalesce(v_cell.points, 0) <> 0 then
      insert into public.transactions(team_id, description, points, transaction_type, created_by)
      values (p_team_id, 'Bingo undo: ' || v_cell.label, -v_cell.points, 'adjustment', p_admin);
    end if;
    insert into public.activity_log(team_id, kind, action, label, points, actor) values (p_team_id,'bingo','unstamped',v_cell.label,-v_cell.points,p_admin);
    v_marked := false;
  else
    insert into public.team_bingo(team_id, idx, marked_by) values (p_team_id, p_idx, p_admin);
    if coalesce(v_cell.points, 0) <> 0 then
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

  select coalesce(bingo_line_bonus,0), coalesce(bingo_full_bonus,0) into v_col_bonus, v_full_bonus from public.event_settings where id = true;
  select coalesce(sum(case when description = 'Bingo column bonus' then 1 when description = 'Bingo column bonus undo' then -1 else 0 end),0),
         coalesce(sum(case when description = 'Bingo full card bonus' then 1 when description = 'Bingo full card bonus undo' then -1 else 0 end),0)
    into v_paid_cols, v_paid_full from public.transactions where team_id = p_team_id;

  if v_col_bonus <> 0 then
    while v_paid_cols < v_cols loop
      insert into public.transactions(team_id, description, points, transaction_type, created_by) values (p_team_id,'Bingo column bonus',v_col_bonus,'bonus',p_admin);
      insert into public.activity_log(team_id, kind, action, label, points, actor) values (p_team_id,'bingo','granted','Column completed',v_col_bonus,p_admin);
      v_paid_cols := v_paid_cols + 1;
    end loop;
    while v_paid_cols > v_cols loop
      insert into public.transactions(team_id, description, points, transaction_type, created_by) values (p_team_id,'Bingo column bonus undo',-v_col_bonus,'adjustment',p_admin);
      insert into public.activity_log(team_id, kind, action, label, points, actor) values (p_team_id,'bingo','removed','Column bonus reversed',-v_col_bonus,p_admin);
      v_paid_cols := v_paid_cols - 1;
    end loop;
  end if;
  if v_full_bonus <> 0 then
    if v_paid_full < v_full then
      insert into public.transactions(team_id, description, points, transaction_type, created_by) values (p_team_id,'Bingo full card bonus',v_full_bonus,'bonus',p_admin);
      insert into public.activity_log(team_id, kind, action, label, points, actor) values (p_team_id,'bingo','granted','Full card BINGO',v_full_bonus,p_admin);
    elsif v_paid_full > v_full then
      insert into public.transactions(team_id, description, points, transaction_type, created_by) values (p_team_id,'Bingo full card bonus undo',-v_full_bonus,'adjustment',p_admin);
      insert into public.activity_log(team_id, kind, action, label, points, actor) values (p_team_id,'bingo','removed','Full card bonus reversed',-v_full_bonus,p_admin);
    end if;
  end if;

  return jsonb_build_object('marked', v_marked, 'columns', v_cols, 'full', v_full = 1);
end $$;

revoke all on function public.admin_sell_lot(uuid, uuid, integer, uuid) from public, anon, authenticated;
revoke all on function public.admin_toggle_bingo(uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.admin_sell_lot(uuid, uuid, integer, uuid) to postgres, service_role;
grant execute on function public.admin_toggle_bingo(uuid, integer, uuid) to postgres, service_role;
