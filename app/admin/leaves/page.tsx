"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { nudgePushProcessor } from "@/lib/hooks";
import { fmtDate } from "@/lib/format";
import type { LeaveRequest, Employee } from "@/lib/types";

type LeaveWithEmp = LeaveRequest & { employees: Pick<Employee, "name" | "emp_id"> };

const DAY_PART_LABEL = { full: "Full day", first_half: "First half", second_half: "Second half" };

export default function LeavesAdminPage() {
  const [pending, setPending] = useState<LeaveWithEmp[]>([]);
  const [recent, setRecent] = useState<LeaveWithEmp[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const supabase = supabaseBrowser();
    const [{ data: p }, { data: r }] = await Promise.all([
      supabase
        .from("leave_requests")
        .select("*, employees!employee_id(name, emp_id)")
        .eq("status", "pending")
        .order("created_at"),
      supabase
        .from("leave_requests")
        .select("*, employees!employee_id(name, emp_id)")
        .neq("status", "pending")
        .order("decided_at", { ascending: false })
        .limit(15),
    ]);
    setPending((p as LeaveWithEmp[]) ?? []);
    setRecent((r as LeaveWithEmp[]) ?? []);
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, 20000);
    return () => clearInterval(poll);
  }, [refresh]);

  async function decide(id: string, approve: boolean) {
    setBusyId(id);
    setError(null);
    const { error } = await supabaseBrowser().rpc("decide_leave", {
      p_id: id,
      p_approve: approve,
    });
    setBusyId(null);
    if (error) {
      setError(error.message);
      return;
    }
    nudgePushProcessor();
    refresh();
  }

  function LeaveCard({ r, actions }: { r: LeaveWithEmp; actions?: boolean }) {
    return (
      <div className="rounded-xl border border-line bg-white p-4">
        <div className="flex items-center justify-between">
          <p className="font-bold">
            {r.employees.name}{" "}
            <span className="text-xs font-normal text-outline">{r.employees.emp_id}</span>
          </p>
          {!actions && (
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                r.status === "approved"
                  ? "bg-success-chip text-success-deep"
                  : "bg-danger-tint text-danger-deep"
              }`}
            >
              {r.status}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-ink-muted">
          {fmtDate(r.start_date)}
          {r.end_date !== r.start_date && ` → ${fmtDate(r.end_date)}`} ·{" "}
          {DAY_PART_LABEL[r.day_part]} · <b>{r.days} day{r.days !== 1 ? "s" : ""}</b>
        </p>
        <p className="mt-2 rounded-lg bg-slate-50 p-2.5 text-sm text-ink-muted">“{r.reason}”</p>
        {actions && (
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => decide(r.id, false)}
              disabled={busyId === r.id}
              className="h-10 flex-1 rounded-lg border border-line-strong text-sm font-semibold uppercase tracking-wide text-ink-muted transition-colors hover:border-danger hover:text-danger disabled:opacity-50"
            >
              Deny
            </button>
            <button
              onClick={() => decide(r.id, true)}
              disabled={busyId === r.id}
              className="h-10 flex-1 rounded-lg bg-primary text-sm font-semibold uppercase tracking-wide text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              Approve
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <main className="space-y-3 p-4">
      <h1 className="px-1 text-lg font-bold">Leave requests</h1>
      {error && <p className="rounded-lg bg-danger-tint p-3 text-sm text-danger-deep">{error}</p>}
      {loaded && pending.length === 0 && (
        <p className="rounded-xl border border-dashed border-line-strong bg-white p-8 text-center text-sm text-ink-muted">
          No pending leave requests 🎉
        </p>
      )}
      {pending.map((r) => (
        <LeaveCard key={r.id} r={r} actions />
      ))}

      {recent.length > 0 && (
        <>
          <p className="px-1 pt-3 text-xs font-semibold uppercase tracking-wide text-outline">
            Recently decided
          </p>
          {recent.map((r) => (
            <LeaveCard key={r.id} r={r} />
          ))}
        </>
      )}
    </main>
  );
}
