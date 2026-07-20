"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { istToday } from "@/lib/hooks";
import { fmtDate, fmtMinutes, fmtTime } from "@/lib/format";
import { istClockInMinutes } from "@/lib/analytics";
import type { WorkSession, Employee, LeaveRequest } from "@/lib/types";
import { Card, StatCard, SectionTitle, Badge, EmptyState, Skeleton } from "@/components/ui";
import {
  Users,
  UserCheck,
  UserX,
  Plane,
  Clock,
  LogOut,
  Percent,
  Search,
  MapPin,
  CalendarClock,
  Sandwich,
} from "lucide-react";

type Sess = WorkSession & {
  start_distance_m: number | null;
  emp: Pick<Employee, "name" | "emp_id" | "department" | "office_id"> | null;
};
type Leave = LeaveRequest & {
  paid_days: number;
  unpaid_days: number;
  emp: Pick<Employee, "name" | "emp_id" | "department"> | null;
};
type Settings = {
  shift_start: string;
  shift_end: string;
  late_grace_min: number;
  early_departure_grace_min: number;
};

function toMin(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export default function AuditDashboard() {
  const [tab, setTab] = useState<"attendance" | "leave">("attendance");
  const [asOf, setAsOf] = useState(istToday());
  const [from, setFrom] = useState(`${istToday().slice(0, 7)}-01`);
  const [to, setTo] = useState(istToday());

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [offices, setOffices] = useState<Record<string, string>>({});
  const [settings, setSettings] = useState<Settings | null>(null);
  const [sessions, setSessions] = useState<Sess[]>([]);
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [sandwich, setSandwich] = useState<{ employee_id: string; sunday_date: string }[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Filters
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("all");
  const [office, setOffice] = useState("all");
  const [attStatus, setAttStatus] = useState("all");
  const [leaveStatus, setLeaveStatus] = useState("all");

  const refresh = useCallback(async () => {
    setLoaded(false);
    const supabase = supabaseBrowser();
    const [{ data: emps }, { data: locs }, { data: sett }, { data: sess }, { data: lv }, { data: sw }] =
      await Promise.all([
        supabase.from("employees").select("*").order("emp_id"),
        supabase.from("locations").select("id, name"),
        supabase.from("app_settings").select("shift_start, shift_end, late_grace_min, early_departure_grace_min").maybeSingle(),
        supabase
          .from("work_sessions")
          .select("*, emp:employees!work_sessions_employee_id_fkey(name, emp_id, department, office_id)")
          .gte("work_date", from)
          .lte("work_date", to)
          .order("work_date", { ascending: false }),
        supabase
          .from("leave_requests")
          .select("*, emp:employees!leave_requests_employee_id_fkey(name, emp_id, department)")
          .lte("start_date", to)
          .gte("end_date", from)
          .order("start_date", { ascending: false }),
        supabase.from("sandwich_leaves").select("employee_id, sunday_date").gte("sunday_date", from).lte("sunday_date", to),
      ]);
    setEmployees(emps ?? []);
    setOffices(Object.fromEntries((locs ?? []).map((l: { id: string; name: string }) => [l.id, l.name])));
    setSettings((sett as Settings) ?? null);
    setSessions((sess as Sess[]) ?? []);
    setLeaves((lv as Leave[]) ?? []);
    setSandwich((sw as { employee_id: string; sunday_date: string }[]) ?? []);
    setLoaded(true);
  }, [from, to]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const departments = useMemo(
    () => [...new Set(employees.map((e) => e.department).filter(Boolean))].sort() as string[],
    [employees]
  );
  const activeEmployees = employees.filter((e) => e.active && e.role !== "audit");

  // ---- Day snapshot KPIs (for asOf date) ----
  const kpis = useMemo(() => {
    const lateThresh = settings ? toMin(settings.shift_start) + settings.late_grace_min : 555;
    const earlyThresh = settings ? toMin(settings.shift_end) - settings.early_departure_grace_min : 1065;
    const daySessions = sessions.filter((s) => s.work_date === asOf && s.status !== "denied");
    const presentIds = new Set(daySessions.map((s) => s.employee_id));
    const onLeaveIds = new Set(
      leaves.filter((l) => l.status === "approved" && l.start_date <= asOf && l.end_date >= asOf).map((l) => l.employee_id)
    );
    const late = daySessions.filter((s) => istClockInMinutes(s.started_at) > lateThresh).length;
    const early = daySessions.filter(
      (s) => s.ended_at && istClockInMinutes(s.ended_at) < earlyThresh && s.status === "completed"
    ).length;
    const total = activeEmployees.length;
    const present = presentIds.size;
    const onLeave = [...onLeaveIds].filter((id) => !presentIds.has(id)).length;
    const absent = Math.max(0, total - present - onLeave);
    return {
      total,
      present,
      absent,
      onLeave,
      late,
      early,
      rate: total > 0 ? Math.round((present / total) * 100) : 0,
    };
  }, [sessions, leaves, asOf, settings, activeEmployees.length]);

  // ---- Filtered attendance records ----
  const attRecords = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const lateThresh = settings ? toMin(settings.shift_start) + settings.late_grace_min : 555;
    return sessions
      .filter((s) => {
        if (attStatus !== "all" && s.status !== attStatus) return false;
        if (dept !== "all" && (s.emp?.department ?? "—") !== dept) return false;
        if (office !== "all" && (s.emp?.office_id ?? "none") !== office) return false;
        if (!needle) return true;
        return `${s.emp?.name ?? ""} ${s.emp?.emp_id ?? ""}`.toLowerCase().includes(needle);
      })
      .map((s) => ({
        s,
        late: istClockInMinutes(s.started_at) > lateThresh && s.status !== "pending_approval",
      }));
  }, [sessions, q, dept, office, attStatus, settings]);

  // ---- Filtered leave records ----
  const leaveRecords = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const swByEmp = new Map<string, number>();
    for (const x of sandwich) swByEmp.set(x.employee_id, (swByEmp.get(x.employee_id) ?? 0) + 1);
    return leaves
      .filter((l) => {
        if (leaveStatus !== "all" && l.status !== leaveStatus) return false;
        if (dept !== "all" && (l.emp?.department ?? "—") !== dept) return false;
        if (!needle) return true;
        return `${l.emp?.name ?? ""} ${l.emp?.emp_id ?? ""}`.toLowerCase().includes(needle);
      })
      .map((l) => ({ l, sandwich: swByEmp.get(l.employee_id) ?? 0 }));
  }, [leaves, sandwich, q, dept, leaveStatus]);

  return (
    <main className="space-y-5 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Audit dashboard</h1>
          <p className="text-xs text-ink-muted">Organization-wide attendance &amp; leave — read only</p>
        </div>
        <label className="text-xs text-ink-muted">
          Snapshot date
          <input
            type="date"
            aria-label="Snapshot date"
            value={asOf}
            max={istToday()}
            onChange={(e) => setAsOf(e.target.value)}
            className="ml-2 h-9 rounded-lg border border-line-strong bg-white px-3 text-sm text-ink"
          />
        </label>
      </div>

      {/* KPIs */}
      {!loaded ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[110px]" />
          ))}
        </div>
      ) : (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Total employees" value={kpis.total} icon={Users} tone="slate" />
          <StatCard label="Present" value={kpis.present} icon={UserCheck} tone="emerald" highlight />
          <StatCard label="Absent" value={kpis.absent} icon={UserX} tone="amber" highlight={kpis.absent > 0} />
          <StatCard label="On leave" value={kpis.onLeave} icon={Plane} tone="primary" />
          <StatCard label="Late arrivals" value={kpis.late} icon={Clock} tone="amber" highlight={kpis.late > 0} />
          <StatCard label="Early departures" value={kpis.early} icon={LogOut} tone="amber" highlight={kpis.early > 0} />
          <StatCard label="Attendance rate" value={`${kpis.rate}%`} icon={Percent} tone="primary" highlight />
          <StatCard label="Sandwich (range)" value={sandwich.length} icon={Sandwich} tone="slate" />
        </section>
      )}

      {/* Tabs */}
      <div className="flex gap-1.5">
        {(["attendance", "leave"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-sm font-medium transition-colors ${
              tab === t ? "border-primary bg-primary text-white" : "border-line-strong bg-white text-ink-muted hover:bg-surface-low"
            }`}
          >
            {t === "attendance" ? <CalendarClock size={15} /> : <Plane size={15} />}
            {t === "attendance" ? "Attendance records" : "Leave records"}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
          <input
            type="search"
            aria-label="Search employee or ID"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search employee or ID…"
            className="h-9 w-full rounded-lg border border-line-strong bg-white pl-9 pr-3 text-sm text-ink placeholder:text-outline"
          />
        </div>
        <select aria-label="Department" value={dept} onChange={(e) => setDept(e.target.value)} className="h-9 rounded-lg border border-line-strong bg-white px-2.5 text-sm text-ink">
          <option value="all">All departments</option>
          {departments.map((d) => (<option key={d} value={d}>{d}</option>))}
        </select>
        {tab === "attendance" && (
          <>
            <select aria-label="Office" value={office} onChange={(e) => setOffice(e.target.value)} className="h-9 rounded-lg border border-line-strong bg-white px-2.5 text-sm text-ink">
              <option value="all">All offices</option>
              {Object.entries(offices).map(([id, name]) => (<option key={id} value={id}>{name}</option>))}
              <option value="none">No office</option>
            </select>
            <select aria-label="Attendance status" value={attStatus} onChange={(e) => setAttStatus(e.target.value)} className="h-9 rounded-lg border border-line-strong bg-white px-2.5 text-sm text-ink">
              <option value="all">All statuses</option>
              <option value="completed">Completed</option>
              <option value="active">Active</option>
              <option value="pending_approval">Pending</option>
              <option value="auto_closed">Auto-closed</option>
              <option value="denied">Denied</option>
            </select>
          </>
        )}
        {tab === "leave" && (
          <select aria-label="Leave status" value={leaveStatus} onChange={(e) => setLeaveStatus(e.target.value)} className="h-9 rounded-lg border border-line-strong bg-white px-2.5 text-sm text-ink">
            <option value="all">All statuses</option>
            <option value="approved">Approved</option>
            <option value="pending">Pending</option>
            <option value="denied">Denied</option>
            <option value="cancelled">Cancelled</option>
          </select>
        )}
        <span className="flex items-center gap-1 text-xs text-ink-muted">
          <input type="date" aria-label="From date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 rounded-lg border border-line-strong bg-white px-2 text-sm text-ink" />
          <span>→</span>
          <input type="date" aria-label="To date" value={to} max={istToday()} onChange={(e) => setTo(e.target.value)} className="h-9 rounded-lg border border-line-strong bg-white px-2 text-sm text-ink" />
        </span>
      </div>

      {/* Tables */}
      {!loaded ? (
        <Skeleton className="h-64 w-full" />
      ) : tab === "attendance" ? (
        attRecords.length === 0 ? (
          <EmptyState icon={CalendarClock} title="No attendance records" hint="Adjust the filters or date range." />
        ) : (
          <Card className="overflow-hidden">
            <SectionTitle>
              <span className="px-4 py-2 block">{attRecords.length} record(s)</span>
            </SectionTitle>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y border-line bg-slate-50/60 text-left text-[11px] uppercase tracking-wide text-ink-muted">
                    <th className="px-4 py-2.5 font-semibold">Employee</th>
                    <th className="px-3 py-2.5 font-semibold">Dept / Office</th>
                    <th className="px-3 py-2.5 font-semibold">Date</th>
                    <th className="px-3 py-2.5 font-semibold">In</th>
                    <th className="px-3 py-2.5 font-semibold">Out</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Hours</th>
                    <th className="px-3 py-2.5 font-semibold">Status</th>
                    <th className="px-3 py-2.5 font-semibold">Geofence</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Dist</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {attRecords.map(({ s, late }) => (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-ink">{s.emp?.name}</p>
                        <p className="text-xs text-outline">{s.emp?.emp_id}</p>
                      </td>
                      <td className="px-3 py-2.5 text-ink-muted">
                        {s.emp?.department ?? "—"}
                        <br />
                        <span className="text-xs text-outline">
                          {s.emp?.office_id ? offices[s.emp.office_id] ?? "—" : "No office"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-ink-muted">{fmtDate(s.work_date)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {fmtTime(s.started_at)}
                        {late && <span className="ml-1 text-[10px] font-bold text-amber-600">LATE</span>}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-ink-muted">{fmtTime(s.ended_at)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {fmtMinutes(s.total_minutes)}
                        {(s.overtime_minutes ?? 0) > 0 && (
                          <span className="ml-1 text-xs font-semibold text-primary">+{fmtMinutes(s.overtime_minutes)}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge tone={s.status === "completed" ? "emerald" : s.status === "denied" ? "red" : s.status === "auto_closed" ? "amber" : "slate"}>
                          {s.status.replace("_", " ")}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5">
                        {s.start_location_id ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                            <MapPin size={12} /> Inside
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600">
                            <MapPin size={12} /> Outside
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">
                        {s.start_distance_m != null ? `${s.start_distance_m}m` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )
      ) : leaveRecords.length === 0 ? (
        <EmptyState icon={Plane} title="No leave records" hint="Adjust the filters or date range." />
      ) : (
        <Card className="overflow-hidden">
          <SectionTitle>
            <span className="px-4 py-2 block">{leaveRecords.length} record(s)</span>
          </SectionTitle>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-line bg-slate-50/60 text-left text-[11px] uppercase tracking-wide text-ink-muted">
                  <th className="px-4 py-2.5 font-semibold">Employee</th>
                  <th className="px-3 py-2.5 font-semibold">Dept</th>
                  <th className="px-3 py-2.5 font-semibold">Dates</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Days</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Paid</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Unpaid</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Sandwich</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {leaveRecords.map(({ l, sandwich: sw }) => (
                  <tr key={l.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-ink">{l.emp?.name}</p>
                      <p className="text-xs text-outline">{l.emp?.emp_id}</p>
                    </td>
                    <td className="px-3 py-2.5 text-ink-muted">{l.emp?.department ?? "—"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-ink-muted">
                      {fmtDate(l.start_date)}
                      {l.end_date !== l.start_date && ` → ${fmtDate(l.end_date)}`}
                      <br />
                      <span className="text-xs text-outline">{l.day_part.replace("_", " ")}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{l.days}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-success">{l.paid_days || "—"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-amber-600">{l.unpaid_days || "—"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{sw || "—"}</td>
                    <td className="px-4 py-2.5">
                      <Badge tone={l.status === "approved" ? "emerald" : l.status === "denied" ? "red" : l.status === "cancelled" ? "slate" : "amber"}>
                        {l.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </main>
  );
}
