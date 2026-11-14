-- DAEMON HOUR: admin-controlled, one-time event starting-points publication.
-- Existing event_settings.starting_points is retained as the published amount.

ALTER TABLE public.event_settings
  ADD COLUMN IF NOT EXISTS starting_points_published boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.publish_event_starting_points(p_points bigint)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_count integer;
BEGIN
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_admin_id AND role = 'admin') THEN
    RAISE EXCEPTION 'Administrator access required';
  END IF;
  IF p_points IS NULL OR p_points < 0 OR p_points > 1000000000 THEN
    RAISE EXCEPTION 'Enter a valid starting-points amount';
  END IF;

  PERFORM 1 FROM public.event_settings WHERE id = true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event settings row was not found'; END IF;
  IF EXISTS (SELECT 1 FROM public.event_settings WHERE id = true AND starting_points_published = true) THEN
    RAISE EXCEPTION 'Starting points have already been published';
  END IF;

  -- Normalize legacy pre-publication opening entries to the selected amount.
  WITH ranked AS (
    SELECT id, row_number() OVER (PARTITION BY team_id ORDER BY created_at NULLS LAST, id) AS rn
    FROM public.transactions WHERE description = 'Initial event points'
  )
  UPDATE public.transactions t SET points = p_points::integer
  FROM ranked r WHERE t.id = r.id AND r.rn = 1;

  WITH ranked AS (
    SELECT id, row_number() OVER (PARTITION BY team_id ORDER BY created_at NULLS LAST, id) AS rn
    FROM public.transactions WHERE description = 'Initial event points'
  )
  DELETE FROM public.transactions t USING ranked r WHERE t.id = r.id AND r.rn > 1;

  INSERT INTO public.transactions (team_id, description, points, transaction_type, created_by)
  SELECT t.id, 'Initial event points', p_points::integer, 'bonus', v_admin_id
  FROM public.teams t
  WHERE NOT EXISTS (
    SELECT 1 FROM public.transactions x
    WHERE x.team_id = t.id AND x.description = 'Initial event points'
  );

  SELECT count(*)::integer INTO v_count FROM public.teams;
  UPDATE public.event_settings
  SET starting_points = p_points::integer, starting_points_published = true
  WHERE id = true;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_event_starting_points(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_event_starting_points(bigint) TO authenticated;
