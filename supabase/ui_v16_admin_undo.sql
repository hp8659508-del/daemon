-- ============================================================================
-- DAEMON HOUR · v16 — admins can undo anything on a team. Run AFTER ui_v15. Re-runnable.
--   admin_card_remove   : take a card away (void the sale / undo the spin / undo a trump copy)
--   admin_card_unuse    : a "used" card becomes usable again (an undone swap swaps back)
--   admin_penalty_remove: delete a penalty and give back what it took
--   admin_ps_unlock     : make a swapped problem statement editable again
-- ============================================================================

-- swaps now remember who they swapped with (so they can be undone)
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
  update public.team_cards set status = 'spent', spent_at = now(), detail = 'Swapped with ' || b.team_name,
    applied = applied || jsonb_build_object('swap_target', b.id) where id = p_card;
  insert into public.activity_log(team_id, kind, action, label, actor) values
    (a.id, 'auction', 'swapped', 'Problem statement swapped with ' || b.team_name, p_admin),
    (b.id, 'auction', 'swapped', 'Problem statement swapped by ' || a.team_name, p_admin);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_card_unuse(p_card uuid, p_admin uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.team_cards%rowtype; v_target uuid; a public.teams%rowtype; b public.teams%rowtype;
begin
  select * into c from public.team_cards where id = p_card for update;
  if not found then raise exception 'Card not found'; end if;
  if c.status <> 'spent' then raise exception 'This card isn''t marked as used.'; end if;
  if c.effect->>'perk' = 'swap_ps' then
    v_target := nullif(c.applied->>'swap_target', '')::uuid;
    if v_target is null then   -- older swaps: find the other team by name
      select id into v_target from public.teams where 'Swapped with ' || team_name = c.detail limit 1;
    end if;
    if v_target is not null then
      select * into a from public.teams where id = c.team_id for update;
      select * into b from public.teams where id = v_target for update;
      update public.teams set problem_statement = b.problem_statement, ps_locked = false where id = a.id;
      update public.teams set problem_statement = a.problem_statement, ps_locked = false where id = b.id;
    end if;
  end if;
  update public.team_cards set status = 'held', spent_at = null, detail = null where id = p_card;
  insert into public.activity_log(team_id, kind, action, label, actor) values (c.team_id, 'auction', 'reset', 'Card made usable again: ' || c.name, p_admin);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_card_remove(p_card uuid, p_admin uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.team_cards%rowtype;
begin
  select * into c from public.team_cards where id = p_card for update;
  if not found then raise exception 'Card not found'; end if;
  if c.status = 'spent' then perform public.admin_card_unuse(p_card, p_admin); end if;   -- undo its use first
  if c.source = 'auction' and c.purchase_id is not null then
    perform public.admin_undo_sale(c.purchase_id);          -- refunds the auction wallet + undoes effects (and any trump copy)
  else
    perform public.dh_revert_card(p_card, p_admin);          -- spin result / trump copy / manual
  end if;
  -- a trump copy removed on its own: the trump card goes back to "choose a card"
  if c.source = 'trump' and c.purchase_id is not null then
    update public.team_cards set status = 'pending', detail = 'Choose which card it copies'
     where purchase_id = c.purchase_id and kind = 'trump' and status = 'resolved';
  end if;
  insert into public.activity_log(team_id, kind, action, label, actor) values (c.team_id, 'auction', 'removed', 'Card removed by an organiser: ' || c.name, p_admin);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_penalty_remove(p_id uuid, p_admin uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.penalties%rowtype;
begin
  select * into p from public.penalties where id = p_id for update;
  if not found then raise exception 'Penalty not found'; end if;
  if p.landed_team_id is not null then
    -- what it took from the team that received it (written within seconds of the penalty)
    delete from public.transactions where team_id = p.landed_team_id and description = 'Penalty: ' || p.reason
       and created_at between p.created_at - interval '10 seconds' and p.created_at + interval '10 seconds';
    delete from public.team_powerups where team_id = p.landed_team_id and name = 'Penalty: ' || p.reason
       and created_at between p.created_at - interval '10 seconds' and p.created_at + interval '10 seconds';
    delete from public.team_ledger where team_id = p.landed_team_id and round = 'penalty' and label = 'Penalty: ' || p.reason
       and created_at between p.created_at - interval '10 seconds' and p.created_at + interval '10 seconds';
  end if;
  delete from public.penalties where id = p_id;
  insert into public.activity_log(team_id, kind, action, label, actor) values (p.team_id, 'penalty', 'removed', 'Penalty removed: ' || p.reason, p_admin);
  return jsonb_build_object('ok', true, 'note', 'Shield cards used by this penalty stay used: use "Make usable again" on them if needed.');
end $$;

create or replace function public.admin_ps_unlock(p_team uuid)
returns void language sql security definer set search_path = '' as $$
  update public.teams set ps_locked = false where id = p_team
$$;

do $$
declare f text;
begin
  foreach f in array array['admin_swap_ps(uuid, uuid, uuid)','admin_card_unuse(uuid, uuid)','admin_card_remove(uuid, uuid)','admin_penalty_remove(uuid, uuid)','admin_ps_unlock(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to postgres, service_role', f);
  end loop;
end $$;
