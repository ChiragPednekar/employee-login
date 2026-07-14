"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { istToday } from "@/lib/hooks";
import { fmtDate, fmtMinutes, fmtSessionMinutes, fmtTime, SESSION_STATUS_LABEL } from "@/lib/format";
import type { WorkSession, Employee } from "@/lib/types";
import { EmptyState } from "@/components/ui";
import { CalendarX2 } from "lucide-react";

type SessionWithEmp = WorkSession & { employees: Pick<Employee, "name" | "emp_id"> };

export default function AttendancePage() {
  const [month, setMonth] = useState(istToday().slice(0, 7));
  const [sessions, setSessions] = useState<SessionWithEmp[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const from = `${month}-01`;
    const [y, m] = month.split("-").map(Number);
    const to = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;
    const { data } = await supabaseBrowser()
      .from("work_sessions")
      .select("*, employees!employee_id(name, emp_id)")
      .gte("work_date", from)
      .lt("work_date", to)
      .order("work_date", { ascending: false });
    setSessions((data as SessionWithEmp[]) ?? []);
    setLoaded(true);
  }, [month]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Per-employee monthly summary
  const byEmployee = new Map<
    string,
    { name: string; emp_id: string; days: number; total: number; ot: number; rows: SessionWithEmp[] }
  >();
  for (const s of sessions) {
    const key = s.employee_id;
    if (!byEmployee.has(key)) {
      byEmployee.set(key, {
        name: s.employees.name,
        emp_id: s.employees.emp_id,
        days: 0,
        total: 0,
        ot: 0,
        rows: [],
      });
    }
    const e = byEmployee.get(key)!;
    e.rows.push(s);
    if ((s.total_minutes ?? 0) > 0) {
      e.days += 1;
      e.total += s.total_minutes ?? 0;
      e.ot += s.overtime_minutes ?? 0;
    }
  }
  const summary = [...byEmployee.entries()].sort((a, b) =>
    a[1].emp_id.localeCompare(b[1].emp_id)
  );

  function exportCsv() {
    const header = "Emp ID,Name,Date,Start,End,Status,Location OK,Hours,Overtime\n";
    const rows = sessions
      .slice()
      .sort((a, b) => a.employees.emp_id.localeCompare(b.employees.emp_id) || a.work_date.localeCompare(b.work_date))
      .map((s) =>
        [
          s.employees.emp_id,
          `"${s.employees.name}"`,
          s.work_date,
          fmtTime(s.started_at),
          fmtTime(s.ended_at),
          s.status,
          s.start_location_id ? "yes" : "no",
          ((s.total_minutes ?? 0) / 60).toFixed(2),
          ((s.overtime_minutes ?? 0) / 60).toFixed(2),
        ].join(",")
      )
      .join("\n");
    const summaryRows =
      "\n\nEmp ID,Name,Days worked,Total hours,Overtime hours\n" +
      summary
        .map(([, e]) =>
          [e.emp_id, `"${e.name}"`, e.days, (e.total / 60).toFixed(2), (e.ot / 60).toFixed(2)].join(",")
        )
        .join("\n");
    const blob = new Blob([header + rows + summaryRows], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `attendance-${month}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <main className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <input
          type="month"
          aria-label="Select month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-lg border border-line-strong bg-white px-3 py-2 text-sm"
        />
        <button
          onClick={exportCsv}
          disabled={sessions.length === 0}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-40"
        >
          ⬇ Export CSV
        </button>
      </div>

      {loaded && summary.length === 0 && (
        <EmptyState
          icon={CalendarX2}
          title="No attendance in this month"
          hint="Pick another month above."
        />
      )}

      <div className="space-y-2">
        {summary.map(([empId, e]) => (
          <div key={empId} className="overflow-hidden rounded-xl border border-line bg-white">
            <button
              onClick={() => setExpanded(expanded === empId ? null : empId)}
              aria-expanded={expanded === empId}
              aria-label={`${e.name} attendance details`}
              className="flex w-full items-center justify-between p-4 text-left"
            >
              <div>
                <p className="font-bold">
                  {e.name} <span className="text-xs font-normal text-outline">{e.emp_id}</span>
                </p>
                <p className="mt-0.5 text-sm text-ink-muted">
                  {e.days} day{e.days !== 1 ? "s" : ""} · {fmtMinutes(e.total)}
                  {e.ot > 0 && (
                    <span className="font-semibold text-primary"> · +{fmtMinutes(e.ot)} OT</span>
                  )}
                </p>
              </div>
              <span className="text-outline">{expanded === empId ? "▲" : "▼"}</span>
            </button>
            {expanded === empId && (
              <div className="border-t border-line">
                {e.rows.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between border-b border-line/60 px-4 py-2.5 text-sm last:border-0"
                  >
                    <div>
                      <p className="font-medium">{fmtDate(s.work_date)}</p>
                      <p className="text-xs text-ink-muted">
                        {fmtTime(s.started_at)} – {fmtTime(s.ended_at)}
                        {!s.start_location_id && " · ⚠️ unlisted location"}
                        {s.end_out_of_range && " · ⚠️ ended out of range"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{fmtSessionMinutes(s.total_minutes, s.status)}</p>
                      <p className="text-xs text-outline">{SESSION_STATUS_LABEL[s.status]}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
