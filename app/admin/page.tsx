"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { istToday } from "@/lib/hooks";
import { fmtTime, elapsedSince } from "@/lib/format";
import type { WorkSession, Employee } from "@/lib/types";

type SessionWithEmp = WorkSession & { employees: Pick<Employee, "name" | "emp_id"> };

export default function AdminDashboard() {
  const [today, setToday] = useState<SessionWithEmp[]>([]);
  const [pendingSessions, setPendingSessions] = useState(0);
  const [pendingLeaves, setPendingLeaves] = useState(0);
  const [employeeCount, setEmployeeCount] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    const supabase = supabaseBrowser();
    async function load() {
      const [sessions, pendS, pendL, emps] = await Promise.all([
        supabase
          .from("work_sessions")
          .select("*, employees!employee_id(name, emp_id)")
          .eq("work_date", istToday())
          .order("started_at"),
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

  return (
    <main className="space-y-4 p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Working now</p>
          <p className="text-2xl font-bold text-emerald-600">{working.length}</p>
        </div>
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Present today</p>
          <p className="text-2xl font-bold">
            {today.filter((s) => s.status !== "denied").length}
            <span className="text-sm font-normal text-slate-400"> / {employeeCount}</span>
          </p>
        </div>
        <Link href="/admin/approvals" className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Location requests</p>
          <p className={`text-2xl font-bold ${pendingSessions ? "text-amber-600" : ""}`}>
            {pendingSessions}
          </p>
        </Link>
        <Link href="/admin/leaves" className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Leave requests</p>
          <p className={`text-2xl font-bold ${pendingLeaves ? "text-amber-600" : ""}`}>
            {pendingLeaves}
          </p>
        </Link>
      </div>

      {(pendingSessions > 0 || pendingLeaves > 0) && (
        <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">
          ⚠️ You have{" "}
          {pendingSessions > 0 && (
            <Link href="/admin/approvals" className="font-bold underline">
              {pendingSessions} location request{pendingSessions > 1 ? "s" : ""}
            </Link>
          )}
          {pendingSessions > 0 && pendingLeaves > 0 && " and "}
          {pendingLeaves > 0 && (
            <Link href="/admin/leaves" className="font-bold underline">
              {pendingLeaves} leave request{pendingLeaves > 1 ? "s" : ""}
            </Link>
          )}{" "}
          waiting for you.
        </div>
      )}

      <div>
        <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Today
        </p>
        <div className="space-y-2">
          {loaded && today.length === 0 && (
            <p className="rounded-2xl bg-white p-6 text-center text-sm text-slate-400 shadow-sm">
              Nobody has logged in yet today
            </p>
          )}
          {today.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between rounded-2xl bg-white p-4 shadow-sm"
            >
              <div>
                <p className="font-semibold">
                  {s.employees.name}{" "}
                  <span className="text-xs font-normal text-slate-400">
                    {s.employees.emp_id}
                  </span>
                </p>
                <p className="text-sm text-slate-500">
                  Started {fmtTime(s.started_at)}
                  {s.ended_at ? ` · ended ${fmtTime(s.ended_at)}` : ""}
                </p>
              </div>
              <div className="text-right">
                {s.status === "active" && (
                  <p className="font-mono text-sm font-bold text-emerald-600">
                    {elapsedSince(s.started_at)}
                  </p>
                )}
                <span
                  className={`text-xs font-medium ${
                    s.status === "active"
                      ? "text-emerald-600"
                      : s.status === "pending_approval"
                        ? "text-amber-600"
                        : s.status === "denied"
                          ? "text-red-600"
                          : "text-slate-500"
                  }`}
                >
                  {s.status === "pending_approval" ? "needs approval" : s.status.replace("_", " ")}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
