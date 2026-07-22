-- WorkLog geofence permission-flow test harness
-- Run:  psql "$DATABASE_URL" -f tests/geofence-permission.sql
--
-- Covers the "outside the office radius, HR must permit it" rules:
--   G1  check-in outside the radius is REFUSED   (no start time, timer not running)
--   G2  the refused press records WHERE and WHEN the employee pressed it
--   G3  HR approval starts the clock FROM THE APPROVAL MOMENT, not the press
--   G4  check-out outside the radius is REFUSED  (employee stays clocked in)
--   G5  HR approval of the check-out stops the clock and saves the hours
--   G6  a denied check-out leaves the employee clocked in
--   G7  check-in INSIDE the radius starts immediately, no approval needed
--
-- IMPORTANT: each step is a SEPARATE top-level statement on purpose. now() is
-- frozen for the duration of a transaction, so G3 (approval time > press time)
-- is only observable across transactions. Do not merge these DO blocks into one.
--
-- These RPCs read auth.uid(), so the harness impersonates a real signed-in user.
-- It borrows EMP001 / ADM001 and removes everything it creates.
-- It ABORTS without touching anything if EMP001 already has a session today.

-- ---------------------------------------------------------------- G1 / G2
do $$
declare
  v_emp uuid; v_emp_auth uuid; v_adm_auth uuid; v_office uuid; j json;
begin
  select id, auth_user_id, office_id into v_emp, v_emp_auth, v_office
    from employees where emp_id = 'EMP001';
  select auth_user_id into v_adm_auth from employees where emp_id = 'ADM001';

  if v_emp_auth is null or v_adm_auth is null then
    raise exception 'SETUP FAIL: EMP001/ADM001 must exist and be activated';
  end if;
  if v_office is null then
    raise exception 'SETUP FAIL: EMP001 has no assigned office — the permission flow needs one';
  end if;
  if exists (select 1 from work_sessions where employee_id = v_emp
               and work_date = (now() at time zone 'Asia/Kolkata')::date) then
    raise exception 'ABORTED: EMP001 already has a session today; refusing to delete real data';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_emp_auth, 'role', 'authenticated')::text, true);

  j := start_session(19.0182, 72.8444);   -- Dadar, ~9.4 km from the office

  if (j->>'status') <> 'pending_approval' then
    raise exception 'G1 FAIL: expected pending_approval, got %', j->>'status'; end if;
  if (j->>'started_at') is not null then
    raise exception 'G1 FAIL: timer started despite being outside the radius'; end if;
  if (j->>'pending_kind') <> 'check_in' then
    raise exception 'G1 FAIL: pending_kind was %', j->>'pending_kind'; end if;

  if (j->>'requested_at') is null
     or (j->>'start_lat')::double precision <> 19.0182
     or (j->>'start_lng')::double precision <> 72.8444
     or (j->>'start_distance_m')::numeric < 9000 then
    raise exception 'G2 FAIL: press location/time not recorded correctly'; end if;

  raise notice 'G1 PASS - check-in refused, timer not started';
  raise notice 'G2 PASS - press location and time recorded';
end $$;

-- ---------------------------------------------------------------- G3
do $$
declare v_sid uuid; v_pressed timestamptz; j json;
begin
  select id, requested_at into v_sid, v_pressed from work_sessions
   where employee_id = (select id from employees where emp_id='EMP001')
     and pending_kind = 'check_in';

  perform set_config('request.jwt.claims',
    json_build_object('sub',(select auth_user_id from employees where emp_id='ADM001'),
                      'role','authenticated')::text, true);
  j := decide_session(v_sid, true);

  if (j->>'status') <> 'active' then
    raise exception 'G3 FAIL: approval did not activate the session (%)', j->>'status'; end if;
  if (j->>'started_at')::timestamptz <= v_pressed then
    raise exception 'G3 FAIL: clock must start at approval, not at the press (pressed %, started %)',
      v_pressed, j->>'started_at'; end if;
  if (j->>'start_distance_m')::numeric < 9000 then
    raise exception 'G3 FAIL: the recorded press distance was lost on approval'; end if;

  raise notice 'G3 PASS - clock started at approval, % after the press',
    (j->>'started_at')::timestamptz - v_pressed;
