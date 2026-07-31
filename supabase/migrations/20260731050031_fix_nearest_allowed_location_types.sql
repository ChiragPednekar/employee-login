-- distance_m() returns double precision; the first cut of this function declared
-- the column as numeric and every call failed with a result-type mismatch.
drop function if exists public.nearest_allowed_location(uuid, double precision, double precision);

-- Nearest site the employee may punch from, with the distance to it.
-- Assigned staff are scored against their assigned sites only; unassigned staff
-- keep the old behaviour of matching any active location.
create or replace function public.nearest_allowed_location(
  p_emp uuid, p_lat double precision, p_lng double precision
)
returns table (id uuid, name text, radius_m integer, dist double precision, assigned boolean)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v_assigned boolean := has_location_assignment(p_emp);
begin
  if v_assigned then
    return query
      select l.id, l.name, l.radius_m, distance_m(p_lat, p_lng, l.lat, l.lng), true
      from allowed_locations(p_emp) l
      order by distance_m(p_lat, p_lng, l.lat, l.lng)
      limit 1;
  else
    return query
      select l.id, l.name, l.radius_m, distance_m(p_lat, p_lng, l.lat, l.lng), false
      from locations l
      where l.active
      order by distance_m(p_lat, p_lng, l.lat, l.lng)
      limit 1;
  end if;
end $function$;

revoke execute on function public.nearest_allowed_location(uuid, double precision, double precision) from anon;
grant execute on function public.nearest_allowed_location(uuid, double precision, double precision) to authenticated;
