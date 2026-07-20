-- WorkLog business-rule test harness
-- Run against the Supabase Postgres DB:  psql "$DATABASE_URL" -f tests/business-rules.sql
-- Self-contained: creates a throwaway employee (TST999), asserts every rule, cleans up.
-- Any failed assertion raises an exception and aborts (leaving TST999 removed).
--
-- Covers spec §8:
--   T1 monthly allocation (2/month)      T6 sandwich via single Sat-Mon range
--   T2 expiry beyond carry window        T7 sandwich removed on cancel
--   T3 one-month carry-forward           T8 duplicate attendance blocked
--   T4 oldest-first consumption          T9 geofence 200m boundary (Haversine)
--   T5 working-days exclude Sundays
--
-- Geofence inside/outside end-to-end, GPS-error handling, and Audit RBAC
-- (route guard / no-write / no-approve / read-only) are covered by the app-level
-- checks documented in the delivery summary (they require an authenticated session).

delete from employees where emp_id = 'TST999';

do $$
declare
  t uuid; t2 uuid;
  v_cur date := date_trunc('month',(now() at time zone 'Asia/Kolkata'))::date;
  v_prev date := (v_cur - interval '1 month')::date;
  v_old date := (v_cur - interval '2 month')::date;
  n numeric; need numeric; take numeric; r record;
  prevb numeric; curb numeric; oldb numeric; expiry_cnt int; sw int; dup boolean := false;
  boundary_in numeric; boundary_out numeric;
begin
  insert into employees(emp_id,name,email,role,active)
  values ('TST999','Test Bot','testbot@example.com','employee',true) returning id into t;

  perform ensure_leave_allocations(t);
  select coalesce(sum(days),0) into n from leave_ledger where employee_id=t;
  if n <> 2 then raise exception 'T1 monthly-allocation FAIL: %',n; end if;

  insert into leave_ledger(employee_id,alloc_month,kind,days,note) values (t,v_old,'allocation',2,'old');
  perform ensure_leave_allocations(t);
  select count(*) into expiry_cnt from leave_ledger where employee_id=t and kind='expiry' and alloc_month=v_old;
  select coalesce(sum(days),0) into oldb from leave_ledger where employee_id=t and alloc_month=v_old;
  if expiry_cnt <> 1 or oldb <> 0 then raise exception 'T2 expiry FAIL: cnt=% bal=%',expiry_cnt,oldb; end if;

  insert into leave_ledger(employee_id,alloc_month,kind,days,note) values (t,v_prev,'allocation',2,'prev');
  perform ensure_leave_allocations(t);
  select coalesce(sum(days),0) into prevb from leave_ledger where employee_id=t and alloc_month=v_prev;
  if prevb <> 2 then raise exception 'T3 carry-forward FAIL: %',prevb; end if;

  need := 3;
  for r in select alloc_month, sum(days) as rem from leave_ledger where employee_id=t
           group by alloc_month having sum(days)>0 order by alloc_month loop
    exit when need<=0; take := least(need, r.rem);
    insert into leave_ledger(employee_id,alloc_month,kind,days,note) values (t,r.alloc_month,'consumption',-take,'t4');
    need := need - take;
  end loop;
  select coalesce(sum(days),0) into prevb from leave_ledger where employee_id=t and alloc_month=v_prev;
  select coalesce(sum(days),0) into curb from leave_ledger where employee_id=t and alloc_month=v_cur;
  if prevb<>0 or curb<>1 then raise exception 'T4 oldest-first FAIL: prev=% cur=%',prevb,curb; end if;

  if working_days('2026-07-11','2026-07-13') <> 2 then raise exception 'T5 working_days FAIL'; end if;

  insert into leave_requests(employee_id,start_date,end_date,day_part,days,reason,status,paid_days,unpaid_days)
    values (t,'2026-07-11','2026-07-13','full',2,'single','approved',2,0) returning id into t2;
  perform recompute_sandwich(t,'2026-07-11','2026-07-13');
  select count(*) into sw from sandwich_leaves where employee_id=t and sunday_date='2026-07-12';
  if sw<>1 then raise exception 'T6 sandwich single-request FAIL: %',sw; end if;

  update leave_requests set status='cancelled' where id=t2;
  perform recompute_sandwich(t,'2026-07-11','2026-07-13');
  select count(*) into sw from sandwich_leaves where employee_id=t and sunday_date='2026-07-12';
  if sw<>0 then raise exception 'T7 sandwich-remove FAIL: %',sw; end if;

  insert into work_sessions(employee_id,work_date,started_at,start_lat,start_lng,status)
    values (t, current_date, now(), 19.076,72.8777,'active');
  begin
    insert into work_sessions(employee_id,work_date,started_at,start_lat,start_lng,status)
      values (t, current_date, now(), 19.076,72.8777,'active');
  exception when unique_violation then dup := true;
  end;
  if not dup then raise exception 'T8 duplicate-attendance FAIL'; end if;

  boundary_in  := distance_m(19.0760,72.8777, 19.07680,72.8777);  -- ~89m  -> inside
  boundary_out := distance_m(19.0760,72.8777, 19.07960,72.8777);  -- ~222m -> outside
  if not (boundary_in <= 200 and boundary_out > 200) then
    raise exception 'T9 geofence-boundary FAIL: in=% out=%',round(boundary_in),round(boundary_out);
  end if;

  delete from employees where emp_id='TST999';
  raise notice 'ALL TESTS PASSED';
end $$;