end $$;

-- ---------------------------------------------------------------- G4
do $$
declare j json;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub',(select auth_user_id from employees where emp_id='EMP001'),
                      'role','authenticated')::text, true);
  j := end_session(19.0182, 72.8444);

  if (j->>'pending_kind') <> 'check_out' then
    raise exception 'G4 FAIL: check-out was not held for permission (%)', j->>'pending_kind'; end if;
  if (j->>'ended_at') is not null or (j->>'total_minutes') is not null then
    raise exception 'G4 FAIL: hours were saved despite being outside the radius'; end if;

  raise notice 'G4 PASS - check-out refused, employee still clocked in';
end $$;

-- ---------------------------------------------------------------- G6
do $$
declare v_sid uuid; j json;
begin
  select id into v_sid from work_sessions
   where employee_id = (select id from employees where emp_id='EMP001')
     and pending_kind = 'check_out';

  perform set_config('request.jwt.claims',
    json_build_object('sub',(select auth_user_id from employees where emp_id='ADM001'),
                      'role','authenticated')::text, true);
  j := decide_session(v_sid, false);

  if (j->>'status') <> 'active' or (j->>'ended_at') is not null then
    raise exception 'G6 FAIL: a denied check-out must leave the employee clocked in'; end if;

  raise notice 'G6 PASS - denied check-out leaves employee clocked in';
end $$;

-- ---------------------------------------------------------------- G5
do $$
declare v_sid uuid; v_started timestamptz; j json;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub',(select auth_user_id from employees where emp_id='EMP001'),
                      'role','authenticated')::text, true);
  perform end_session(19.0182, 72.8444);

  select id, started_at into v_sid, v_started from work_sessions
   where employee_id = (select id from employees where emp_id='EMP001')
     and pending_kind = 'check_out';

  perform set_config('request.jwt.claims',
    json_build_object('sub',(select auth_user_id from employees where emp_id='ADM001'),
                      'role','authenticated')::text, true);
  j := decide_session(v_sid, true);

  if (j->>'status') <> 'completed' then
    raise exception 'G5 FAIL: approval did not complete the session (%)', j->>'status'; end if;
  if (j->>'ended_at')::timestamptz < v_started then
    raise exception 'G5 FAIL: end time precedes start time'; end if;
  if (j->>'end_out_of_range') <> 'true' then
    raise exception 'G5 FAIL: off-site check-out was not flagged'; end if;
  if (j->>'total_minutes') is null then
    raise exception 'G5 FAIL: hours were not saved on approval'; end if;

  raise notice 'G5 PASS - approval stopped the clock and saved the hours';
end $$;

-- ---------------------------------------------------------------- G7 + cleanup
do $$
declare v_emp uuid; v_lat double precision; v_lng double precision; j json;
begin
  select id into v_emp from employees where emp_id='EMP001';
  delete from work_sessions where employee_id = v_emp
     and work_date = (now() at time zone 'Asia/Kolkata')::date;

  -- ~50 m north of the office pin: comfortably inside the radius
  select lat + 0.00045, lng into v_lat, v_lng from locations
   where id = (select office_id from employees where id = v_emp);

  perform set_config('request.jwt.claims',
    json_build_object('sub',(select auth_user_id from employees where emp_id='EMP001'),
                      'role','authenticated')::text, true);
  j := start_session(v_lat, v_lng);

  if (j->>'status') <> 'active' then
    raise exception 'G7 FAIL: check-in at the office should start immediately (%)', j->>'status'; end if;
  if (j->>'started_at') is null or (j->>'pending_kind') is not null then
    raise exception 'G7 FAIL: an in-range check-in must not need approval'; end if;
  if (j->>'start_location_id') is null then
    raise exception 'G7 FAIL: in-range check-in was not linked to the office'; end if;

  delete from work_sessions where id = (j->>'id')::uuid;
  raise notice 'G7 PASS - in-range check-in starts immediately';
  raise notice 'ALL GEOFENCE TESTS PASSED';
end $$;

-- Remove the notifications and audit rows the harness generated.
delete from notification_queue where created_at > now() - interval '5 minutes';
delete from audit_logs        where created_at > now() - interval '5 minutes';
