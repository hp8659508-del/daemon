-- ============================================================================
-- DAEMON HOUR · v11 — bingo direction lock. Run AFTER ui_v10_spin_ledger.sql. Re-runnable.
-- The first line a team completes decides its direction for the rest of the round:
--   first full COLUMN → only columns earn the line bonus from then on
--   first full ROW    → only rows earn the line bonus
-- (If one stamp completes both at once, columns win.) Diagonals don't count.
-- Undoing back to no complete line clears the lock.
-- ============================================================================
alter table public.teams add column if not exists bingo_mode text check (bingo_mode in ('rows','columns'));

create or replace function public.admin_toggle_bingo(p_team_id uuid, p_idx integer, p_admin uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_cell public.bingo_cells%rowtype; v_marked boolean; v_set integer[];
  v_cols integer := 0; v_rows integer := 0; v_full integer := 0; v_paid_cols integer; v_paid_rows integer; v_paid_full integer; v_mode text; v_want_cols integer; v_want_rows integer;
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
  for c in 0..4 loop
    if array[c*5, c*5+1, c*5+2, c*5+3, c*5+4] <@ v_set then v_rows := v_rows + 1; end if;
  end loop;
  if v_cols = 5 then v_full := 1; end if;

  -- Direction lock: the first completed line (row or column) decides the rest of the round.
  select bingo_mode into v_mode from public.teams where id = p_team_id;
  if v_cols = 0 and v_rows = 0 then v_mode := null;                       -- nothing complete (e.g. after an undo)
  elsif v_mode is null then v_mode := case when v_cols > 0 then 'columns' else 'rows' end;
  elsif v_mode = 'columns' and v_cols = 0 then v_mode := 'rows';           -- its only column was undone
  elsif v_mode = 'rows' and v_rows = 0 then v_mode := 'columns';
  end if;
  update public.teams set bingo_mode = v_mode where id = p_team_id;
  v_want_cols := case when v_mode = 'columns' then v_cols else 0 end;
  v_want_rows := case when v_mode = 'rows' then v_rows else 0 end;

  select coalesce(bingo_line_bonus,0), coalesce(bingo_full_bonus,0) into v_col_bonus, v_full_bonus from public.event_settings where id = true;
  select coalesce(sum(case when description = 'Bingo column bonus' then 1 when description = 'Bingo column bonus undo' then -1 else 0 end),0),
         coalesce(sum(case when description = 'Bingo row bonus' then 1 when description = 'Bingo row bonus undo' then -1 else 0 end),0),
         coalesce(sum(case when description = 'Bingo full card bonus' then 1 when description = 'Bingo full card bonus undo' then -1 else 0 end),0)
    into v_paid_cols, v_paid_rows, v_paid_full from public.transactions where team_id = p_team_id;

  if v_col_bonus <> 0 then
    while v_paid_cols < v_want_cols loop
      insert into public.transactions(team_id, description, points, transaction_type, created_by) values (p_team_id,'Bingo column bonus',v_col_bonus,'bonus',p_admin);
      insert into public.activity_log(team_id, kind, action, label, points, actor) values (p_team_id,'bingo','granted','Column completed',v_col_bonus,p_admin);
      v_paid_cols := v_paid_cols + 1;
    end loop;
    while v_paid_cols > v_want_cols loop
      insert into public.transactions(team_id, description, points, transaction_type, created_by) values (p_team_id,'Bingo column bonus undo',-v_col_bonus,'adjustment',p_admin);
      insert into public.activity_log(team_id, kind, action, label, points, actor) values (p_team_id,'bingo','removed','Column bonus reversed',-v_col_bonus,p_admin);
      v_paid_cols := v_paid_cols - 1;
    end loop;
    while v_paid_rows < v_want_rows loop
      insert into public.transactions(team_id, description, points, transaction_type, created_by) values (p_team_id,'Bingo row bonus',v_col_bonus,'bonus',p_admin);
      insert into public.activity_log(team_id, kind, action, label, points, actor) values (p_team_id,'bingo','granted','Row completed',v_col_bonus,p_admin);
      v_paid_rows := v_paid_rows + 1;
    end loop;
    while v_paid_rows > v_want_rows loop
      insert into public.transactions(team_id, description, points, transaction_type, created_by) values (p_team_id,'Bingo row bonus undo',-v_col_bonus,'adjustment',p_admin);
      insert into public.activity_log(team_id, kind, action, label, points, actor) values (p_team_id,'bingo','removed','Row bonus reversed',-v_col_bonus,p_admin);
      v_paid_rows := v_paid_rows - 1;
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

  return jsonb_build_object('marked', v_marked, 'columns', v_cols, 'rows', v_rows, 'mode', v_mode, 'full', v_full = 1);
end $$;

revoke all on function public.admin_toggle_bingo(uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.admin_toggle_bingo(uuid, integer, uuid) to postgres, service_role;
