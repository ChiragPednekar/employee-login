"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { istToday } from "@/lib/hooks";
import { fmtMinutes } from "@/lib/format";
import type { WorkSession, Employee } from "@/lib/types";
import {
  monthRange,
  isLate,
  sessionFlags,
  LATE_LABEL,
} from "@/lib/analytics";
import { Card, StatCard, SectionTitle, Skeleton, EmptyState } from "@/components/ui";
import {
  Users,
  TrendingUp,
  Clock,
  AlertTriangle,
  Timer,
  Printer,
  BarChart3,
} from "lucide-react";

type Row = WorkSession & {
  decided_by: string | null;
  emp: Pick<Employee, "name" | "emp_id" | "department"> | null;
};

export default function AnalyticsPage() {
  const [month, setMonth] = useState(istToday().slice(0, 7));
  const [rows, setRows] = useState<Row[]>([]);
  const [activeCount, setActiveCount] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    setLoaded(false);
    const { from, to } = monthRange(month);
    const supabase = supabaseBrowser();
    const [{ data }, { count }] = await Promise.all([
      supabase
        .from("work_sessions")
        .select("*, emp:employees!work_sessions_employee_id_fkey(name, emp_id, department)")
        .gte("work_date", from)
        .lt("work_date", to)
        .order("work_date"),
      supabase
        .from("employees")
        .select("id", { count: "exact", head: true })
        .eq("active", true)
        .eq("role", "employee"),
    ]);
    setRows((data as Row[]) ?? []);
    setActiveCount(count ?? 0);
    setLoaded(true);
  }, [month]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const stats = useMemo(() => {
    const worked = rows.filter((r) => (r.total_minutes ?? 0) > 0);
    const totalMin = worked.reduce((a, r) => a + (r.total_minutes ?? 0), 0);
    const otMin = worked.reduce((a, r) => a + (r.overtime_minutes ?? 0), 0);
    const lateCount = worked.filter((r) => isLate(r)).length;
    const flaggedCount = rows.filter((r) => sessionFlags(r).length > 0).length;

    // Distinct working days present, for attendance rate
    const presentByDate = new Map<string, Set<string>>();
    for (const r of rows) {
      if ((r.total_minutes ?? 0) <= 0 && r.status !== "active") continue;
      if (!presentByDate.has(r.work_date)) presentByDate.set(r.work_date, new Set());
      presentByDate.get(r.work_date)!.add(r.employee_id);
    }
    const workdays = [...presentByDate.keys()].filter((d) => {
      const dow = new Date(d).getDay();
      return dow !== 0; // exclude Sundays from the denominator
    });
    const avgPresent =
      workdays.reduce((a, d) => a + (presentByDate.get(d)?.size ?? 0), 0) /
      (workdays.length || 1);
    const attendanceRate = activeCount > 0 ? Math.round((avgPresent / activeCount) * 100) : 0;

    // Trend: present count per date (sorted)
    const trend = [...presentByDate.entries()]
      .map(([date, set]) => ({ date, count: set.size }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // By employee
    const byEmp = new Map<
      string,
      { name: string; emp_id: string; dept: string; days: number; minutes: number; ot: number; late: number }
    >();
    for (const r of worked) {
      const key = r.employee_id;
      if (!byEmp.has(key))
        byEmp.set(key, {
          name: r.emp?.name ?? "—",
          emp_id: r.emp?.emp_id ?? "",
          dept: r.emp?.department ?? "No department",
          days: 0,
          minutes: 0,
          ot: 0,
          late: 0,
        });
      const e = byEmp.get(key)!;
      e.days += 1;
      e.minutes += r.total_minutes ?? 0;
      e.ot += r.overtime_minutes ?? 0;
      if (isLate(r)) e.late += 1;
    }
    const employees = [...byEmp.values()].sort((a, b) => b.ot - a.ot);

    // By department
    const byDept = new Map<string, { days: number; minutes: number; ot: number; late: number }>();
    for (const e of byEmp.values()) {
      if (!byDept.has(e.dept)) byDept.set(e.dept, { days: 0, minutes: 0, ot: 0, late: 0 });
      const d = byDept.get(e.dept)!;
      d.days += e.days;
      d.minutes += e.minutes;
      d.ot += e.ot;
      d.late += e.late;
    }
    const departments = [...byDept.entries()].sort((a, b) => b[1].minutes - a[1].minutes);

    const onTime = worked.length - lateCount;

    return {
      totalMin,
      otMin,
      lateCount,
      onTime,
      flaggedCount,
      attendanceRate,
      trend,
      employees,
      departments,
      workedCount: worked.length,
    };
  }, [rows, activeCount]);

  const maxTrend = Math.max(1, ...stats.trend.map((d) => d.count));

  function printReport() {
    const { from } = monthRange(month);
    const title = new Date(from).toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const empRows = stats.employees
      .map(
        (e) => `<tr>
          <td>${e.emp_id}</td><td>${escapeHtml(e.name)}</td><td>${escapeHtml(e.dept)}</td>
          <td class="num">${e.days}</td>
          <td class="num">${(e.minutes / 60).toFixed(1)}h</td>
          <td class="num">${(e.ot / 60).toFixed(1)}h</td>
          <td class="num">${e.late}</td>
        </tr>`
      )
      .join("");
    const deptRows = stats.departments
      .map(
        ([name, d]) => `<tr>
          <td>${escapeHtml(name)}</td>
          <td class="num">${(d.minutes / 60).toFixed(1)}h</td>
          <td class="num">${(d.ot / 60).toFixed(1)}h</td>
          <td class="num">${d.late}</td>
        </tr>`
      )
      .join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>WorkLog Report — ${title}</title>
      <style>
        body{font-family:-apple-system,Inter,Arial,sans-serif;color:#131b2e;margin:32px;font-feature-settings:'tnum'}
        h1{font-size:22px;margin:0} .sub{color:#64748b;margin:4px 0 24px;font-size:13px}
        .kpis{display:flex;gap:16px;margin-bottom:28px;flex-wrap:wrap}
        .kpi{border:1px solid #e2e8f0;border-radius:12px;padding:14px 18px;min-width:130px}
        .kpi .l{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#64748b}
        .kpi .v{font-size:22px;font-weight:600;margin-top:4px}
        h2{font-size:14px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin:24px 0 8px}
        table{width:100%;border-collapse:collapse;font-size:13px}
        th{text-align:left;border-bottom:2px solid #e2e8f0;padding:8px;color:#434656;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
        td{border-bottom:1px solid #eef0f5;padding:8px}
        .num{text-align:right}
        .foot{margin-top:28px;font-size:11px;color:#94a3b8}
        @media print{body{margin:12mm}}
      </style></head><body>
      <h1>WorkLog — Monthly Attendance Report</h1>
      <div class="sub">${title} · generated ${new Date().toLocaleDateString("en-IN")} · Late = clock-in ${LATE_LABEL}</div>
      <div class="kpis">
        <div class="kpi"><div class="l">Attendance rate</div><div class="v">${stats.attendanceRate}%</div></div>
        <div class="kpi"><div class="l">Total hours</div><div class="v">${(stats.totalMin / 60).toFixed(0)}h</div></div>
        <div class="kpi"><div class="l">Overtime</div><div class="v">${(stats.otMin / 60).toFixed(1)}h</div></div>
        <div class="kpi"><div class="l">Late arrivals</div><div class="v">${stats.lateCount}</div></div>
        <div class="kpi"><div class="l">Flagged sessions</div><div class="v">${stats.flaggedCount}</div></div>
      </div>
      <h2>By employee</h2>
      <table><thead><tr><th>ID</th><th>Name</th><th>Department</th><th class="num">Days</th><th class="num">Hours</th><th class="num">Overtime</th><th class="num">Late</th></tr></thead>
      <tbody>${empRows || '<tr><td colspan="7">No data</td></tr>'}</tbody></table>
      <h2>By department</h2>
      <table><thead><tr><th>Department</th><th class="num">Hours</th><th class="num">Overtime</th><th class="num">Late</th></tr></thead>
      <tbody>${deptRows || '<tr><td colspan="4">No data</td></tr>'}</tbody></table>
      <div class="foot">WorkLog · location-based attendance. This report reflects logged sessions only.</div>
      </body></html>`;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
  }

  return (
    <main className="space-y-5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">Analytics</h1>
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="h-9 rounded-lg border border-line-strong bg-white px-3 text-sm"
          />
          <button
            onClick={printReport}
            disabled={!loaded || stats.workedCount === 0}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-line-strong bg-white px-3.5 text-sm font-semibold text-ink transition-colors hover:bg-surface-low disabled:opacity-40"
          >
            <Printer size={15} />
            Report
          </button>
        </div>
      </div>

      {!loaded ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[120px]" />
          ))}
        </div>
      ) : stats.workedCount === 0 ? (
        <EmptyState icon={BarChart3} title="No attendance in this month" hint="Pick another month." />
      ) : (
        <>
          {/* KPIs */}
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              label="Attendance rate"
              value={`${stats.attendanceRate}%`}
              icon={Users}
              tone="primary"
              highlight
            />
            <StatCard label="Total hours" value={`${Math.round(stats.totalMin / 60)}h`} icon={Clock} tone="slate" />
            <StatCard
              label="Overtime"
              value={fmtMinutes(stats.otMin)}
              icon={TrendingUp}
              tone="primary"
              highlight={stats.otMin > 0}
            />
            <StatCard
              label="Flagged"
              value={stats.flaggedCount}
              sub="sessions"
              icon={AlertTriangle}
              tone="amber"
              highlight={stats.flaggedCount > 0}
            />
          </section>

          {/* Attendance trend */}
          <Card className="p-5">
            <div className="mb-4 flex items-center gap-2">
              <TrendingUp size={16} className="text-primary" strokeWidth={2.25} />
              <h2 className="text-sm font-semibold text-ink">Daily attendance</h2>
            </div>
            <div className="flex h-32 items-end gap-1 overflow-x-auto">
              {stats.trend.map((d) => (
                <div
                  key={d.date}
                  className="flex h-full min-w-[10px] flex-1 flex-col items-center justify-end gap-1"
                  title={`${d.count} present on ${d.date}`}
                >
                  <div
                    className="w-full rounded-sm bg-primary transition-all"
                    style={{ height: `${Math.max(6, Math.round((d.count / maxTrend) * 100))}%` }}
                  />
                  <span className="text-[9px] text-outline">{d.date.slice(-2)}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* Punctuality */}
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Timer size={16} className="text-primary" strokeWidth={2.25} />
                <h2 className="text-sm font-semibold text-ink">Punctuality</h2>
              </div>
              <span className="rounded bg-surface-low px-2 py-0.5 text-[11px] text-ink-muted">
                Late = clock-in {LATE_LABEL}
              </span>
            </div>
            <div className="flex h-3 overflow-hidden rounded-full bg-surface-low">
              <div
                className="bg-success"
                style={{ width: `${(stats.onTime / Math.max(1, stats.workedCount)) * 100}%` }}
              />
              <div
                className="bg-amber-400"
                style={{ width: `${(stats.lateCount / Math.max(1, stats.workedCount)) * 100}%` }}
              />
            </div>
            <div className="mt-2 flex gap-4 text-sm">
              <span className="flex items-center gap-1.5 text-ink-muted">
                <span className="h-2.5 w-2.5 rounded-full bg-success" /> On time{" "}
                <b className="text-ink">{stats.onTime}</b>
              </span>
              <span className="flex items-center gap-1.5 text-ink-muted">
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400" /> Late{" "}
                <b className="text-ink">{stats.lateCount}</b>
              </span>
            </div>
          </Card>

          {/* Overtime by employee */}
          <div className="space-y-2">
            <SectionTitle>Overtime &amp; hours by employee</SectionTitle>
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line bg-slate-50/60 text-left text-[11px] uppercase tracking-wide text-ink-muted">
                      <th className="px-4 py-2.5 font-semibold">Employee</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Days</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Hours</th>
                      <th className="px-3 py-2.5 text-right font-semibold">OT</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Late</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {stats.employees.map((e) => (
                      <tr key={e.emp_id}>
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-ink">{e.name}</p>
                          <p className="text-xs text-outline">
                            {e.emp_id} · {e.dept}
                          </p>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{e.days}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{fmtMinutes(e.minutes)}</td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-primary">
                          {e.ot > 0 ? fmtMinutes(e.ot) : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {e.late > 0 ? (
                            <span className="font-semibold text-amber-600">{e.late}</span>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          {/* By department */}
          <div className="space-y-2">
            <SectionTitle>By department</SectionTitle>
            <div className="grid gap-3 sm:grid-cols-2">
              {stats.departments.map(([name, d]) => (
                <Card key={name} className="p-4">
                  <p className="text-sm font-semibold text-ink">{name}</p>
                  <div className="mt-2 flex gap-4 text-sm text-ink-muted">
                    <span>
                      <b className="text-ink">{fmtMinutes(d.minutes)}</b> worked
                    </span>
                    <span>
                      <b className="text-primary">{fmtMinutes(d.ot)}</b> OT
                    </span>
                    {d.late > 0 && (
                      <span>
                        <b className="text-amber-600">{d.late}</b> late
                      </span>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </>
      )}
    </main>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string
  );
}
