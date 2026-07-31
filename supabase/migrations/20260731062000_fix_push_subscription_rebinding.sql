-- push_subscriptions has INSERT/SELECT/DELETE policies but no UPDATE one, so the
-- client's `upsert(..., onConflict: endpoint)` always failed on the conflict path.
-- On a shared handset that left the endpoint bound to whoever signed in first,
-- so the next employee got none of their own notifications and kept receiving
-- the previous employee's. Bind the endpoint to the caller in one definer call.
create or replace function public.save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_emp uuid := current_employee_id();
begin
  if v_emp is null then raise exception 'Not an employee'; end if;
  if coalesce(trim(p_endpoint),'') = '' then raise exception 'Endpoint required'; end if;

  -- A browser push endpoint identifies one browser install, so it may only ever
  -- belong to the employee currently signed in on it.
  delete from push_subscriptions where endpoint = p_endpoint and employee_id <> v_emp;

  insert into push_subscriptions(employee_id, endpoint, p256dh, auth)
  values (v_emp, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set employee_id = excluded.employee_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth;

  return json_build_object('ok', true);
end $function$;

revoke execute on function public.save_push_subscription(text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;
