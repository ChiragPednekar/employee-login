-- A denied off-site check-in used to consume the employee's whole day: the
-- (employee_id, work_date) unique index meant they could not check in again even
-- standing inside the office, so an HR denial cost them a full day's attendance.
-- Today's row is now reusable when it was denied; the denial itself stays in
-- audit_logs, and a retry is logged too.
create or replace function public.start_session(p_lat double precision, p_lng double precision)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_emp employees; v_near record; v_session work_sessions; v_today work_sessions;
  v_where text; v_date date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select * into v_emp from employees where auth_user_id = auth.uid() and active;
  if v_emp.id is null then raise exception 'Not an active employee'; end if;

  select * into v_today from work_sessions
  where employee_id = v_emp.id and work_date = v_date;

  if v_today.id is not null and v_today.status <> 'denied' then
    raise exception 'You have already logged a session today';
  end if;

  if has_location_assignment(v_emp.id) and not exists (select 1 from allowed_locations(v_emp.id)) then
    raise exception 'Your assigned work locations are inactive. Contact your admin.';
  end if;

  select * into v_near from nearest_allowed_location(v_emp.id, p_lat, p_lng);

  if v_today.id is not null then
    perform audit_log('attendance_retry', v_emp.id, null,
      jsonb_build_object('previous','denied','distance_m',round(v_near.dist)),
      'Retrying check-in after an earlier denial today', v_emp.id);
  end if;

  -- Inside the radius of a site this employee is cleared for.
  if v_near.id is not null and v_near.dist <= v_near.radius_m then
    if v_today.id is null then
      insert into work_sessions (employee_id, work_date, started_at, start_lat, start_lng,
                                 start_location_id, start_distance_m, status)
      values (v_emp.id, v_date, now(), p_lat, p_lng, v_near.id, round(v_near.dist), 'active')
      returning * into v_session;
    else
      update work_sessions set
        started_at = now(), requested_at = null, pending_kind = null,
        start_lat = p_lat, start_lng = p_lng, start_location_id = v_near.id,
        start_distance_m = round(v_near.dist), status = 'active',
        ended_at = null, end_lat = null, end_lng = null, end_location_id = null,
        end_distance_m = null, end_out_of_range = false, total_minutes = null,
        overtime_minutes = null, warned_11h = false, decided_by = null, decided_at = null
      where id = v_today.id returning * into v_session;
    end if;
    perform audit_log('attendance_marked', v_emp.id, null,
      jsonb_build_object('event','check_in','distance_m',round(v_near.dist),
                         'location',v_near.name,'inside',true),
      'Check-in inside geofence', v_emp.id);
    return row_to_json(v_session);
  end if;

  -- Refused. Record where/when they pressed it; clock starts only on approval.
  if v_today.id is null then
    insert into work_sessions (employee_id, work_date, started_at, requested_at, pending_kind,
                               start_lat, start_lng, start_distance_m, status)
    values (v_emp.id, v_date, null, now(), 'check_in',
            p_lat, p_lng, round(v_near.dist), 'pending_approval')
    returning * into v_session;
  else
    update work_sessions set
      started_at = null, requested_at = now(), pending_kind = 'check_in',
      start_lat = p_lat, start_lng = p_lng, start_location_id = null,
      start_distance_m = round(v_near.dist), status = 'pending_approval',
      ended_at = null, end_lat = null, end_lng = null, end_location_id = null,
      end_distance_m = null, end_out_of_range = false, total_minutes = null,
      overtime_minutes = null, warned_11h = false, decided_by = null, decided_at = null
    where id = v_today.id returning * into v_session;
  end if;

  v_where := case when v_near.id is null then 'an unlisted location'
                  else 'about ' || round(v_near.dist) || ' m from ' || v_near.name ||
                       ' (limit ' || v_near.radius_m || ' m)' end;
  perform audit_log('attendance_blocked', v_emp.id, null,
    jsonb_build_object('event','check_in','lat',p_lat,'lng',p_lng,
                       'distance_m',round(v_near.dist),'radius_m',v_near.radius_m,
                       'nearest',v_near.name),
    'Outside every approved geofence — check-in refused, awaiting HR permission', v_emp.id);
  perform queue_push_approvers(v_emp.id, 'Check-in permission needed',
    v_emp.name || ' (' || v_emp.emp_id || ') tried to check in ' || v_where || '.',
    '/admin/approvals');
  return row_to_json(v_session);
end $function$;
