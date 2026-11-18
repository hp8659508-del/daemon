-- ============================================================================
-- DAEMON HOUR · v17 — PROBLEM STATEMENT POOL (30). Run AFTER ui_v16. Re-runnable.
--  • problem_statements: the 30, written for beginners (goal, must-build steps, bonus, hint)
--  • admins allot one per team from the pool; teams see number + full description
--  • a swap moves the pool number too
-- ============================================================================
create table if not exists public.problem_statements (
  no integer primary key,
  title text not null,
  goal text not null,
  build jsonb not null default '[]'::jsonb,
  bonus text,
  hint text
);
alter table public.problem_statements enable row level security;
grant all on public.problem_statements to postgres, service_role;
alter table public.teams add column if not exists ps_no integer references public.problem_statements(no) on delete set null;

insert into public.problem_statements(no, title, goal, build, bonus, hint) values
  (1, 'Charge Coach', 'While the phone charges, show how fast it is charging and warn at 80% to protect the battery.', '["Show the battery % and whether the phone is charging, updating live", "Every minute, work out how much % was gained and label it Fast / Normal / Slow", "When the battery reaches 80% while charging, show an alert: “Unplug now to protect your battery”"]'::jsonb, 'Show “time to full” based on the current speed.', 'BroadcastReceiver for ACTION_BATTERY_CHANGED (level, plugged).'),
  (2, 'Drain Detective', 'Track how fast the battery drops and show which hour drained the most.', '["Save the battery % with the time, every 15 minutes while the app is open (or with a Save button)", "Show the saved readings as a list or a simple bar chart", "Highlight the “worst drain hour”: the hour with the biggest % drop"]'::jsonb, 'Keep recording in the background with WorkManager.', 'BatteryManager for the level; SharedPreferences or Room to save readings.'),
  (3, 'Unplug Reminder', 'Nag the user to unplug when the phone has been at 100% on the charger for too long.', '["Detect “charging AND battery at 100%” and start a timer", "After a set time (e.g. 2 minutes for the demo), play a loud, annoying alarm and show “Battery full: UNPLUG NOW”", "The alarm stops only when the charger is unplugged", "Count and show total “overcharge minutes saved”"]'::jsonb, 'Let the user choose the delay and the alarm sound.', 'ACTION_BATTERY_CHANGED + ACTION_POWER_DISCONNECTED; MediaPlayer for the alarm.'),
  (4, 'Heat Guard', 'Watch the battery temperature and warn when the phone gets too hot.', '["Show the battery temperature in °C, updating live", "Let the user set a limit (e.g. 40 °C)", "Above the limit, show a warning: “Your phone is hot: stop gaming or charging”", "Keep a list of every time it went over the limit (time + temperature)"]'::jsonb, 'Colour the temperature green / orange / red.', 'ACTION_BATTERY_CHANGED gives EXTRA_TEMPERATURE in tenths of a degree.'),
  (5, 'Wi-Fi Signal Mapper', 'Find the best and worst Wi-Fi spots in a building.', '["Show the current Wi-Fi signal strength (bars or dBm)", "A “Save spot” button that asks for a room name and saves it with the signal", "List all saved rooms sorted from strongest to weakest", "Mark the best room and the worst room clearly"]'::jsonb, 'Show a colour bar for each room.', 'WifiManager.getConnectionInfo().rssi (needs location permission on newer Android).'),
  (6, 'Speed Snapshot', 'Test internet speed and find the user’s fastest time of day.', '["A “Test now” button that downloads one small file and times it", "Show the speed in Mbps", "Save every result with the time of day", "Show “Your fastest hour” from the saved results"]'::jsonb, 'Draw the results as a simple chart.', 'Download a fixed-size file (e.g. 1–5 MB) with HttpURLConnection/OkHttp and time it.'),
  (7, 'Notification Noise Meter', 'Count which apps send the most notifications.', '["Ask for notification access with a clear explanation screen", "Count notifications per app while the app is allowed to listen", "Show a ranked list: “noisiest” app at the top, with its count"]'::jsonb, 'Show today’s total and a “quietest app” award.', 'NotificationListenerService (user enables it in Settings).'),
  (8, 'Permission Watchdog', 'Show which installed apps can use the camera, microphone or location.', '["List installed apps that request Camera, Microphone or Location", "Show small icons for which of the three each app has", "Flag apps that “probably shouldn’t need it” (e.g. a calculator with microphone access)"]'::jsonb, 'Tap an app to open its Settings page.', 'PackageManager.getInstalledPackages(GET_PERMISSIONS) → requestedPermissions.'),
  (9, 'App Update Age', 'Find apps that haven’t been updated in a long time, a security check.', '["List installed apps with their last update date", "Sort with the oldest first", "Mark apps not updated for 90+ days as “Needs attention”", "Show a score: “X of Y apps are up to date”"]'::jsonb, 'Button to open the app’s Play Store page.', 'PackageInfo.lastUpdateTime from PackageManager.'),
  (10, 'Data Budget Buddy', 'Set a daily mobile-data limit and warn the user before they cross it.', '["Let the user set a daily limit in MB", "Show mobile data used today as a progress ring", "Alert at 80% of the limit and again at 100%"]'::jsonb, 'Remember the last 7 days and show them as bars.', 'TrafficStats.getMobileRxBytes()/getMobileTxBytes(); save today’s starting value.'),
  (11, 'Night Owl Tracker', 'Track late-night phone use and give a “sleep disturbance” score.', '["Record each time the screen turns on between 11 PM and 6 AM", "Show tonight’s count and total minutes", "Turn it into a simple score out of 100 (more night use = lower score)"]'::jsonb, 'Show the last 7 nights as a chart.', 'Register for ACTION_SCREEN_ON / ACTION_SCREEN_OFF while the app (or a service) runs.'),
  (12, 'Data Hog Alert', 'Spot an app using a lot of mobile data and warn the user.', '["Ask for usage access with a clear explanation screen", "Show mobile data used per app in the last hour, highest first", "Alert when any app uses more than a set amount (e.g. 50 MB) in that hour"]'::jsonb, 'Let the user “ignore” trusted apps.', 'NetworkStatsManager.querySummary (needs Usage Access in Settings).'),
  (13, 'Charger Roulette', 'Grade each charger or cable by how fast it charges.', '["When plugged in, measure how much % is gained in a short test (e.g. 3–5 minutes)", "Turn the speed into a grade from A (fast) to F (slow)", "Save the result with a name the user types (“Bedroom cable”)", "Show all chargers with their grades, best first"]'::jsonb, 'Re-test a charger and show if it got better or worse.', 'ACTION_BATTERY_CHANGED level + a timer while plugged in.'),
  (14, 'Ghost Drain Hunter', 'Find out how much battery the phone loses while the screen is off.', '["Note the battery % and time when the screen turns off", "Note them again when the screen turns on", "Show the % lost per hour while the screen was off", "Flag “Something is draining your phone in your pocket” above a set rate"]'::jsonb, 'Keep a history of each screen-off period.', 'ACTION_SCREEN_OFF / ACTION_SCREEN_ON + battery level.'),
  (15, 'Pick-Up Reflex', 'Measure how quickly the user reacts to a notification, a “how hooked are you?” score.', '["The app sends its own test notification at a random moment", "Measure the time until the user taps it", "Show the reaction time and a label: “Lightning”, “Normal”, “Calm”", "Keep a list of past results and the average"]'::jsonb, 'A 5-round “challenge mode” with a final score.', 'NotificationCompat + a PendingIntent that opens the app; compare timestamps.'),
  (16, 'Phone Age Report', 'Make one shareable “report card” about the user’s phone.', '["Show the phone model, Android version and storage used/free", "Show the oldest app’s install date as “phone in use since”", "Show the battery health and temperature", "Put it all on one nice card with a “phone mood” emoji"]'::jsonb, 'A Share button that shares the card as an image.', 'Build.MODEL, StatFs for storage, PackageInfo.firstInstallTime, battery intent.'),
  (17, 'Fast Drain Alarm', 'Alert when the battery drops too fast.', '["Let the user set a rule, e.g. “more than 10% in 1 hour”", "Check the battery % regularly while the app runs", "Alert when the rule is broken, showing how fast it dropped"]'::jsonb, 'Name the app most used in that hour (usage access).', 'Battery level readings over time; UsageStatsManager for the bonus.'),
  (18, 'Clock Drift Checker', 'Check how many seconds the phone’s clock is off from real internet time.', '["Fetch the current time from an internet time API", "Compare it with the phone’s clock and show “X seconds fast/slow”", "Save each check with the date to show a history"]'::jsonb, 'Colour the result green if under 2 seconds.', 'Any public time API over HTTPS (e.g. worldtimeapi.org); compare with System.currentTimeMillis().'),
  (19, 'Touch Test Lab', 'Help users find dead pixels and dead touch areas on their screen.', '["A full-screen colour test: tap to switch between red, green, blue, white and black", "A touch grid: each square lights up when the finger passes over it", "Show how many squares were reached, and mark the ones never touched"]'::jsonb, 'A “Pass / Check again” result screen.', 'A custom View with onTouchEvent; no permissions needed.'),
  (20, 'Shake Meter', 'Measure how hard and how often the phone is shaken.', '["Show live shake strength from the motion sensor", "Count each shake above a threshold", "Show the strongest shake of the session", "Save each session (shakes + strongest) to a history list"]'::jsonb, 'A 10-second “shake challenge” with a high score.', 'SensorManager + TYPE_ACCELEROMETER; strength = √(x²+y²+z²) − gravity.'),
  (21, 'QR Safety Scanner', 'Scan a QR code and warn if its link looks suspicious before opening it.', '["Scan a QR code with the camera", "Show the link it contains", "Flag warning signs: not HTTPS, IP address instead of a name, link shorteners, odd words like “login-verify”", "Buttons: “Open anyway” and “Don’t open”"]'::jsonb, 'Keep a history of scanned links with their verdict.', 'Google ML Kit barcode scanning (or the ZXing library).'),
  (22, 'Photo Twin Finder', 'Find exact duplicate photos.', '["Let the user pick a folder or several photos", "Compare files by size, then by a file hash, to find exact copies", "Show duplicates side by side with their sizes", "Show the total space that could be freed"]'::jsonb, 'Delete a chosen copy (with confirmation).', 'Photo picker / Storage Access Framework; MessageDigest (MD5) for the hash.'),
  (23, 'Website Response Checker', 'Check how fast a list of websites responds.', '["Let the user add website addresses to a list", "A “Check all” button that requests each site and times the response", "Show each site with its time in ms and a green / orange / red dot", "Mark the fastest and the slowest site"]'::jsonb, 'Show “down” for sites that don’t respond.', 'HttpURLConnection or OkHttp in a coroutine/thread; time each request.'),
  (24, 'Smart Brightness Advisor', 'Tell the user when their screen is brighter than the room needs.', '["Read the room’s light level from the light sensor", "Read the current screen brightness", "If the screen is much brighter than needed, suggest a lower level", "Show a simple “battery you could save” estimate"]'::jsonb, 'A one-tap button to apply the suggested brightness.', 'TYPE_LIGHT sensor; Settings.System.SCREEN_BRIGHTNESS to read brightness.'),
  (25, 'Compass Health Check', 'Show the compass direction and warn when magnets are disturbing it.', '["Show a live compass needle and the direction in degrees (N, E, S, W)", "Show the magnetic field strength", "Warn “Magnetic interference!” when the strength is unusual", "Show a “move your phone in a figure 8” instruction screen to recalibrate"]'::jsonb, 'Show when the reading becomes steady again.', 'TYPE_MAGNETIC_FIELD + TYPE_ACCELEROMETER with SensorManager.getRotationMatrix.'),
  (26, 'Deadline Collision Alert', 'Spot days when too many deadlines pile up.', '["Let the user add tasks with a name and a due date", "Show the tasks grouped by date", "Warn “Busy day!” on any date with 3 or more deadlines", "Show the next 7 days at a glance"]'::jsonb, 'A reminder notification the day before a busy day.', 'DatePickerDialog + a list saved with Room or SharedPreferences.'),
  (27, 'Network Info Detective', 'Show the details of the current internet connection in one place.', '["Show whether the phone is on Wi-Fi, mobile data or offline", "For Wi-Fi: show the network name, IP address, signal strength and link speed", "Update the screen when the connection changes"]'::jsonb, 'A Copy button for the details.', 'ConnectivityManager + WifiManager.getConnectionInfo() (location permission for the name).'),
  (28, 'Sunlight Exposure Monitor', 'Track how much bright light the user gets during the day.', '["Show the live light level from the light sensor", "Label it Dark / Indoor / Bright / Sunlight", "Count the minutes spent in each label while the app runs", "Show a simple daily summary"]'::jsonb, 'An alert after a long time in the dark: “Go get some sunlight!”', 'SensorManager + TYPE_LIGHT (lux).'),
  (29, 'Duplicate Contact Finder', 'Find contacts saved more than once.', '["Ask for contacts permission", "Read all contacts with their phone numbers", "Group contacts that share the same number (ignore spaces and +91)", "Show each group of duplicates"]'::jsonb, 'Also match very similar names.', 'ContactsContract with a ContentResolver query.'),
  (30, 'Parking Spot Saver', 'Save where the vehicle is parked and help the user walk back to it.', '["A “Save my parking spot” button that saves the GPS location and time", "Show the saved spot and how long ago it was saved", "Show the distance to the car from where the user is now", "A “Navigate” button that opens Google Maps to the spot"]'::jsonb, 'Add a note or photo (“Level 2, pillar B”).', 'FusedLocationProviderClient; Location.distanceTo(); a geo: intent for Maps.')
