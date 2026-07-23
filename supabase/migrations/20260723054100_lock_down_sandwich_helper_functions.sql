-- Both helpers added earlier today were reachable over the public REST API by
-- the anon role: sync_sandwich_on_requests (a SECURITY DEFINER *write*) returned
-- 204 to an unauthenticated caller, and sandwich_unpaid_days leaked any
-- employee's figure. Neither is meant to be called from outside the database.
--
-- sync_sandwich_on_requests is internal only: decide_leave / cancel_leave are
-- themselves SECURITY DEFINER, so they keep working after the revoke.
-- sandwich_unpaid_days additionally gets the same caller check the rest of the
-- leave surface uses, so it is safe even if it is ever re-granted.

revoke execute on function public.sync_sandwich_on_requests(uuid) from anon, authenticated, public;
revoke execute on function public.sandwich_unpaid_days(uuid, date, date) from anon, authenticated, public;

create or replace function public.sandwich_unpaid_days(
  p_emp uuid, p_from date default null, p_to date default null)
returns numeric
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v_total numeric;
begin
  -- Only the employee themselves, their manager, an admin or audit may look.
  if not (p_emp = current_employee_id() or is_admin() or is_audit() or is_team_manager(p_emp)) then
    raise exception 'Not allowed';
  end if;
  select coalesce(sum(unpaid_days), 0) into v_total
  from sandwich_leaves
  where employee_id = p_emp
    and (p_from is null or sunday_date >= p_from)
    and (p_to   is null or sunday_date <= p_to);
  return v_total;
end $function$;

revoke execute on function public.sandwich_unpaid_days(uuid, date, date) from anon, public;
grant  execute on function public.sandwich_unpaid_days(uuid, date, date) to authenticated;
