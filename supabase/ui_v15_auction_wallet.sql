-- ============================================================================
-- DAEMON HOUR · v15 — separate AUCTION wallet. Run AFTER ui_v14_resilience.sql. Re-runnable.
--
--  • MAIN points  = the real score (Rapid Fire, Bingo, Spin, penalties, Points tab,
--                   and any card that GIVES points). Shown to teams and on the leaderboard.
--  • AUCTION points = a separate wallet only for paying for auction cards.
--                   Every team starts with the auction budget (default 1000) and it
--                   never mixes into main points.
-- ============================================================================

alter table public.transactions add column if not exists wallet text not null default 'main';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'transactions_wallet_check') then
    alter table public.transactions add constraint transactions_wallet_check check (wallet in ('main','auction'));
  end if;
end $$;
create index if not exists transactions_team_wallet_idx on public.transactions(team_id, wallet);

alter table public.event_settings add column if not exists auction_budget integer not null default 1000;

-- what teams already paid at the auction comes out of the auction wallet, not their score
update public.transactions set wallet = 'auction' where transaction_type = 'purchase' and wallet = 'main';

-- main points only (score, leaderboard, ledgers)
create or replace function public.team_balances()
returns table(team_id uuid, balance bigint) language sql stable security definer set search_path = '' as $$
  select team_id, coalesce(sum(points), 0)::bigint from public.transactions where wallet = 'main' group by team_id
$$;
create or replace function public.dh_pts(p_team uuid) returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum(points),0)::bigint from public.transactions where team_id = p_team and wallet = 'main'
$$;
-- auction wallet = budget + everything spent/refunded at the auction
create or replace function public.dh_auction_pts(p_team uuid) returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce((select auction_budget from public.event_settings where id = true), 1000)::bigint
       + coalesce((select sum(points) from public.transactions where team_id = p_team and wallet = 'auction'), 0)::bigint
$$;

-- selling: pays from the AUCTION wallet
create or replace function public.admin_sell_lot(p_item_id uuid, p_team_id uuid, p_price integer, p_admin uuid, p_cell integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_item public.auction_items%rowtype; v_wallet bigint; v_sold integer; v_tx uuid; v_purchase uuid; v_card uuid; v_pb bigint; v_mb integer;
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
  v_wallet := public.dh_auction_pts(p_team_id);
  if v_wallet < p_price then raise exception 'Team has only % auction points', v_wallet; end if;
  v_pb := public.dh_pts(p_team_id); v_mb := public.dh_mins(p_team_id);

  if p_price > 0 then
    insert into public.transactions(team_id, description, points, transaction_type, created_by, wallet)
    values (p_team_id, 'Auction: ' || v_item.item_name, -p_price, 'purchase', p_admin, 'auction') returning id into v_tx;
  end if;
  insert into public.purchases(team_id, item_id, transaction_id, purchase_price)
  values (p_team_id, p_item_id, v_tx, p_price) returning id into v_purchase;
  insert into public.team_cards(team_id, purchase_id, item_id, name, kind, effect, source, created_by)
  values (p_team_id, v_purchase, p_item_id, v_item.item_name, v_item.kind, v_item.effect, 'auction', p_admin) returning id into v_card;
  perform public.dh_apply_card(v_card, p_cell, p_admin);          -- a "+points" card adds to MAIN points
  perform public.dh_ledger(p_team_id, 'auction', v_item.item_name || ' (paid ' || p_price || ' auction pts)', v_pb, v_mb, v_card, p_admin);
  return jsonb_build_object('purchase_id', v_purchase, 'card_id', v_card, 'kind', v_item.kind, 'remaining', public.dh_auction_pts(p_team_id));
end $$;

do $$
declare f text;
begin
  foreach f in array array['team_balances()','dh_pts(uuid)','dh_auction_pts(uuid)','admin_sell_lot(uuid, uuid, integer, uuid, integer)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to postgres, service_role', f);
  end loop;
end $$;