on conflict (no) do update set title = excluded.title, goal = excluded.goal, build = excluded.build, bonus = excluded.bonus, hint = excluded.hint;

-- swaps (and undoing them) carry the pool number along with the text
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
  if coalesce(a.problem_statement,'') = '' or coalesce(b.problem_statement,'') = '' then raise exception 'Both teams need a problem statement allotted first.'; end if;
  if a.ps_locked or b.ps_locked then raise exception 'One of these problem statements was already swapped and is final.'; end if;
  update public.teams set problem_statement = b.problem_statement, ps_no = b.ps_no, ps_locked = true where id = a.id;
  update public.teams set problem_statement = a.problem_statement, ps_no = a.ps_no, ps_locked = true where id = b.id;
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
    if v_target is null then select id into v_target from public.teams where 'Swapped with ' || team_name = c.detail limit 1; end if;
    if v_target is not null then
      select * into a from public.teams where id = c.team_id for update;
      select * into b from public.teams where id = v_target for update;
      update public.teams set problem_statement = b.problem_statement, ps_no = b.ps_no, ps_locked = false where id = a.id;
      update public.teams set problem_statement = a.problem_statement, ps_no = a.ps_no, ps_locked = false where id = b.id;
    end if;
  end if;
  update public.team_cards set status = 'held', spent_at = null, detail = null where id = p_card;
  insert into public.activity_log(team_id, kind, action, label, actor) values (c.team_id, 'auction', 'reset', 'Card made usable again: ' || c.name, p_admin);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.admin_swap_ps(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.admin_card_unuse(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_swap_ps(uuid, uuid, uuid) to postgres, service_role;
grant execute on function public.admin_card_unuse(uuid, uuid) to postgres, service_role;

-- pool content rarely changes, but if it does, screens should reload
do $$ begin
  if to_regprocedure('public.dh_bump_global()') is not null then
    drop trigger if exists dh_pulse on public.problem_statements;
    create trigger dh_pulse after insert or update or delete on public.problem_statements for each row execute function public.dh_bump_global();
  end if;
end $$;
