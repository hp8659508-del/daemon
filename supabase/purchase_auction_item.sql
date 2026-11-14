-- Run once in the Supabase SQL Editor.
-- Each successful purchase writes both a purchases row and a negative
-- transactions ledger row in one database transaction.

CREATE OR REPLACE FUNCTION public.purchase_auction_item(p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_team_id uuid;
  v_role text;
  v_item public.auction_items%ROWTYPE;
  v_balance bigint;
  v_purchase_id uuid;
  v_transaction_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Please sign in';
  END IF;

  SELECT role, team_id INTO v_role, v_team_id
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_role <> 'team' OR v_team_id IS NULL THEN
    RAISE EXCEPTION 'Only team accounts can purchase items';
  END IF;

  -- Serialize purchases for the same team to prevent simultaneous overspending.
  PERFORM 1 FROM public.teams WHERE id = v_team_id FOR UPDATE;

  SELECT * INTO v_item
  FROM public.auction_items
  WHERE id = p_item_id AND is_active = true
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item unavailable';
  END IF;

  IF v_item.base_points IS NULL OR v_item.base_points <= 0 THEN
    RAISE EXCEPTION 'Item unavailable';
  END IF;

  SELECT COALESCE(SUM(points), 0)::bigint INTO v_balance
  FROM public.transactions
  WHERE team_id = v_team_id;

  IF v_balance < v_item.base_points THEN
    RAISE EXCEPTION 'Insufficient points';
  END IF;

  INSERT INTO public.transactions (team_id, description, points, transaction_type, created_by)
  VALUES (
    v_team_id,
    'Auction purchase: ' || v_item.item_name,
    -v_item.base_points,
    'purchase',
    v_user_id
  )
  RETURNING id INTO v_transaction_id;

  INSERT INTO public.purchases (team_id, item_id, transaction_id, purchase_price)
  VALUES (v_team_id, v_item.id, v_transaction_id, v_item.base_points)
  RETURNING id INTO v_purchase_id;

  RETURN jsonb_build_object(
    'purchase_id', v_purchase_id,
    'item_id', v_item.id,
    'item_name', v_item.item_name,
    'purchase_price', v_item.base_points,
    'remaining_points', v_balance - v_item.base_points
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purchase_auction_item(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purchase_auction_item(uuid) TO authenticated;
