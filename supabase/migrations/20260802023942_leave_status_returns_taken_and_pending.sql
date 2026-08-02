-- The admin screen (leave_balances_all) reported remaining, taken and pending,
-- but leave_status — everything the employee sees — returned only the remaining
-- balance. An employee could not tell how much leave they had used. Return the
-- same taken/pending figures so both sides quote identical numbers.
create or replace function public.leave_status(p_emp uuid default null::uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_emp uuid := coalesce(p_emp, current_employee_id());
  v_cur date := date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date;
  v_prev date := (v_cur - interval '1 month')::date;
  v_year date := date_trunc('year', (now() at time zone 'Asia/Kolkata'))::date;
  v_cur_days numeric; v_prev_days numeric; v_total numeric;
  v_sw_month numeric; v_sw_total numeric;
  v_taken numeric; v_pending numeric;
begin
  if v_emp is null then raise exception 'No employee'; end if;
  if not (v_emp = current_employee_id() or is_admin() or is_audit() or is_team_manager(v_emp)) then
    raise exception 'Not allowed';
  end if;
  perform ensure_leave_allocations(v_emp);
  select coalesce(sum(days),0) into v_cur_days from leave_ledger where employee_id=v_emp and alloc_month=v_cur;
  select coalesce(sum(days),0) into v_prev_days from leave_ledger where employee_id=v_emp and alloc_month=v_prev;
  select coalesce(sum(days),0) into v_total from leave_ledger where employee_id=v_emp and alloc_month >= v_prev;

  -- Same definitions leave_balances_all() uses, so the two screens cannot disagree.
  select coalesce(sum(days),0) into v_taken from leave_requests
   where employee_id=v_emp and status='approved' and start_date >= v_year;
  select coalesce(sum(days),0) into v_pending from leave_requests
   where employee_id=v_emp and status='pending';

  v_sw_month := sandwich_unpaid_days(v_emp, v_cur, (v_cur + interval '1 month - 1 day')::date);
  v_sw_total := sandwich_unpaid_days(v_emp);

  return json_build_object(
    'current_month', v_cur, 'current_days', v_cur_days,
    'carried_days', v_prev_days, 'total_available', v_total,
    'expiring_days', greatest(v_prev_days,0),
    'expiring_on', (v_cur + interval '1 month' - interval '1 day')::date,
    'taken_this_year', v_taken,
    'pending_days', v_pending,
    'sandwich_unpaid_month', v_sw_month,
    'sandwich_unpaid_total', v_sw_total
  );
end $function$;
