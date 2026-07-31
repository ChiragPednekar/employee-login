-- Live paid-leave position for every employee the caller may see, straight from
-- leave_ledger. Replaces the frozen leave_balances table on the admin screens.
create or replace function public.leave_balances_all()
returns table (
  employee_id uuid,
  current_days numeric,
  carried_days numeric,
  total_available numeric,
  taken_this_year numeric,
  pending_days numeric
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cur date := date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date;
  v_prev date := (v_cur - interval '1 month')::date;
  v_year date := date_trunc('year', (now() at time zone 'Asia/Kolkata'))::date;
  r record;
begin
  for r in
    select e.id from employees e
    where e.active and (
      e.id = current_employee_id() or is_admin() or is_audit() or is_team_manager(e.id)
    )
  loop
    perform ensure_leave_allocations(r.id);
  end loop;

  return query
  select
    e.id,
    coalesce((select sum(l.days) from leave_ledger l
              where l.employee_id = e.id and l.alloc_month = v_cur), 0),
    coalesce((select sum(l.days) from leave_ledger l
              where l.employee_id = e.id and l.alloc_month = v_prev), 0),
    coalesce((select sum(l.days) from leave_ledger l
              where l.employee_id = e.id and l.alloc_month >= v_prev), 0),
    coalesce((select sum(lr.days) from leave_requests lr
              where lr.employee_id = e.id and lr.status = 'approved'
                and lr.start_date >= v_year), 0),
    coalesce((select sum(lr.days) from leave_requests lr
              where lr.employee_id = e.id and lr.status = 'pending'), 0)
  from employees e
  where e.active and (
    e.id = current_employee_id() or is_admin() or is_audit() or is_team_manager(e.id)
  );
end $function$;

revoke execute on function public.leave_balances_all() from anon;
grant execute on function public.leave_balances_all() to authenticated;

-- Admin-only manual credit / deduction against an employee's paid-leave ledger.
-- Positive days grant, negative days deduct. Booked to the current month.
create or replace function public.adjust_leave(p_emp uuid, p_days numeric, p_note text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cur date := date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date;
  v_actor uuid; v_total numeric;
begin
  if not is_admin() then raise exception 'Only an admin can adjust leave'; end if;
  if p_days is null or p_days = 0 then raise exception 'Enter a non-zero number of days'; end if;
  if abs(p_days) > 365 then raise exception 'That adjustment is out of range'; end if;
  if not exists (select 1 from employees where id = p_emp) then
    raise exception 'Employee not found';
  end if;
  v_actor := current_employee_id();

  perform ensure_leave_allocations(p_emp);
  insert into leave_ledger(employee_id, alloc_month, kind, days, note)
  values (p_emp, v_cur, 'adjustment', p_days,
          coalesce(nullif(trim(p_note), ''), 'Manual adjustment by admin'));

  perform audit_log('leave_adjusted', p_emp, null,
    jsonb_build_object('days', p_days, 'note', p_note),
    'Admin adjusted paid-leave balance', v_actor);

  select coalesce(sum(days), 0) into v_total from leave_ledger where employee_id = p_emp;
  return json_build_object('ok', true, 'total_available', v_total);
end $function$;

revoke execute on function public.adjust_leave(uuid, numeric, text) from anon;
grant execute on function public.adjust_leave(uuid, numeric, text) to authenticated;
