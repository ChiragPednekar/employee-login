-- Every employee had a primary office set, and the geofence treated an
-- assignment as a hard restriction: an employee could only check in at their own
-- office, so standing inside any OTHER approved site still asked HR for
-- permission. The intended rule is that any site on the admin's approved list
-- is fine for anyone, and only somewhere unlisted needs permission.
--
-- restrict_to_assigned_sites brings back the stricter per-employee behaviour for
-- orgs that want it. It defaults to false, so the approved list is org-wide.
alter table public.app_settings
  add column if not exists restrict_to_assigned_sites boolean not null default false;

comment on column public.app_settings.restrict_to_assigned_sites is
  'false: any active location is valid for every employee. true: an employee with a primary office or granted sites may only check in at those.';

create or replace function public.site_restriction_enabled()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce((select restrict_to_assigned_sites from app_settings), false);
$function$;

revoke execute on function public.site_restriction_enabled() from public, anon, authenticated;

-- Restricted only when the org opted in AND this employee actually has sites.
create or replace function public.nearest_allowed_location(
  p_emp uuid, p_lat double precision, p_lng double precision
)
returns table(id uuid, name text, radius_m integer, dist double precision, assigned boolean)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v_restricted boolean := site_restriction_enabled() and has_location_assignment(p_emp);
begin
  if v_restricted then
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
