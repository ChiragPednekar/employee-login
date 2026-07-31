-- Extra approved sites an employee may punch from, beyond their primary office.
create table if not exists public.employee_locations (
  employee_id uuid not null references public.employees(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (employee_id, location_id)
);

alter table public.employee_locations enable row level security;

drop policy if exists "read own or admin/audit/manager" on public.employee_locations;
create policy "read own or admin/audit/manager" on public.employee_locations
  for select using (
    employee_id = public.current_employee_id()
    or public.is_admin() or public.is_audit() or public.is_team_manager(employee_id)
  );

drop policy if exists "admin insert" on public.employee_locations;
create policy "admin insert" on public.employee_locations
  for insert with check (public.is_admin());

drop policy if exists "admin delete" on public.employee_locations;
create policy "admin delete" on public.employee_locations
  for delete using (public.is_admin());

create index if not exists employee_locations_location_idx
  on public.employee_locations(location_id);

grant select, insert, delete on public.employee_locations to authenticated;

-- Locations were add/edit/disable only; admins could never remove one.
drop policy if exists "admin delete" on public.locations;
create policy "admin delete" on public.locations
  for delete using (public.is_admin());

-- Every site a given employee is allowed to punch from: primary office plus
-- any extra assignments. Empty set => unassigned (any active location).
create or replace function public.allowed_locations(p_emp uuid)
returns setof public.locations
language sql
stable
security definer
set search_path to 'public'
as $$
  select l.* from locations l
  where l.active and (
    l.id = (select e.office_id from employees e where e.id = p_emp)
    or l.id in (select el.location_id from employee_locations el where el.employee_id = p_emp)
  );
$$;

revoke execute on function public.allowed_locations(uuid) from anon;
grant execute on function public.allowed_locations(uuid) to authenticated;
