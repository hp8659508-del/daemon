-- ============================================================================
-- DAEMON HOUR · v12 — RAPID FIRE (Round 1 MCQ quiz). Run AFTER ui_v11. Re-runnable.
--   • Sections, each with its own time limit and points per correct answer
--   • Teams take it section by section; time is enforced on the server
--   • Correct answers are never sent to team screens
--   • Leaving the quiz screen is recorded (violations) for the host to see
--   • Opened per team from Rounds (activity 'quiz'), like the other rounds
-- ============================================================================

-- 1. the round
do $$
declare c text;
begin
  select conname into c from pg_constraint where conrelid = 'public.team_stages'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%activity%';
  if c is not null then execute format('alter table public.team_stages drop constraint %I', c); end if;
  alter table public.team_stages add constraint team_stages_activity_check check (activity in ('quiz','auction','spin','bingo'));
end $$;

-- 2. content
create table if not exists public.quiz_sections (
  id uuid primary key default gen_random_uuid(),
  idx integer not null default 0,
  title text not null,
  time_limit_sec integer not null default 120 check (time_limit_sec between 10 and 7200),
  points_per_correct integer not null default 10,
  created_at timestamptz not null default now()
);
create table if not exists public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.quiz_sections(id) on delete cascade,
  idx integer not null default 0,
  prompt text not null,
  options jsonb not null,                 -- ["A text","B text","C text","D text"]
  correct integer not null check (correct between 0 and 5),
  created_at timestamptz not null default now()
);
create index if not exists quiz_questions_section_idx on public.quiz_questions(section_id, idx);

-- 3. progress
create table if not exists public.quiz_runs (          -- one per team per section
  team_id uuid not null references public.teams(id) on delete cascade,
  section_id uuid not null references public.quiz_sections(id) on delete cascade,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  submitted_at timestamptz,
  correct integer,
  points integer,
  primary key (team_id, section_id)
);
create table if not exists public.quiz_answers (
  team_id uuid not null references public.teams(id) on delete cascade,
  question_id uuid not null references public.quiz_questions(id) on delete cascade,
  choice integer not null,
  answered_at timestamptz not null default now(),
  primary key (team_id, question_id)
);
create table if not exists public.quiz_flags (           -- left the screen, etc.
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  kind text not null,
  created_at timestamptz not null default now()
);
alter table public.quiz_sections enable row level security;
alter table public.quiz_questions enable row level security;
alter table public.quiz_runs enable row level security;
alter table public.quiz_answers enable row level security;
alter table public.quiz_flags enable row level security;

