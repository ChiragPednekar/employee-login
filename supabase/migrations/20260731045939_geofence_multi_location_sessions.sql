-- Has the admin restricted this employee to specific sites at all?
create or replace function public.has_location_assignment(p_emp uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (select 1 from employees e where e.id = p_emp and e.office_id is not null)
      or exists (select 1 from employee_locations el where el.employee_id = p_emp);
$$;

revoke execute on function public.has_location_assignment(uuid) from anon;
grant execute on function public.has_location_assignment(uuid) to authenticated;

create or replace function public.start_session(p_lat double precision, p_lng double precision)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_emp employees; v_near record; v_session work_sessions; v_where text;
begin
  select * into v_emp from employees where auth_user_id = auth.uid() and active;
  if v_emp.id is null then raise exception 'Not an active employee'; end if;
  if exists (select 1 from work_sessions where employee_id = v_emp.id and work_date = (now() at time zone 'Asia/Kolkata')::date) then
    raise exception 'You have already logged a session today';
  end if;

  if has_location_assignment(v_emp.id) and not exists (select 1 from allowed_locations(v_emp.id)) then
    raise exception 'Your assigned work locations are inactive. Contact your admin.';
  end if;

  select * into v_near from nearest_allowed_location(v_emp.id, p_lat, p_lng);

  -- Inside the radius of a site this employee is cleared for.
  if v_near.id is not null and v_near.dist <= v_near.radius_m then
    insert into work_sessions (employee_id, work_date, started_at, start_lat, start_lng,
                               start_location_id, start_distance_m, status)
    values (v_emp.id, (now() at time zone 'Asia/Kolkata')::date, now(), p_lat, p_lng,
            v_near.id, round(v_near.dist), 'active')
    returning * into v_session;
    perform audit_log('attendance_marked', v_emp.id, null,
      jsonb_build_object('event','check_in','distance_m',round(v_near.dist),
                         'location',v_near.name,'inside',true),
      'Check-in inside geofence', v_emp.id);
    return row_to_json(v_session);
  end if;

  -- Refused. Record where/when they pressed it; clock starts only on approval.
  insert into work_sessions (employee_id, work_date, started_at, requested_at, pending_kind,
                             start_lat, start_lng, start_distance_m, status)
  values (v_emp.id, (now() at time zone 'Asia/Kolkata')::date, null, now(), 'check_in',
          p_lat, p_lng, round(v_near.dist), 'pending_approval')
  returning * into v_session;

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

create or replace function public.end_session(p_lat double precision, p_lng double precision)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_emp employees; v_near record; v_session work_sessions;
  v_end timestamptz; v_total int; v_where text;
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

  select * into v_near from nearest_allowed_location(v_emp.id, p_lat, p_lng);

  if v_near.id is null or v_near.dist > v_near.radius_m then
    -- Refused. Session keeps running until HR permits the check-out.
    update work_sessions set
      pending_kind = 'check_out', requested_at = now(),
      end_lat = p_lat, end_lng = p_lng, end_distance_m = round(v_near.dist),
      status = 'pending_approval'
    where id = v_session.id returning * into v_session;
    perform audit_log('attendance_blocked', v_emp.id, null,
      jsonb_build_object('event','check_out','lat',p_lat,'lng',p_lng,
                         'distance_m',round(v_near.dist),'nearest',v_near.name),
      'Outside every approved geofence — check-out refused, awaiting HR permission', v_emp.id);
    v_where := case when v_near.id is null then 'an unlisted location'
                    else 'about ' || round(v_near.dist) || ' m from ' || v_near.name end;
    perform queue_push_approvers(v_emp.id, 'Check-out permission needed',
      v_emp.name || ' (' || v_emp.emp_id || ') tried to check out at ' || v_where || '.',
      '/admin/approvals');
    return row_to_json(v_session);
  end if;

  v_end := least(now(), v_session.started_at + interval '12 hours');
  v_total := floor(extract(epoch from (v_end - v_session.started_at)) / 60);

  update work_sessions set
    ended_at = v_end, end_lat = p_lat, end_lng = p_lng,
    end_location_id = v_near.id, end_distance_m = round(v_near.dist),
    end_out_of_range = false, pending_kind = null,
    status = 'completed', total_minutes = v_total,
    overtime_minutes = greatest(0, v_total - 540)
  where id = v_session.id returning * into v_session;
  perform audit_log('attendance_marked', v_emp.id, null,
    jsonb_build_object('event','check_out','distance_m',round(v_near.dist),
                       'location',v_near.name,'minutes',v_total,'inside',true),
    'Check-out inside geofence', v_emp.id);
  return row_to_json(v_session);
end $function$;
