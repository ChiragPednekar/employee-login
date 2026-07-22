


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."apply_leave"("p_start" "date", "p_end" "date", "p_day_part" "text", "p_reason" "text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_emp employees; v_working numeric; v_avail numeric; v_paid numeric; v_unpaid numeric;
  v_leave leave_requests; v_clash leave_requests;
begin
  select * into v_emp from employees where auth_user_id=auth.uid() and active;
  if v_emp.id is null then raise exception 'Not an active employee'; end if;
  if p_end < p_start then raise exception 'End date before start date'; end if;
  if coalesce(trim(p_reason),'')='' then raise exception 'Please give a reason'; end if;

  -- Overlap guard. daterange is inclusive-exclusive, hence end + 1.
  select * into v_clash from leave_requests
   where employee_id = v_emp.id
     and status in ('pending','approved')
     and daterange(start_date, end_date + 1) && daterange(p_start, p_end + 1)
     -- allow the two distinct halves of a single day
     and not (
       p_day_part <> 'full' and day_part <> 'full'
       and start_date = end_date and start_date = p_start and p_start = p_end
       and day_part <> p_day_part
     )
   limit 1;

  if v_clash.id is not null then
    raise exception 'You already have a % leave request covering % to %',
      v_clash.status, to_char(v_clash.start_date,'DD Mon YYYY'), to_char(v_clash.end_date,'DD Mon YYYY');
  end if;

  perform ensure_leave_allocations(v_emp.id);

  if p_day_part <> 'full' then
    if p_start <> p_end then raise exception 'Half-day leave must be a single day'; end if;
    if extract(dow from p_start) = 0 then raise exception 'Sunday is a weekly off'; end if;
    v_working := 0.5;
  else
    v_working := working_days(p_start, p_end);
    if v_working = 0 then raise exception 'That range has no working days (Sundays/holidays only)'; end if;
  end if;

  select coalesce(sum(days),0) into v_avail from leave_ledger where employee_id=v_emp.id;
  v_paid := least(v_working, greatest(v_avail,0));
  v_unpaid := v_working - v_paid;

  insert into leave_requests(employee_id,start_date,end_date,day_part,days,reason,paid_days,unpaid_days)
  values (v_emp.id,p_start,p_end,p_day_part,v_working,trim(p_reason),v_paid,v_unpaid)
  returning * into v_leave;

  perform audit_log('leave_requested', v_emp.id, null,
    jsonb_build_object('start',p_start,'end',p_end,'working',v_working,'paid',v_paid,'unpaid',v_unpaid),
    'Employee applied for leave', v_emp.id);
  perform queue_push_approvers(v_emp.id,'Leave request',
    v_emp.name||' ('||v_emp.emp_id||') applied for '||v_working||' working day(s).', '/admin/leaves');
  return row_to_json(v_leave);
end $$;


ALTER FUNCTION "public"."apply_leave"("p_start" "date", "p_end" "date", "p_day_part" "text", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_log"("p_action" "text", "p_employee" "uuid" DEFAULT NULL::"uuid", "p_old" "jsonb" DEFAULT NULL::"jsonb", "p_new" "jsonb" DEFAULT NULL::"jsonb", "p_reason" "text" DEFAULT NULL::"text", "p_actor" "uuid" DEFAULT NULL::"uuid") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  insert into audit_logs (action, employee_id, performed_by, old_value, new_value, reason)
  values (p_action, p_employee, p_actor, p_old, p_new, p_reason);
$$;


ALTER FUNCTION "public"."audit_log"("p_action" "text", "p_employee" "uuid", "p_old" "jsonb", "p_new" "jsonb", "p_reason" "text", "p_actor" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_decide_for"("p_employee" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.is_admin() or public.is_team_manager(p_employee);
$$;


ALTER FUNCTION "public"."can_decide_for"("p_employee" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_leave"("p_id" "uuid") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_leave leave_requests; v_actor uuid;
begin
  v_actor := current_employee_id();
  select * into v_leave from leave_requests where id=p_id;
  if v_leave.id is null then raise exception 'Request not found'; end if;
  if not (v_leave.employee_id = v_actor or is_admin()) then raise exception 'Not allowed'; end if;
  if v_leave.status in ('denied','cancelled') then raise exception 'Already closed'; end if;

  insert into leave_ledger(employee_id, alloc_month, kind, days, leave_request_id, note)
    select employee_id, alloc_month, 'adjustment', -days, p_id, 'Leave cancelled — refund'
    from leave_ledger where leave_request_id = p_id and kind='consumption';

  update leave_requests set status='cancelled', decided_by=v_actor, decided_at=now() where id=p_id;
  perform audit_log('leave_cancelled', v_leave.employee_id, null,
    jsonb_build_object('start',v_leave.start_date,'end',v_leave.end_date), 'Leave cancelled', v_actor);
  perform recompute_sandwich(v_leave.employee_id, v_leave.start_date, v_leave.end_date);
  perform sync_sandwich_on_requests(v_leave.employee_id);
  return json_build_object('ok', true);
end $$;


ALTER FUNCTION "public"."cancel_leave"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_employee_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select id from public.employees where auth_user_id = auth.uid();
$$;


ALTER FUNCTION "public"."current_employee_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."decide_leave"("p_id" "uuid", "p_approve" boolean) RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_leave leave_requests; v_actor uuid; v_avail numeric; v_paid numeric; v_unpaid numeric;
  v_need numeric; r record; v_take numeric;
begin
  select * into v_leave from leave_requests where id=p_id and status='pending';
  if v_leave.id is null then raise exception 'Request not found or already decided'; end if;
  if not can_decide_for(v_leave.employee_id) then raise exception 'Not allowed'; end if;
  v_actor := current_employee_id();

  if p_approve then
    perform ensure_leave_allocations(v_leave.employee_id);
    select coalesce(sum(days),0) into v_avail from leave_ledger where employee_id=v_leave.employee_id;
    v_paid := least(v_leave.days, greatest(v_avail,0));
    v_unpaid := v_leave.days - v_paid;
    v_need := v_paid;
    for r in
      select alloc_month, sum(days) as rem from leave_ledger where employee_id=v_leave.employee_id
      group by alloc_month having sum(days) > 0 order by alloc_month
    loop
      exit when v_need <= 0;
      v_take := least(v_need, r.rem);
      insert into leave_ledger(employee_id, alloc_month, kind, days, leave_request_id, note)
      values (v_leave.employee_id, r.alloc_month, 'consumption', -v_take, p_id, 'Leave approved');
      v_need := v_need - v_take;
    end loop;
    update leave_requests set status='approved', decided_by=v_actor, decided_at=now(),
      paid_days=v_paid, unpaid_days=v_unpaid
    where id=p_id returning * into v_leave;
    perform audit_log('leave_approved', v_leave.employee_id, null,
      jsonb_build_object('paid',v_paid,'unpaid',v_unpaid), 'Leave approved', v_actor);
    if v_paid > 0 then
      perform audit_log('leave_deducted', v_leave.employee_id, null,
        jsonb_build_object('paid',v_paid), 'Ledger consumption (oldest first)', v_actor);
    end if;
    perform queue_push(v_leave.employee_id,'Leave approved',
      'Your leave from '||v_leave.start_date||' to '||v_leave.end_date||' was approved.', '/leave');
  else
    update leave_requests set status='denied', decided_by=v_actor, decided_at=now()
    where id=p_id returning * into v_leave;
    perform audit_log('leave_rejected', v_leave.employee_id, null, null, 'Leave denied', v_actor);
    perform queue_push(v_leave.employee_id,'Leave denied',
      'Your leave request from '||v_leave.start_date||' was denied.', '/leave');
  end if;

  perform recompute_sandwich(v_leave.employee_id, v_leave.start_date, v_leave.end_date);
  perform sync_sandwich_on_requests(v_leave.employee_id);
  select * into v_leave from leave_requests where id = p_id;
  return row_to_json(v_leave);
end $$;


ALTER FUNCTION "public"."decide_leave"("p_id" "uuid", "p_approve" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."decide_session"("p_id" "uuid", "p_approve" boolean) RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_session work_sessions; v_actor uuid; v_total int; v_end timestamptz; v_kind text;
begin
  select * into v_session from work_sessions where id = p_id and status = 'pending_approval';
  if v_session.id is null then raise exception 'Request not found or already decided'; end if;
  if not can_decide_for(v_session.employee_id) then raise exception 'Not allowed'; end if;
  v_actor := current_employee_id();
  v_kind := coalesce(v_session.pending_kind, 'legacy');

  -- Pending CHECK-OUT: the session has been running while awaiting permission.
  if v_session.pending_kind = 'check_out' then
    if p_approve then
      v_end := least(now(), v_session.started_at + interval '12 hours');
      v_total := floor(extract(epoch from (v_end - v_session.started_at)) / 60);
      update work_sessions set
        status = 'completed', pending_kind = null, ended_at = v_end,
        end_out_of_range = true, total_minutes = v_total,
        overtime_minutes = greatest(0, v_total - 540),
        decided_by = v_actor, decided_at = now()
      where id = p_id returning * into v_session;
      perform audit_log('attendance_approved', v_session.employee_id, null,
        jsonb_build_object('event','check_out','distance_m',v_session.end_distance_m,
                           'minutes',v_total,'ended_at',v_end),
        'Off-site check-out approved', v_actor);
      perform queue_push(v_session.employee_id, 'Check-out approved',
        'HR approved your check-out. Your hours have been saved.', '/');
    else
      update work_sessions set status = 'active', pending_kind = null,
        decided_by = v_actor, decided_at = now()
      where id = p_id returning * into v_session;
      perform audit_log('attendance_denied', v_session.employee_id, null,
        jsonb_build_object('event','check_out','distance_m',v_session.end_distance_m),
        'Off-site check-out denied — employee remains clocked in', v_actor);
      perform queue_push(v_session.employee_id, 'Check-out denied',
        'HR denied your check-out. You are still clocked in — check out from the office.', '/');
    end if;
    return row_to_json(v_session);
  end if;

  -- Pending CHECK-IN that was refused by the geofence: clock starts now.
  if v_session.started_at is null then
    if p_approve then
      update work_sessions set status = 'active', started_at = now(),
        pending_kind = null, decided_by = v_actor, decided_at = now()
      where id = p_id returning * into v_session;
      perform audit_log('attendance_approved', v_session.employee_id, null,
        jsonb_build_object('event','check_in','distance_m',v_session.start_distance_m,
                           'requested_at',v_session.requested_at,'started_at',v_session.started_at),
        'Off-site check-in approved — clock started at approval', v_actor);
      perform queue_push(v_session.employee_id, 'Check-in approved',
        'HR approved your check-in. Your timer has started now.', '/');
    else
      update work_sessions set status = 'denied', pending_kind = null,
        decided_by = v_actor, decided_at = now(), total_minutes = 0, overtime_minutes = 0
      where id = p_id returning * into v_session;
      perform audit_log('attendance_denied', v_session.employee_id, null,
        jsonb_build_object('event','check_in','distance_m',v_session.start_distance_m,
                           'requested_at',v_session.requested_at),
        'Off-site check-in denied', v_actor);
      perform queue_push(v_session.employee_id, 'Check-in denied',
        'HR denied your check-in request.', '/');
    end if;
    return row_to_json(v_session);
  end if;

  -- Legacy pending rows that already have a start time.
  if p_approve then
    if v_session.ended_at is not null then
      v_total := floor(extract(epoch from (v_session.ended_at - v_session.started_at)) / 60);
      update work_sessions set status = 'completed', decided_by = v_actor, decided_at = now(),
        total_minutes = v_total, overtime_minutes = greatest(0, v_total - 540)
      where id = p_id returning * into v_session;
    else
      update work_sessions set status = 'active', decided_by = v_actor, decided_at = now()
      where id = p_id returning * into v_session;
    end if;
    perform audit_log('attendance_approved', v_session.employee_id, null,
      jsonb_build_object('event','legacy','distance_m',v_session.start_distance_m),
      'Work session approved', v_actor);
    perform queue_push(v_session.employee_id, 'Location approved',
      'Your work session was approved.', '/');
  else
    update work_sessions set status = 'denied', decided_by = v_actor, decided_at = now(),
      total_minutes = 0, overtime_minutes = 0, ended_at = coalesce(ended_at, now())
    where id = p_id returning * into v_session;
    perform audit_log('attendance_denied', v_session.employee_id, null,
      jsonb_build_object('event','legacy','distance_m',v_session.start_distance_m),
      'Work session denied', v_actor);
    perform queue_push(v_session.employee_id, 'Location denied',
      'Your work session request was denied.', '/');
  end if;
  return row_to_json(v_session);
end $$;


ALTER FUNCTION "public"."decide_session"("p_id" "uuid", "p_approve" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."distance_m"("lat1" double precision, "lng1" double precision, "lat2" double precision, "lng2" double precision) RETURNS double precision
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  select 6371000 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;


ALTER FUNCTION "public"."distance_m"("lat1" double precision, "lng1" double precision, "lat2" double precision, "lng2" double precision) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."end_session"("p_lat" double precision, "p_lng" double precision) RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_emp employees; v_office locations; v_loc locations; v_session work_sessions;
  v_end timestamptz; v_total int; v_dist numeric; v_outside boolean; v_name text;
begin
  select * into v_emp from employees where auth_user_id = auth.uid() and active;
  if v_emp.id is null then raise exception 'Not an active employee'; end if;

  select * into v_session from work_sessions
  where employee_id = v_emp.id and ended_at is null and started_at is not null
    and status in ('active','pending_approval')
  order by started_at desc limit 1;
  if v_session.id is null then raise exception 'No running session to end'; end if;
  if v_session.pending_kind = 'check_out' then
    raise exception 'Your check-out is already waiting for HR permission';
  end if;

  if v_emp.office_id is not null then
    select * into v_office from locations where id = v_emp.office_id;
    v_dist := distance_m(p_lat, p_lng, v_office.lat, v_office.lng);
    v_outside := v_dist > v_office.radius_m;
    v_name := v_office.name;
  else
    select * into v_loc from locations where active and distance_m(p_lat,p_lng,lat,lng) <= radius_m
    order by distance_m(p_lat,p_lng,lat,lng) limit 1;
    v_outside := v_loc.id is null;
    if not v_outside then v_dist := distance_m(p_lat,p_lng,v_loc.lat,v_loc.lng); end if;
    v_name := 'an approved location';
  end if;

  if v_outside then
    -- Refused. Session keeps running until HR permits the check-out.
    update work_sessions set
      pending_kind = 'check_out', requested_at = now(),
      end_lat = p_lat, end_lng = p_lng, end_distance_m = round(v_dist),
      status = 'pending_approval'
    where id = v_session.id returning * into v_session;
    perform audit_log('attendance_blocked', v_emp.id, null,
      jsonb_build_object('event','check_out','lat',p_lat,'lng',p_lng,'distance_m',round(v_dist)),
      'Outside geofence — check-out refused, awaiting HR permission', v_emp.id);
    perform queue_push_approvers(v_emp.id, 'Check-out permission needed',
      v_emp.name || ' (' || v_emp.emp_id || ') tried to check out away from ' || v_name ||
      coalesce(' (about ' || round(v_dist) || ' m).', '.'), '/admin/approvals');
    return row_to_json(v_session);
  end if;

  v_end := least(now(), v_session.started_at + interval '12 hours');
  v_total := floor(extract(epoch from (v_end - v_session.started_at)) / 60);

  update work_sessions set
    ended_at = v_end, end_lat = p_lat, end_lng = p_lng,
    end_location_id = coalesce(v_office.id, v_loc.id), end_distance_m = round(v_dist),
    end_out_of_range = false, pending_kind = null,
    status = 'completed', total_minutes = v_total,
    overtime_minutes = greatest(0, v_total - 540)
  where id = v_session.id returning * into v_session;
  perform audit_log('attendance_marked', v_emp.id, null,
    jsonb_build_object('event','check_out','distance_m',round(v_dist),'minutes',v_total,'inside',true),
    'Check-out inside geofence', v_emp.id);
  return row_to_json(v_session);
end $$;


ALTER FUNCTION "public"."end_session"("p_lat" double precision, "p_lng" double precision) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_leave_allocations"("p_emp" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_alloc numeric; v_carry int;
  v_cur date := date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date;
  v_from date; m date; r record;
begin
  select monthly_leave_alloc, carry_forward_months into v_alloc, v_carry from app_settings where id;
  select max(alloc_month) into v_from from leave_ledger where employee_id = p_emp and kind = 'allocation';
  if v_from is null then v_from := v_cur; else v_from := (v_from + interval '1 month')::date; end if;

  m := v_from;
  while m <= v_cur loop
    if not exists (select 1 from leave_ledger where employee_id=p_emp and kind='allocation' and alloc_month=m) then
      insert into leave_ledger(employee_id, alloc_month, kind, days, note)
      values (p_emp, m, 'allocation', v_alloc, 'Monthly allocation');
      perform audit_log('leave_credited', p_emp, null, jsonb_build_object('month',m,'days',v_alloc), 'Monthly allocation');
    end if;
    m := (m + interval '1 month')::date;
  end loop;

  -- expire buckets beyond the carry-forward window that still hold a positive balance
  for r in
    select alloc_month, sum(days) as remaining from leave_ledger
    where employee_id = p_emp and alloc_month < (v_cur - (v_carry || ' month')::interval)::date
    group by alloc_month having sum(days) > 0
  loop
    insert into leave_ledger(employee_id, alloc_month, kind, days, note)
    values (p_emp, r.alloc_month, 'expiry', -r.remaining, 'Lapsed (beyond carry-forward window)');
    perform audit_log('leave_expired', p_emp, null, jsonb_build_object('month',r.alloc_month,'days',r.remaining), 'Carry-forward window elapsed');
  end loop;
end $$;


ALTER FUNCTION "public"."ensure_leave_allocations"("p_emp" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.employees
    where auth_user_id = auth.uid() and role = 'admin' and active
  );
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_audit"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from employees where auth_user_id = auth.uid() and role = 'audit' and active
  );
$$;


ALTER FUNCTION "public"."is_audit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_team_manager"("p_employee" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from employees t
    join employees a on a.auth_user_id = auth.uid()
    where t.id = p_employee and t.manager_id = a.id
      and a.role = 'manager' and a.active
  );
$$;


ALTER FUNCTION "public"."is_team_manager"("p_employee" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ist_today"() RETURNS "date"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;


ALTER FUNCTION "public"."ist_today"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."leave_status"("p_emp" "uuid" DEFAULT NULL::"uuid") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_emp uuid := coalesce(p_emp, current_employee_id());
  v_cur date := date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date;
  v_prev date := (v_cur - interval '1 month')::date;
  v_cur_days numeric; v_prev_days numeric; v_total numeric;
  v_sw_month numeric; v_sw_total numeric;
begin
  if v_emp is null then raise exception 'No employee'; end if;
  if not (v_emp = current_employee_id() or is_admin() or is_audit() or is_team_manager(v_emp)) then
    raise exception 'Not allowed';
  end if;
  perform ensure_leave_allocations(v_emp);
  select coalesce(sum(days),0) into v_cur_days from leave_ledger where employee_id=v_emp and alloc_month=v_cur;
  select coalesce(sum(days),0) into v_prev_days from leave_ledger where employee_id=v_emp and alloc_month=v_prev;
  select coalesce(sum(days),0) into v_total from leave_ledger where employee_id=v_emp and alloc_month >= v_prev;

  v_sw_month := sandwich_unpaid_days(v_emp, v_cur, (v_cur + interval '1 month - 1 day')::date);
  v_sw_total := sandwich_unpaid_days(v_emp);

  return json_build_object(
    'current_month', v_cur, 'current_days', v_cur_days,
    'carried_days', v_prev_days, 'total_available', v_total,
    'expiring_days', greatest(v_prev_days,0),
    'expiring_on', (v_cur + interval '1 month' - interval '1 day')::date,
    'sandwich_unpaid_month', v_sw_month,
    'sandwich_unpaid_total', v_sw_total
  );
end $$;


ALTER FUNCTION "public"."leave_status"("p_emp" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."monthly_leave_maintenance"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare r record;
begin
  for r in select id from employees where active loop
    perform ensure_leave_allocations(r.id);
  end loop;
end $$;


ALTER FUNCTION "public"."monthly_leave_maintenance"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."queue_push"("p_employee" "uuid", "p_title" "text", "p_body" "text", "p_url" "text" DEFAULT '/'::"text") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  insert into notification_queue (employee_id, title, body, url) values (p_employee, p_title, p_body, p_url);
$$;


ALTER FUNCTION "public"."queue_push"("p_employee" "uuid", "p_title" "text", "p_body" "text", "p_url" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."queue_push_admins"("p_title" "text", "p_body" "text", "p_url" "text" DEFAULT '/admin'::"text") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  insert into notification_queue (employee_id, title, body, url)
  select id, p_title, p_body, p_url from employees where role = 'admin' and active;
$$;


ALTER FUNCTION "public"."queue_push_admins"("p_title" "text", "p_body" "text", "p_url" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."queue_push_approvers"("p_employee" "uuid", "p_title" "text", "p_body" "text", "p_url" "text" DEFAULT '/admin'::"text") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  insert into notification_queue (employee_id, title, body, url)
  select id, p_title, p_body, p_url from employees
  where active and (
    role = 'admin'
    or id = (select manager_id from employees where id = p_employee)
  ) and id <> p_employee;
$$;


ALTER FUNCTION "public"."queue_push_approvers"("p_employee" "uuid", "p_title" "text", "p_body" "text", "p_url" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recompute_sandwich"("p_emp" "uuid", "p_from" "date", "p_to" "date") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_enabled bool; s date; sat date; mon date; sat_id uuid; mon_id uuid; existing uuid;
begin
  select sandwich_enabled into v_enabled from app_settings where id;
  for s in select d::date from generate_series(p_from - 2, p_to + 2, interval '1 day') d where extract(dow from d) = 0 loop
    sat := s - 1; mon := s + 1;
    select id into sat_id from leave_requests where employee_id=p_emp and status='approved' and sat between start_date and end_date limit 1;
    select id into mon_id from leave_requests where employee_id=p_emp and status='approved' and mon between start_date and end_date limit 1;
    select id into existing from sandwich_leaves where employee_id=p_emp and sunday_date=s;
    if v_enabled and sat_id is not null and mon_id is not null then
      if existing is null then
        insert into sandwich_leaves(employee_id, sunday_date, sat_request_id, mon_request_id, unpaid_days)
        values (p_emp, s, sat_id, mon_id, 1);
        perform audit_log('sandwich_applied', p_emp, null,
          jsonb_build_object('sunday', s, 'unpaid_days', 1),
          'Sat+Mon leave — Sunday charged as 1 unpaid day');
      else
        update sandwich_leaves set sat_request_id=sat_id, mon_request_id=mon_id, unpaid_days=1 where id=existing;
      end if;
    elsif existing is not null then
      delete from sandwich_leaves where id=existing;
      perform audit_log('sandwich_removed', p_emp, null,
        jsonb_build_object('sunday', s, 'unpaid_days_reversed', 1),
        'Condition no longer met — unpaid Sunday reversed');
    end if;
  end loop;
end $$;


ALTER FUNCTION "public"."recompute_sandwich"("p_emp" "uuid", "p_from" "date", "p_to" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sandwich_unpaid_days"("p_emp" "uuid", "p_from" "date" DEFAULT NULL::"date", "p_to" "date" DEFAULT NULL::"date") RETURNS numeric
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(sum(unpaid_days), 0)
  from sandwich_leaves
  where employee_id = p_emp
    and (p_from is null or sunday_date >= p_from)
    and (p_to   is null or sunday_date <= p_to);
$$;


ALTER FUNCTION "public"."sandwich_unpaid_days"("p_emp" "uuid", "p_from" "date", "p_to" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."session_maintenance"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  r record;
begin
  for r in
    select ws.id, ws.employee_id from work_sessions ws
    where ws.started_at is not null and ws.ended_at is null and not ws.warned_11h
      and (ws.status = 'active' or ws.pending_kind = 'check_out')
      and now() >= ws.started_at + interval '11 hours'
  loop
    update work_sessions set warned_11h = true where id = r.id;
    perform queue_push(r.employee_id, 'Still working?',
      'You have been logged in for 11 hours. Your session auto-closes at 12 hours.', '/');
  end loop;

  for r in
    select ws.id, ws.employee_id, ws.pending_kind, e.name, e.emp_id from work_sessions ws
    join employees e on e.id = ws.employee_id
    where ws.started_at is not null and ws.ended_at is null
      and (ws.status = 'active' or ws.pending_kind = 'check_out')
      and now() >= ws.started_at + interval '12 hours'
  loop
    update work_sessions set status = 'auto_closed', pending_kind = null,
      ended_at = started_at + interval '12 hours',
      total_minutes = 720, overtime_minutes = 180
    where id = r.id;
    perform queue_push(r.employee_id, 'Session auto-closed',
      'Your work session was automatically closed after 12 hours.', '/');
    perform queue_push_admins('Session auto-closed',
      r.name || ' (' || r.emp_id || ') hit the 12-hour limit; session auto-closed'
      || case when r.pending_kind = 'check_out' then ' while their check-out was still awaiting permission.' else '.' end,
      '/admin/attendance');
  end loop;

  if exists (select 1 from notification_queue where sent_at is null and attempts < 5) then
    perform net.http_post(
      url := 'https://pbxtegggoifdzdvcatfq.supabase.co/functions/v1/process-notifications',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBieHRlZ2dnb2lmZHpkdmNhdGZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2OTI5NTIsImV4cCI6MjA5OTI2ODk1Mn0.LEPRvi9Bk7Q619nvkWH2YdoHxKXYPU47YjBjL4Bm5Go'),
      body := '{}'::jsonb
    );
  end if;
end $$;


ALTER FUNCTION "public"."session_maintenance"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."start_session"("p_lat" double precision, "p_lng" double precision) RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_emp employees; v_office locations; v_loc locations; v_dist numeric; v_session work_sessions;
begin
  select * into v_emp from employees where auth_user_id = auth.uid() and active;
  if v_emp.id is null then raise exception 'Not an active employee'; end if;
  if exists (select 1 from work_sessions where employee_id = v_emp.id and work_date = (now() at time zone 'Asia/Kolkata')::date) then
    raise exception 'You have already logged a session today';
  end if;

  if v_emp.office_id is not null then
    select * into v_office from locations where id = v_emp.office_id and active;
    if v_office.id is null then raise exception 'Your assigned office is inactive. Contact your admin.'; end if;
    v_dist := distance_m(p_lat, p_lng, v_office.lat, v_office.lng);

    if v_dist > v_office.radius_m then
      -- Refused. Record where/when they pressed it; clock starts only on approval.
      insert into work_sessions (employee_id, work_date, started_at, requested_at, pending_kind,
                                 start_lat, start_lng, start_distance_m, status)
      values (v_emp.id, (now() at time zone 'Asia/Kolkata')::date, null, now(), 'check_in',
              p_lat, p_lng, round(v_dist), 'pending_approval')
      returning * into v_session;
      perform audit_log('attendance_blocked', v_emp.id, null,
        jsonb_build_object('event','check_in','lat',p_lat,'lng',p_lng,'distance_m',round(v_dist),
                           'radius_m',v_office.radius_m,'office',v_office.name),
        'Outside office geofence — check-in refused, awaiting HR permission', v_emp.id);
      perform queue_push_approvers(v_emp.id, 'Check-in permission needed',
        v_emp.name || ' (' || v_emp.emp_id || ') tried to check in about ' || round(v_dist) ||
        ' m from ' || v_office.name || ' (limit ' || v_office.radius_m || ' m).', '/admin/approvals');
      return row_to_json(v_session);
    end if;

    insert into work_sessions (employee_id, work_date, started_at, start_lat, start_lng, start_location_id, start_distance_m, status)
    values (v_emp.id, (now() at time zone 'Asia/Kolkata')::date, now(), p_lat, p_lng, v_office.id, round(v_dist), 'active')
    returning * into v_session;
    perform audit_log('attendance_marked', v_emp.id, null,
      jsonb_build_object('event','check_in','distance_m',round(v_dist),'office',v_office.name,'inside',true),
      'Check-in inside geofence', v_emp.id);
  else
    select * into v_loc from locations where active order by distance_m(p_lat,p_lng,lat,lng) limit 1;
    if v_loc.id is not null then v_dist := distance_m(p_lat,p_lng,v_loc.lat,v_loc.lng); end if;
    if v_loc.id is not null and v_dist <= v_loc.radius_m then
      insert into work_sessions (employee_id, work_date, started_at, start_lat, start_lng, start_location_id, start_distance_m, status)
      values (v_emp.id, (now() at time zone 'Asia/Kolkata')::date, now(), p_lat, p_lng, v_loc.id, round(v_dist), 'active')
      returning * into v_session;
      perform audit_log('attendance_marked', v_emp.id, null,
        jsonb_build_object('event','check_in','distance_m',round(v_dist),'location',v_loc.name,'inside',true), 'Check-in at approved location', v_emp.id);
    else
      insert into work_sessions (employee_id, work_date, started_at, requested_at, pending_kind,
                                 start_lat, start_lng, start_distance_m, status)
      values (v_emp.id, (now() at time zone 'Asia/Kolkata')::date, null, now(), 'check_in',
              p_lat, p_lng, round(v_dist), 'pending_approval')
      returning * into v_session;
      perform audit_log('attendance_blocked', v_emp.id, null,
        jsonb_build_object('event','check_in','distance_m',round(v_dist)), 'Unlisted location — check-in refused, awaiting HR permission', v_emp.id);
      perform queue_push_approvers(v_emp.id, 'Check-in permission needed',
        v_emp.name || ' (' || v_emp.emp_id || ') tried to check in at an unlisted location.', '/admin/approvals');
    end if;
  end if;
  return row_to_json(v_session);
end $$;


ALTER FUNCTION "public"."start_session"("p_lat" double precision, "p_lng" double precision) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_sandwich_on_requests"("p_emp" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare r record; v_extra numeric;
begin
  -- reset every approved request to its base (working-day) cost
  for r in
    select lr.id, lr.start_date, lr.end_date, lr.day_part, lr.paid_days
    from leave_requests lr
    where lr.employee_id = p_emp and lr.status = 'approved'
  loop
    select coalesce(sum(sl.unpaid_days),0) into v_extra
    from sandwich_leaves sl
    where sl.employee_id = p_emp
      and sl.sat_request_id = r.id;

    update leave_requests
       set days = case when day_part <> 'full' then 0.5
                       else working_days(start_date, end_date) end + v_extra,
           unpaid_days = greatest(
             (case when day_part <> 'full' then 0.5
                   else working_days(start_date, end_date) end) - coalesce(r.paid_days,0), 0) + v_extra
     where id = r.id;
  end loop;
end $$;


ALTER FUNCTION "public"."sync_sandwich_on_requests"("p_emp" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."team_status"() RETURNS TABLE("name" "text", "emp_id" "text", "status" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with me as (
    select id, department, manager_id from employees where auth_user_id = auth.uid()
  )
  select e.name, e.emp_id,
    case
      when exists (
        select 1 from work_sessions ws where ws.employee_id = e.id
          and ws.work_date = (now() at time zone 'Asia/Kolkata')::date and ws.status = 'active'
      ) then 'working'
      when exists (
        select 1 from leave_requests lr where lr.employee_id = e.id and lr.status = 'approved'
          and (now() at time zone 'Asia/Kolkata')::date between lr.start_date and lr.end_date
      ) then 'on leave'
      when exists (
        select 1 from work_sessions ws where ws.employee_id = e.id
          and ws.work_date = (now() at time zone 'Asia/Kolkata')::date
          and ws.status in ('completed','auto_closed')
      ) then 'done today'
      else 'off'
    end as status
  from employees e cross join me
  where e.active and e.id <> me.id
    and (
      (me.department is not null and e.department = me.department)
      or (me.manager_id is not null and e.manager_id = me.manager_id)
      or e.id = me.manager_id
    )
  order by e.name;
$$;


ALTER FUNCTION "public"."team_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."working_days"("p_start" "date", "p_end" "date") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select count(*)::int from generate_series(p_start, p_end, interval '1 day') d
  where extract(dow from d) <> 0
    and not exists (select 1 from holidays h where h.holiday_date = d::date);
$$;


ALTER FUNCTION "public"."working_days"("p_start" "date", "p_end" "date") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."app_secrets" (
    "key" "text" NOT NULL,
    "value" "text" NOT NULL
);


ALTER TABLE "public"."app_secrets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_settings" (
    "id" boolean DEFAULT true NOT NULL,
    "shift_start" time without time zone DEFAULT '09:00:00'::time without time zone NOT NULL,
    "shift_end" time without time zone DEFAULT '18:00:00'::time without time zone NOT NULL,
    "late_grace_min" integer DEFAULT 15 NOT NULL,
    "early_departure_grace_min" integer DEFAULT 15 NOT NULL,
    "monthly_leave_alloc" numeric DEFAULT 2 NOT NULL,
    "carry_forward_months" integer DEFAULT 1 NOT NULL,
    "sandwich_enabled" boolean DEFAULT true NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "app_settings_id_check" CHECK ("id")
);


ALTER TABLE "public"."app_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "action" "text" NOT NULL,
    "employee_id" "uuid",
    "performed_by" "uuid",
    "old_value" "jsonb",
    "new_value" "jsonb",
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."employees" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "emp_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "contact" "text",
    "role" "text" DEFAULT 'employee'::"text" NOT NULL,
    "auth_user_id" "uuid",
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "department" "text",
    "manager_id" "uuid",
    "office_id" "uuid",
    CONSTRAINT "employees_role_check" CHECK (("role" = ANY (ARRAY['employee'::"text", 'manager'::"text", 'admin'::"text", 'audit'::"text"])))
);


ALTER TABLE "public"."employees" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."holidays" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "holiday_date" "date" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."holidays" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."leave_balances" (
    "employee_id" "uuid" NOT NULL,
    "year" integer NOT NULL,
    "quota" numeric(5,1) DEFAULT 12 NOT NULL,
    "used" numeric(5,1) DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."leave_balances" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."leave_ledger" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "alloc_month" "date" NOT NULL,
    "kind" "text" NOT NULL,
    "days" numeric NOT NULL,
    "leave_request_id" "uuid",
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "leave_ledger_kind_check" CHECK (("kind" = ANY (ARRAY['allocation'::"text", 'consumption'::"text", 'expiry'::"text", 'adjustment'::"text"])))
);


ALTER TABLE "public"."leave_ledger" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."leave_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "day_part" "text" DEFAULT 'full'::"text" NOT NULL,
    "days" numeric(5,1) NOT NULL,
    "reason" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "decided_by" "uuid",
    "decided_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "paid_days" numeric DEFAULT 0 NOT NULL,
    "unpaid_days" numeric DEFAULT 0 NOT NULL,
    CONSTRAINT "leave_requests_check" CHECK (("end_date" >= "start_date")),
    CONSTRAINT "leave_requests_day_part_check" CHECK (("day_part" = ANY (ARRAY['full'::"text", 'first_half'::"text", 'second_half'::"text"]))),
    CONSTRAINT "leave_requests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'denied'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."leave_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."locations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "lat" double precision NOT NULL,
    "lng" double precision NOT NULL,
    "radius_m" integer DEFAULT 200 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "address" "text"
);


ALTER TABLE "public"."locations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notification_queue" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text" NOT NULL,
    "url" "text" DEFAULT '/'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sent_at" timestamp with time zone,
    "attempts" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."notification_queue" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."push_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "endpoint" "text" NOT NULL,
    "p256dh" "text" NOT NULL,
    "auth" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."push_subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sandwich_leaves" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "sunday_date" "date" NOT NULL,
    "sat_request_id" "uuid",
    "mon_request_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "unpaid_days" numeric DEFAULT 1 NOT NULL
);


ALTER TABLE "public"."sandwich_leaves" OWNER TO "postgres";


COMMENT ON COLUMN "public"."sandwich_leaves"."unpaid_days" IS 'Unpaid days charged for this Sunday. Always 1 — a sandwich Sunday never consumes paid balance.';



CREATE TABLE IF NOT EXISTS "public"."work_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "work_date" "date" NOT NULL,
    "started_at" timestamp with time zone,
    "ended_at" timestamp with time zone,
    "start_lat" double precision NOT NULL,
    "start_lng" double precision NOT NULL,
    "end_lat" double precision,
    "end_lng" double precision,
    "start_location_id" "uuid",
    "end_location_id" "uuid",
    "end_out_of_range" boolean DEFAULT false NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "decided_by" "uuid",
    "decided_at" timestamp with time zone,
    "warned_11h" boolean DEFAULT false NOT NULL,
    "total_minutes" integer,
    "overtime_minutes" integer,
    "start_distance_m" numeric,
    "end_distance_m" numeric,
    "requested_at" timestamp with time zone,
    "pending_kind" "text",
    CONSTRAINT "work_sessions_pending_kind_check" CHECK (("pending_kind" = ANY (ARRAY['check_in'::"text", 'check_out'::"text"]))),
    CONSTRAINT "work_sessions_status_check" CHECK (("status" = ANY (ARRAY['pending_approval'::"text", 'active'::"text", 'completed'::"text", 'auto_closed'::"text", 'denied'::"text"])))
);


ALTER TABLE "public"."work_sessions" OWNER TO "postgres";


COMMENT ON COLUMN "public"."work_sessions"."requested_at" IS 'When the employee pressed a button that was refused by the geofence. The clock itself starts/stops at HR approval, not here.';



COMMENT ON COLUMN "public"."work_sessions"."pending_kind" IS 'Which action is awaiting HR permission: check_in (started_at still null) or check_out (session still running).';



ALTER TABLE ONLY "public"."app_secrets"
    ADD CONSTRAINT "app_secrets_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."app_settings"
    ADD CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_auth_user_id_key" UNIQUE ("auth_user_id");



ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_emp_id_key" UNIQUE ("emp_id");



ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."holidays"
    ADD CONSTRAINT "holidays_holiday_date_key" UNIQUE ("holiday_date");



ALTER TABLE ONLY "public"."holidays"
    ADD CONSTRAINT "holidays_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leave_balances"
    ADD CONSTRAINT "leave_balances_pkey" PRIMARY KEY ("employee_id", "year");



ALTER TABLE ONLY "public"."leave_ledger"
    ADD CONSTRAINT "leave_ledger_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leave_requests"
    ADD CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."locations"
    ADD CONSTRAINT "locations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_queue"
    ADD CONSTRAINT "notification_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_endpoint_key" UNIQUE ("endpoint");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sandwich_leaves"
    ADD CONSTRAINT "sandwich_leaves_employee_id_sunday_date_key" UNIQUE ("employee_id", "sunday_date");



ALTER TABLE ONLY "public"."sandwich_leaves"
    ADD CONSTRAINT "sandwich_leaves_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."work_sessions"
    ADD CONSTRAINT "work_sessions_employee_id_work_date_key" UNIQUE ("employee_id", "work_date");



ALTER TABLE ONLY "public"."work_sessions"
    ADD CONSTRAINT "work_sessions_pkey" PRIMARY KEY ("id");



CREATE INDEX "audit_logs_created" ON "public"."audit_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "audit_logs_employee" ON "public"."audit_logs" USING "btree" ("employee_id");



CREATE INDEX "leave_ledger_emp_month" ON "public"."leave_ledger" USING "btree" ("employee_id", "alloc_month");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "public"."employees"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "public"."employees"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_office_id_fkey" FOREIGN KEY ("office_id") REFERENCES "public"."locations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."leave_balances"
    ADD CONSTRAINT "leave_balances_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."leave_ledger"
    ADD CONSTRAINT "leave_ledger_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."leave_ledger"
    ADD CONSTRAINT "leave_ledger_leave_request_id_fkey" FOREIGN KEY ("leave_request_id") REFERENCES "public"."leave_requests"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."leave_requests"
    ADD CONSTRAINT "leave_requests_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "public"."employees"("id");



ALTER TABLE ONLY "public"."leave_requests"
    ADD CONSTRAINT "leave_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_queue"
    ADD CONSTRAINT "notification_queue_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sandwich_leaves"
    ADD CONSTRAINT "sandwich_leaves_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sandwich_leaves"
    ADD CONSTRAINT "sandwich_leaves_mon_request_id_fkey" FOREIGN KEY ("mon_request_id") REFERENCES "public"."leave_requests"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sandwich_leaves"
    ADD CONSTRAINT "sandwich_leaves_sat_request_id_fkey" FOREIGN KEY ("sat_request_id") REFERENCES "public"."leave_requests"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."work_sessions"
    ADD CONSTRAINT "work_sessions_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "public"."employees"("id");



ALTER TABLE ONLY "public"."work_sessions"
    ADD CONSTRAINT "work_sessions_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."work_sessions"
    ADD CONSTRAINT "work_sessions_end_location_id_fkey" FOREIGN KEY ("end_location_id") REFERENCES "public"."locations"("id");



ALTER TABLE ONLY "public"."work_sessions"
    ADD CONSTRAINT "work_sessions_start_location_id_fkey" FOREIGN KEY ("start_location_id") REFERENCES "public"."locations"("id");



CREATE POLICY "admin delete" ON "public"."holidays" FOR DELETE USING ("public"."is_admin"());



CREATE POLICY "admin insert" ON "public"."employees" FOR INSERT WITH CHECK ("public"."is_admin"());



CREATE POLICY "admin insert" ON "public"."holidays" FOR INSERT WITH CHECK ("public"."is_admin"());



CREATE POLICY "admin insert" ON "public"."leave_balances" FOR INSERT WITH CHECK ("public"."is_admin"());



CREATE POLICY "admin insert" ON "public"."locations" FOR INSERT WITH CHECK ("public"."is_admin"());



CREATE POLICY "admin update" ON "public"."employees" FOR UPDATE USING ("public"."is_admin"());



CREATE POLICY "admin update" ON "public"."holidays" FOR UPDATE USING ("public"."is_admin"());



CREATE POLICY "admin update" ON "public"."leave_balances" FOR UPDATE USING ("public"."is_admin"());



CREATE POLICY "admin update" ON "public"."locations" FOR UPDATE USING ("public"."is_admin"());



CREATE POLICY "admin write" ON "public"."app_settings" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "admin/audit read" ON "public"."audit_logs" FOR SELECT USING (("public"."is_admin"() OR "public"."is_audit"()));



ALTER TABLE "public"."app_secrets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."app_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "authenticated read" ON "public"."app_settings" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "authenticated read" ON "public"."holidays" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "authenticated read" ON "public"."locations" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "delete own" ON "public"."push_subscriptions" FOR DELETE USING (("employee_id" = "public"."current_employee_id"()));



ALTER TABLE "public"."employees" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."holidays" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "insert own" ON "public"."push_subscriptions" FOR INSERT WITH CHECK (("employee_id" = "public"."current_employee_id"()));



ALTER TABLE "public"."leave_balances" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."leave_ledger" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."leave_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."locations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notification_queue" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."push_subscriptions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "read own" ON "public"."push_subscriptions" FOR SELECT USING (("employee_id" = "public"."current_employee_id"()));



CREATE POLICY "read own or admin/audit" ON "public"."leave_ledger" FOR SELECT USING ((("employee_id" = "public"."current_employee_id"()) OR "public"."is_admin"() OR "public"."is_audit"()));



CREATE POLICY "read own or admin/audit" ON "public"."sandwich_leaves" FOR SELECT USING ((("employee_id" = "public"."current_employee_id"()) OR "public"."is_admin"() OR "public"."is_audit"()));



CREATE POLICY "read own, team, admin, or audit" ON "public"."employees" FOR SELECT USING ((("auth_user_id" = "auth"."uid"()) OR "public"."is_admin"() OR "public"."is_audit"() OR ("manager_id" = "public"."current_employee_id"())));



CREATE POLICY "read own, team, admin, or audit" ON "public"."leave_balances" FOR SELECT USING ((("employee_id" = "public"."current_employee_id"()) OR "public"."is_admin"() OR "public"."is_audit"() OR "public"."is_team_manager"("employee_id")));



CREATE POLICY "read own, team, admin, or audit" ON "public"."leave_requests" FOR SELECT USING ((("employee_id" = "public"."current_employee_id"()) OR "public"."is_admin"() OR "public"."is_audit"() OR "public"."is_team_manager"("employee_id")));



CREATE POLICY "read own, team, admin, or audit" ON "public"."work_sessions" FOR SELECT USING ((("employee_id" = "public"."current_employee_id"()) OR "public"."is_admin"() OR "public"."is_audit"() OR "public"."is_team_manager"("employee_id")));



ALTER TABLE "public"."sandwich_leaves" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."work_sessions" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."apply_leave"("p_start" "date", "p_end" "date", "p_day_part" "text", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_leave"("p_start" "date", "p_end" "date", "p_day_part" "text", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_leave"("p_start" "date", "p_end" "date", "p_day_part" "text", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."audit_log"("p_action" "text", "p_employee" "uuid", "p_old" "jsonb", "p_new" "jsonb", "p_reason" "text", "p_actor" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."audit_log"("p_action" "text", "p_employee" "uuid", "p_old" "jsonb", "p_new" "jsonb", "p_reason" "text", "p_actor" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_decide_for"("p_employee" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_decide_for"("p_employee" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cancel_leave"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_leave"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_leave"("p_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_employee_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_employee_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_employee_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."decide_leave"("p_id" "uuid", "p_approve" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."decide_leave"("p_id" "uuid", "p_approve" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."decide_leave"("p_id" "uuid", "p_approve" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."decide_session"("p_id" "uuid", "p_approve" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."decide_session"("p_id" "uuid", "p_approve" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."decide_session"("p_id" "uuid", "p_approve" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."distance_m"("lat1" double precision, "lng1" double precision, "lat2" double precision, "lng2" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."distance_m"("lat1" double precision, "lng1" double precision, "lat2" double precision, "lng2" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."distance_m"("lat1" double precision, "lng1" double precision, "lat2" double precision, "lng2" double precision) TO "service_role";



REVOKE ALL ON FUNCTION "public"."end_session"("p_lat" double precision, "p_lng" double precision) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."end_session"("p_lat" double precision, "p_lng" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."end_session"("p_lat" double precision, "p_lng" double precision) TO "service_role";



REVOKE ALL ON FUNCTION "public"."ensure_leave_allocations"("p_emp" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ensure_leave_allocations"("p_emp" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_audit"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_audit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_audit"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_team_manager"("p_employee" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_team_manager"("p_employee" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_team_manager"("p_employee" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."ist_today"() TO "anon";
GRANT ALL ON FUNCTION "public"."ist_today"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ist_today"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."leave_status"("p_emp" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."leave_status"("p_emp" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."leave_status"("p_emp" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."monthly_leave_maintenance"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."monthly_leave_maintenance"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."queue_push"("p_employee" "uuid", "p_title" "text", "p_body" "text", "p_url" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."queue_push"("p_employee" "uuid", "p_title" "text", "p_body" "text", "p_url" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."queue_push_admins"("p_title" "text", "p_body" "text", "p_url" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."queue_push_admins"("p_title" "text", "p_body" "text", "p_url" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."queue_push_approvers"("p_employee" "uuid", "p_title" "text", "p_body" "text", "p_url" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."queue_push_approvers"("p_employee" "uuid", "p_title" "text", "p_body" "text", "p_url" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."queue_push_approvers"("p_employee" "uuid", "p_title" "text", "p_body" "text", "p_url" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."recompute_sandwich"("p_emp" "uuid", "p_from" "date", "p_to" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."recompute_sandwich"("p_emp" "uuid", "p_from" "date", "p_to" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."sandwich_unpaid_days"("p_emp" "uuid", "p_from" "date", "p_to" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."sandwich_unpaid_days"("p_emp" "uuid", "p_from" "date", "p_to" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sandwich_unpaid_days"("p_emp" "uuid", "p_from" "date", "p_to" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."session_maintenance"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."session_maintenance"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."start_session"("p_lat" double precision, "p_lng" double precision) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."start_session"("p_lat" double precision, "p_lng" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."start_session"("p_lat" double precision, "p_lng" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_sandwich_on_requests"("p_emp" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."sync_sandwich_on_requests"("p_emp" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_sandwich_on_requests"("p_emp" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."team_status"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."team_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."team_status"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."working_days"("p_start" "date", "p_end" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."working_days"("p_start" "date", "p_end" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."working_days"("p_start" "date", "p_end" "date") TO "service_role";



GRANT ALL ON TABLE "public"."app_secrets" TO "anon";
GRANT ALL ON TABLE "public"."app_secrets" TO "authenticated";
GRANT ALL ON TABLE "public"."app_secrets" TO "service_role";



GRANT ALL ON TABLE "public"."app_settings" TO "anon";
GRANT ALL ON TABLE "public"."app_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."app_settings" TO "service_role";



GRANT ALL ON TABLE "public"."audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."employees" TO "anon";
GRANT ALL ON TABLE "public"."employees" TO "authenticated";
GRANT ALL ON TABLE "public"."employees" TO "service_role";



GRANT ALL ON TABLE "public"."holidays" TO "anon";
GRANT ALL ON TABLE "public"."holidays" TO "authenticated";
GRANT ALL ON TABLE "public"."holidays" TO "service_role";



GRANT ALL ON TABLE "public"."leave_balances" TO "anon";
GRANT ALL ON TABLE "public"."leave_balances" TO "authenticated";
GRANT ALL ON TABLE "public"."leave_balances" TO "service_role";



GRANT ALL ON TABLE "public"."leave_ledger" TO "anon";
GRANT ALL ON TABLE "public"."leave_ledger" TO "authenticated";
GRANT ALL ON TABLE "public"."leave_ledger" TO "service_role";



GRANT ALL ON TABLE "public"."leave_requests" TO "anon";
GRANT ALL ON TABLE "public"."leave_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."leave_requests" TO "service_role";



GRANT ALL ON TABLE "public"."locations" TO "anon";
GRANT ALL ON TABLE "public"."locations" TO "authenticated";
GRANT ALL ON TABLE "public"."locations" TO "service_role";



GRANT ALL ON TABLE "public"."notification_queue" TO "anon";
GRANT ALL ON TABLE "public"."notification_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_queue" TO "service_role";



GRANT ALL ON TABLE "public"."push_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."sandwich_leaves" TO "anon";
GRANT ALL ON TABLE "public"."sandwich_leaves" TO "authenticated";
GRANT ALL ON TABLE "public"."sandwich_leaves" TO "service_role";



GRANT ALL ON TABLE "public"."work_sessions" TO "anon";
GRANT ALL ON TABLE "public"."work_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."work_sessions" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







