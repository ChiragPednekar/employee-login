-- `revoke ... from anon` is not enough: functions are created with EXECUTE
-- granted to PUBLIC, which anon inherits. Revoke from PUBLIC, then re-grant
-- only to authenticated. Same fix as the sandwich helpers.
revoke execute on function public.allowed_locations(uuid) from public, anon;
grant execute on function public.allowed_locations(uuid) to authenticated;

revoke execute on function public.has_location_assignment(uuid) from public, anon;
grant execute on function public.has_location_assignment(uuid) to authenticated;

revoke execute on function public.nearest_allowed_location(uuid, double precision, double precision) from public, anon;
grant execute on function public.nearest_allowed_location(uuid, double precision, double precision) to authenticated;

revoke execute on function public.leave_balances_all() from public, anon;
grant execute on function public.leave_balances_all() to authenticated;

revoke execute on function public.adjust_leave(uuid, numeric, text) from public, anon;
grant execute on function public.adjust_leave(uuid, numeric, text) to authenticated;

-- Pre-existing hole in the same class: this SECURITY DEFINER helper inserts into
-- notification_queue and was callable without signing in — unauthenticated push
-- spam. It is only ever called from inside other definer functions, which run as
-- the owner, so revoking it outright is safe.
revoke execute on function public.queue_push_approvers(uuid, text, text, text) from public, anon, authenticated;
