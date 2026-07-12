"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { istToday, useMe } from "@/lib/hooks";
import { fmtTime, elapsedSince } from "@/lib/format";
import type { WorkSession, Employee } from "@/lib/types";
import {
  Card,
  StatCard,
  SectionTitle,
  Badge,
  QuickAction,
  Skeleton,
  EmptyState,
} from "@/components/ui";
import {
  Clock,
  Users,
  MapPin,
  Plane,
  TrendingUp,
  UserPlus,
  CheckCircle2,
  CalendarClock,
} from "lucide-react";

type SessionWithEmp = WorkSession & { employees: Pick<Employee, "name" | "emp_id"> };

function greeting() {
  const h = Number(
    new Date().toLocaleString("en-US", { hour: "2-digit", hour12: false, timeZone: "Asia/Kolkata" })
  );
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export default function AdminDashboard() {
  const { me } = useMe();
  const [today, setToday] = useState<SessionWithEmp[]>([]);
  const [weekRows, setWeekRows] = useState<{ work_date: string; employee_id: string }[]>([]);
  const [pendingSessions, setPendingSessions] = useState(0);
  const [pendingLeaves, setPendingLeaves] = useState(0);
  const [employeeCount, setEmployeeCount] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    const supabase = supabaseBrowser();
    const weekAgo = new Date(Date.now() - 6 * 86400000).toLocaleDateString("en-CA", {
      timeZone: "Asia/Kolkata",
    });
    async function load() {
      const [sessions, week, pendS, pendL, emps] = await Promise.all([
        supabase
          .from("work_sessions")
          .select("*, employees!employee_id(name, emp_id)")
          .eq("work_date", istToday())
          .order("started_at"),
        supabase
          .from("work_sessions")
          .select("work_date, employee_id")
          .gte("work_date", weekAgo),
        supabase
          .from("work_sessions")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending_approval"),
        supabase
          .from("leave_requests")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending"),
        supabase
          .from("employees")
          .select("id", { count: "exact", head: true })
          .eq("active", true)
          .eq("role", "employee"),
      ]);
      setToday((sessions.data as SessionWithEmp[]) ?? []);
      setWeekRows((week.data as { work_date: string; employee_id: string }[]) ?? []);
      setPendingSessions(pendS.count ?? 0);
      setPendingLeaves(pendL.count ?? 0);
      setEmployeeCount(emps.count ?? 0);
      setLoaded(true);
    }
    load();
    const poll = setInterval(load, 30000);
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(timer);
    };
  }, []);

  const working = today.filter((s) => s.status === "active");
  const presentToday = today.filter((s) => s.status !== "denied").length;

  // 7-day attendance trend: distinct present employees per day
  const trend = useMemo(() => {
    const days: { label: string; date: string; count: number }[] = [];
    const byDate = new Map<string, Set<string>>();
    for (const r of weekRows) {
      if (!byDate.has(r.work_date)) byDate.set(r.work_date, new Set());
      byDate.get(r.work_date)!.add(r.employee_id);
    }
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const key = d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      days.push({
        label: d.toLocaleDateString("en-US", { weekday: "narrow", timeZone: "Asia/Kolkata" }),
        date: key,
        count: byDate.get(key)?.size ?? 0,
      });
    }
    return days;
  }, [weekRows]);

  const maxTrend = Math.max(1, ...trend.map((d) => d.count));
  const avgPresent = trend.reduce((a, d) => a + d.count, 0) / (trend.length || 1);
  const attendanceRate =
    employeeCount > 0 ? Math.round((avgPresent / employeeCount) * 100) : 0;

  return (
    <main className="space-y-6 p-4">
      {/* Greeting */}
      <div className="pt-1">
        <h1 className="text-xl font-semibold tracking-tight text-ink">{greeting()} 👋</h1>
        <p className="mt-0.5 text-sm text-ink-muted">Here&apos;s what needs your attention today.</p>
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-2">
        <QuickAction label="Approve requests" icon={CheckCircle2} href="/admin/approvals" />
        {me?.role === "admin" && (
          <QuickAction label="Add employee" icon={UserPlus} href="/admin/employees" />
        )}
        <QuickAction label="View attendance" icon={CalendarClock} href="/admin/attendance" />
      </div>

      {/* Stats */}
      {!loaded ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[86px]" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="Working now"
            value={working.length}
            icon={Clock}
            tone="emerald"
            highlight={working.length > 0}
          />
          <StatCard
            label="Present today"
            value={presentToday}
            sub={`of ${employeeCount} employees`}
            icon={Users}
            tone="primary"
          />
          <StatCard
            label="Location requests"
            value={pendingSessions}
            icon={MapPin}
            tone="amber"
            href="/admin/approvals"
            highlight={pendingSessions > 0}
          />
          <StatCard
            label="Leave requests"
            value={pendingLeaves}
            icon={Plane}
            tone="amber"
            href="/admin/leaves"
            highlight={pendingLeaves > 0}
          />
        </div>
      )}

      {/* Weekly trend + attendance rate; sits beside activity on desktop */}
      <div className="grid gap-6 lg:grid-cols-5 lg:items-start">
      <Card className="p-4 lg:col-span-2">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp size={16} className="text-primary" strokeWidth={2.25} />
            <h2 className="text-sm font-semibold text-ink">Attendance this week</h2>
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold leading-none text-ink">{attendanceRate}%</p>
            <p className="text-[11px] text-outline">avg. present</p>
          </div>
        </div>
        {!loaded ? (
          <Skeleton className="h-28 w-full" />
        ) : (
          <div className="flex h-28 items-end gap-2">
            {trend.map((d) => (
              <div
                key={d.date}
                className="flex h-full flex-1 flex-col items-center justify-end gap-1.5"
              >
                {/* Pixel heights: % heights don't resolve inside a content-sized flex parent */}
                <div
                  className={`w-full max-w-10 rounded-md transition-all duration-500 ${
                    d.count > 0 ? "bg-primary" : "bg-slate-200/80"
                  }`}
                  style={{
                    height: `${d.count > 0 ? Math.max(10, Math.round((d.count / maxTrend) * 84)) : 4}px`,
                  }}
                  title={`${d.count} present on ${d.date}`}
                />
                <span className="text-[11px] font-medium text-outline">{d.label}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Today's activity */}
      <div className="space-y-2 lg:col-span-3">
        <SectionTitle>Today&apos;s activity</SectionTitle>
        {!loaded ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : today.length === 0 ? (
          <EmptyState
            icon={Clock}
            title="Nobody has logged in yet today"
            hint="Sessions will appear here as employees start work."
          />
        ) : (
          <div className="space-y-2">
            {today.map((s) => (
              <Card key={s.id} className="flex items-center justify-between p-4">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">
                    {s.employees.name}{" "}
                    <span className="text-xs font-normal text-outline">{s.employees.emp_id}</span>
                  </p>
                  <p className="mt-0.5 text-sm text-ink-muted">
                    Started {fmtTime(s.started_at)}
                    {s.ended_at ? ` · ended ${fmtTime(s.ended_at)}` : ""}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {s.status === "active" && (
                    <span className="font-mono text-sm font-semibold text-emerald-600">
                      {elapsedSince(s.started_at)}
                    </span>
                  )}
                  {s.status === "active" ? (
                    <Badge tone="emerald">working</Badge>
                  ) : s.status === "pending_approval" ? (
                    <Badge tone="amber">needs approval</Badge>
                  ) : s.status === "denied" ? (
                    <Badge tone="red">denied</Badge>
                  ) : (
                    <Badge tone="slate">{s.status.replace("_", " ")}</Badge>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
      </div>
    </main>
  );
}