-- 4. logic (service role only; the API checks who the team is)
create or replace function public.quiz_submit_section(p_team uuid, p_section uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.quiz_runs%rowtype; s public.quiz_sections%rowtype; v_correct integer; v_pts integer; v_pb bigint; v_mb integer;
begin
  select * into r from public.quiz_runs where team_id = p_team and section_id = p_section for update;
  if not found then raise exception 'Section not started'; end if;
  if r.submitted_at is not null then return jsonb_build_object('already', true, 'correct', r.correct, 'points', r.points); end if;
  select * into s from public.quiz_sections where id = p_section;
  select count(*) into v_correct from public.quiz_answers a join public.quiz_questions q on q.id = a.question_id
   where a.team_id = p_team and q.section_id = p_section and a.choice = q.correct;
  v_pts := v_correct * s.points_per_correct;
  v_pb := public.dh_pts(p_team); v_mb := public.dh_mins(p_team);
  update public.quiz_runs set submitted_at = now(), correct = v_correct, points = v_pts where team_id = p_team and section_id = p_section;
  if v_pts <> 0 then
    insert into public.transactions(team_id, description, points, transaction_type, created_by)
    values (p_team, 'Rapid fire: ' || s.title || ' (' || v_correct || ' correct)', v_pts, 'bonus', null);
  end if;
  insert into public.activity_log(team_id, kind, action, label, points) values (p_team, 'quiz', 'granted', 'Rapid fire · ' || s.title || ': ' || v_correct || ' correct', nullif(v_pts, 0));
  return jsonb_build_object('correct', v_correct, 'points', v_pts);
end $$;

create or replace function public.quiz_start_section(p_team uuid, p_section uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.quiz_sections%rowtype; r public.quiz_runs%rowtype;
begin
  perform 1 from public.teams where id = p_team for update;
  select * into s from public.quiz_sections where id = p_section;
  if not found then raise exception 'Section not found'; end if;
  -- every earlier section must be finished
  if exists (select 1 from public.quiz_sections e where e.idx < s.idx
               and not exists (select 1 from public.quiz_runs x where x.team_id = p_team and x.section_id = e.id and x.submitted_at is not null)) then
    raise exception 'Finish the earlier section first';
  end if;
  select * into r from public.quiz_runs where team_id = p_team and section_id = p_section;
  if found then return jsonb_build_object('ends_at', r.ends_at); end if;
  insert into public.quiz_runs(team_id, section_id, ends_at) values (p_team, p_section, now() + make_interval(secs => s.time_limit_sec)) returning * into r;
  return jsonb_build_object('ends_at', r.ends_at);
end $$;

create or replace function public.quiz_answer(p_team uuid, p_question uuid, p_choice integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare q public.quiz_questions%rowtype; r public.quiz_runs%rowtype;
begin
  select * into q from public.quiz_questions where id = p_question;
  if not found then raise exception 'Question not found'; end if;
  select * into r from public.quiz_runs where team_id = p_team and section_id = q.section_id;
  if not found then raise exception 'Section not started'; end if;
  if r.submitted_at is not null then raise exception 'This section is already submitted'; end if;
  if now() > r.ends_at + interval '3 seconds' then
    perform public.quiz_submit_section(p_team, q.section_id);
    raise exception 'Time is up for this section';
  end if;
  if p_choice < 0 or p_choice >= jsonb_array_length(q.options) then raise exception 'Invalid option'; end if;
  insert into public.quiz_answers(team_id, question_id, choice) values (p_team, p_question, p_choice)
  on conflict (team_id, question_id) do update set choice = excluded.choice, answered_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- submit any section whose time ran out (called whenever a team loads the quiz)
create or replace function public.quiz_sweep(p_team uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select section_id from public.quiz_runs where team_id = p_team and submitted_at is null and now() > ends_at + interval '3 seconds' loop
    perform public.quiz_submit_section(p_team, r.section_id);
  end loop;
end $$;

-- host: wipe a team's attempt (and refund the points it earned)
create or replace function public.quiz_reset(p_team uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.transactions where team_id = p_team and description like 'Rapid fire: %';
  delete from public.quiz_answers where team_id = p_team;
  delete from public.quiz_runs where team_id = p_team;
  delete from public.quiz_flags where team_id = p_team;
end $$;

do $$
declare f text;
begin
  foreach f in array array['quiz_submit_section(uuid, uuid)','quiz_start_section(uuid, uuid)','quiz_answer(uuid, uuid, integer)','quiz_sweep(uuid)','quiz_reset(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to postgres, service_role', f);
  end loop;
end $$;
grant all on public.quiz_sections, public.quiz_questions, public.quiz_runs, public.quiz_answers, public.quiz_flags to postgres, service_role;
do $$
declare t text;
begin
  foreach t in array array['quiz_sections','quiz_questions','quiz_runs','quiz_flags'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; when undefined_object then null; end;
  end loop;
end $$;

-- 5. the workshop quiz (only loaded if there are no sections yet)
do $$
declare e uuid; m uuid; h uuid;
begin
  if exists (select 1 from public.quiz_sections) then return; end if;
  insert into public.quiz_sections(idx, title, time_limit_sec, points_per_correct) values (1, 'Easy', 90, 10) returning id into e;
  insert into public.quiz_sections(idx, title, time_limit_sec, points_per_correct) values (2, 'Medium', 150, 20) returning id into m;
  insert into public.quiz_sections(idx, title, time_limit_sec, points_per_correct) values (3, 'Hard', 180, 30) returning id into h;
  insert into public.quiz_questions(section_id, idx, prompt, options, correct) values
  (e, 1, 'What do you tap 7 times to unlock Developer Options?', '["Build number","Kernel version","Android version","Model number"]', 0),
  (e, 2, 'Which command lists the devices connected through adb?', '["adb list","adb status","adb devices","adb connect"]', 2),
  (e, 3, 'Which file in an Android project declares permissions?', '["build.gradle","AndroidManifest.xml","MainActivity.kt","strings.xml"]', 1),
  (m, 1, 'Which of these does NOT trigger a runtime permission prompt on Android 14 / iOS 18?', '["Live camera preview","System photo picker","Coarse GPS location","Push notifications"]', 1),
  (m, 2, 'Which app drains the most battery in one hour of use?', '["Spotify streaming music with the screen off","WhatsApp text chatting","Google Maps navigation","Kindle reading"]', 2),
  (m, 3, 'Which app has the weakest reason to need microphone access?', '["Instagram","Google Maps","Google Translate","An offline PDF reader"]', 3),
  (m, 4, 'What''s the difference between the green ▶ Run button and the ⚡ Apply Changes button in Android Studio?', '["Run rebuilds and restarts the app; Apply Changes pushes edits into the running app","Run is for emulators only; Apply Changes is for phones","Run deletes app data; Apply Changes keeps it","There is no difference"]', 0),
  (h, 1, 'You rotate the phone while the AI text is streaming. What happens, and what fixes it?', '["Text keeps streaming; nothing is needed","Text is lost because the Activity is recreated; fix with a ViewModel","Text is lost; fix with a Toast","The app always crashes; fix with try/catch"]', 1),
  (h, 2, 'Your app uses Gemini''s free tier (5 RPM) to explain runtime permissions. Which design prevents exceeding the quota across rapid taps?', '["Debounce tap handlers by 500ms and mask user identifiers","Fetch explanations lazily on tap and persist responses on-device","Queue requests in a background worker with exponential backoff","Route calls through an authenticated proxy with per-device rate headers"]', 1),
  (h, 3, 'Which app is likely to request the most permissions?', '["WhatsApp","Truecaller","Instagram","Google Maps"]', 1);
end $$;
