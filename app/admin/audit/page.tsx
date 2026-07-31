"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { istToday } from "@/lib/hooks";
import { fmtDate, fmtTime, fmtMinutes } from "@/lib/format";
import type { WorkSession, Employee, LeaveRequest, Holiday, LeaveBalanceRow } from "@/lib/types";
import {
  monthRange,
  sessionFlags,
  isLate,
  lateLabel,
  DEFAULT_SHIFT_POLICY,
  type ShiftPolicy,
  FLAG_LABEL,
  FLAG_TONE,
  type SessionFlag,
} from "@/lib/analytics";
import { Card, Badge, EmptyState, SectionTitle, Skeleton } from "@/components/ui";
import { ShieldCheck, MapPin, FileDown } from "lucide-react";

type Row = WorkSession & {
  start_lat: number;
  start_lng: number;
  decided_by: string | null;
  decided_at: string | null;
  emp: Pick<Employee, "name" | "emp_id"> | null;
  decider: Pick<Employee, "name"> | null;
};

const FILTERS: { key: SessionFlag | "all"; label: string }[] = [
  { key: "all", label: "All flags" },
  { key: "unlisted_start", label: "Unlisted" },
  { key: "offsite_override", label: "Overrides" },
  { key: "out_of_range_end", label: "Out of range" },
  { key: "auto_closed", label: "Auto-closed" },
  { key: "denied", label: "Denied" },
];

export default function AuditPage() {
  const [month, setMonth] = useState(istToday().slice(0, 7));
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState<SessionFlag | "all">("all");
  const [loaded, setLoaded] = useState(false);
  // Per-employee monthly report
  const [emps, setEmps] = useState<Pick<Employee, "id" | "name" | "emp_id" | "department">[]>([]);
  const [reportEmp, setReportEmp] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  useEffect(() => {
    supabaseBrowser()
      .from("employees")
      .select("id, name, emp_id, department")
      .eq("active", true)
      .order("emp_id")
      .then(({ data }) => setEmps(data ?? []));
  }, []);

  const refresh = useCallback(async () => {
    setLoaded(false);
    const { from, to } = monthRange(month);
    const { data } = await supabaseBrowser()
      .from("work_sessions")
      .select(
        "*, emp:employees!work_sessions_employee_id_fkey(name, emp_id), decider:employees!work_sessions_decided_by_fkey(name)"
      )
      .gte("work_date", from)
      .lt("work_date", to)
      .order("started_at", { ascending: false });
    setRows((data as Row[]) ?? []);
    setLoaded(true);
  }, [month]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const flagged = useMemo(
    () =>
      rows
        .map((r) => ({ r, flags: sessionFlags(r) }))
        .filter((x) => x.flags.length > 0)
        .filter((x) => filter === "all" || x.flags.includes(filter)),
    [rows, filter]
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) for (const f of sessionFlags(r)) c[f] = (c[f] ?? 0) + 1;
    return c;
  }, [rows]);

  /** One printable document with the employee's entire month: every day's
   *  status and times, leaves, anomalies, and totals. Print → Save as PDF. */
  async function downloadEmployeeReport() {
    const emp = emps.find((e) => e.id === reportEmp);
    if (!emp) return;
    // Open the window synchronously in the click gesture — after an await the
    // pop-up blocker eats it. Fill it in once the data arrives.
    const w = window.open("", "_blank");
    if (!w) {
      setReportError("Your browser blocked the report window — allow pop-ups for this site.");
      return;
    }
    w.document.write(
      '<p style="font-family:sans-serif;color:#64748b;margin:32px">Preparing report…</p>'
    );
    setReportBusy(true);
    setReportError(null);
    const supabase = supabaseBrowser();
    const { from, to } = monthRange(month);

    const [sessRes, leaveRes, holRes, swRes, setRes, balRes] = await Promise.all([
      supabase
        .from("work_sessions")
        .select("*")
        .eq("employee_id", emp.id)
        .gte("work_date", from)
        .lt("work_date", to),
      supabase
        .from("leave_requests")
        .select("*")
        .eq("employee_id", emp.id)
        .lt("start_date", to)
        .gte("end_date", from)
        .in("status", ["approved", "pending"])
        .order("start_date"),
      supabase.from("holidays").select("*").gte("holiday_date", from).lt("holiday_date", to),
      supabase
        .from("sandwich_leaves")
        .select("sunday_date")
        .eq("employee_id", emp.id)
        .gte("sunday_date", from)
        .lt("sunday_date", to),
      supabase
        .from("app_settings")
        .select("shift_start, shift_end, late_grace_min, early_departure_grace_min")
        .maybeSingle(),
      supabase.rpc("leave_balances_all"),
    ]);
    setReportBusy(false);
    const firstErr = [sessRes, leaveRes, holRes, swRes, setRes].find((r) => r.error)?.error;
    if (firstErr) {
      w.close();
      setReportError(firstErr.message);
      return;
    }

    const sessions = (sessRes.data ?? []) as WorkSession[];
    const leaves = (leaveRes.data ?? []) as LeaveRequest[];
    const holidays = (holRes.data ?? []) as Holiday[];
    const sandwich = new Set(((swRes.data ?? []) as { sunday_date: string }[]).map((s) => s.sunday_date));
    const policy: ShiftPolicy = (setRes.data as ShiftPolicy) ?? DEFAULT_SHIFT_POLICY;
    const balance = ((balRes.data ?? []) as LeaveBalanceRow[]).find((b) => b.employee_id === emp.id);

    const sessionByDate = new Map(sessions.map((s) => [s.work_date, s]));
    const holidayByDate = new Map(holidays.map((h) => [h.holiday_date, h.name]));
    const approvedOn = (date: string) =>
      leaves.find((l) => l.status === "approved" && l.start_date <= date && l.end_date >= date);

    const [y, m] = month.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const today = istToday();
    const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    let presentDays = 0, totalMin = 0, otMin = 0, lateCount = 0, leaveDays = 0, absentDays = 0;
    const dayRows: string[] = [];

    for (let d = 1; d <= lastDay; d++) {
      const date = `${month}-${String(d).padStart(2, "0")}`;
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      const s = sessionByDate.get(date);
      const lv = approvedOn(date);
      const hol = holidayByDate.get(date);
      let status = "", tIn = "", tOut = "", hrs = "", ot = "";
      const notes: string[] = [];

      if (s && (s.started_at || s.status === "pending_approval" || s.status === "denied")) {
        status =
          s.status === "completed" ? "Worked"
          : s.status === "active" ? "Working now"
          : s.status === "auto_closed" ? "Worked (auto-closed)"
          : s.status === "pending_approval" ? "Awaiting permission"
          : "Check-in denied";
        tIn = s.started_at ? fmtTime(s.started_at) : "—";
        tOut = s.ended_at ? fmtTime(s.ended_at) : s.status === "active" ? "…" : "—";
        if ((s.total_minutes ?? 0) > 0) {
          presentDays += 1;
          totalMin += s.total_minutes ?? 0;
          otMin += s.overtime_minutes ?? 0;
          hrs = fmtMinutes(s.total_minutes ?? 0);
          if ((s.overtime_minutes ?? 0) > 0) ot = fmtMinutes(s.overtime_minutes ?? 0);
        }
        if (isLate(s, policy)) {
          lateCount += 1;
          notes.push("Late");
        }
        for (const f of sessionFlags(s)) notes.push(FLAG_LABEL[f]);
        if (lv && lv.day_part !== "full") {
          leaveDays += 0.5;
          notes.push(`Half-day leave (${lv.day_part === "first_half" ? "first" : "second"} half)`);
        }
      } else if (lv) {
        const half = lv.day_part !== "full";
        leaveDays += half ? 0.5 : 1;
        status = half ? `Leave (${lv.day_part === "first_half" ? "first" : "second"} half)` : "Leave";
      } else if (hol) {
        status = `Holiday — ${hol}`;
      } else if (dow === 0) {
        status = sandwich.has(date) ? "Sunday — unpaid (sandwich rule)" : "Weekly off";
      } else if (date > today) {
        status = "—";
      } else {
        status = "Absent";
        absentDays += 1;
      }

      dayRows.push(`<tr${dow === 0 || hol ? ' class="dim"' : ""}>
        <td>${d} ${new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}</td>
        <td>${WD[dow]}</td><td>${escapeHtml(status)}</td>
        <td class="num">${tIn}</td><td class="num">${tOut}</td>
        <td class="num">${hrs}</td><td class="num">${ot}</td>
        <td>${escapeHtml(notes.join(" · "))}</td></tr>`);
    }

    const leaveRows = leaves
      .map(
        (l) => `<tr>
        <td>${fmtDate(l.start_date)}${l.end_date !== l.start_date ? " → " + fmtDate(l.end_date) : ""}</td>
        <td>${l.day_part === "full" ? "Full day" : l.day_part === "first_half" ? "First half" : "Second half"}</td>
        <td class="num">${l.days}</td>
        <td class="num">${l.paid_days ?? "—"}</td>
        <td class="num">${l.unpaid_days ?? "—"}</td>
        <td>${l.status}</td>
        <td>${escapeHtml(l.reason)}</td></tr>`
      )
      .join("");

    const title = new Date(`${from}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    const html = `<!doctype html><html><head><meta charset="utf-8">
      <title>${escapeHtml(emp.name)} — Audit ${title}</title>
      <style>
        body{font-family:-apple-system,Inter,Arial,sans-serif;color:#131b2e;margin:32px;font-feature-settings:'tnum'}
        h1{font-size:20px;margin:0} .sub{color:#64748b;margin:4px 0 20px;font-size:13px}
        .kpis{display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap}
        .kpi{border:1px solid #e2e8f0;border-radius:12px;padding:12px 16px;min-width:110px}
        .kpi .l{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#64748b}
        .kpi .v{font-size:20px;font-weight:600;margin-top:4px}
        h2{font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin:22px 0 8px}
        table{width:100%;border-collapse:collapse;font-size:12px}
        th{text-align:left;border-bottom:2px solid #e2e8f0;padding:6px;color:#434656;font-size:10px;text-transform:uppercase;letter-spacing:.04em}
        td{border-bottom:1px solid #eef0f5;padding:6px}
        .num{text-align:right}
        tr.dim td{color:#94a3b8}
        .foot{margin-top:24px;font-size:11px;color:#94a3b8}
        @media print{body{margin:10mm}}
      </style></head><body>
      <h1>WorkLog — Employee Monthly Audit</h1>
      <div class="sub">
        <b>${escapeHtml(emp.name)}</b> (${emp.emp_id})${emp.department ? " · " + escapeHtml(emp.department) : ""}
        · ${title} · generated ${new Date().toLocaleDateString("en-IN")}
        · Late = clock-in ${lateLabel(policy)}
      </div>
      <div class="kpis">
        <div class="kpi"><div class="l">Days present</div><div class="v">${presentDays}</div></div>
        <div class="kpi"><div class="l">Total hours</div><div class="v">${(totalMin / 60).toFixed(1)}h</div></div>
        <div class="kpi"><div class="l">Overtime</div><div class="v">${(otMin / 60).toFixed(1)}h</div></div>
        <div class="kpi"><div class="l">Late arrivals</div><div class="v">${lateCount}</div></div>
        <div class="kpi"><div class="l">Leave days</div><div class="v">${leaveDays}</div></div>
        <div class="kpi"><div class="l">Absent</div><div class="v">${absentDays}</div></div>
      </div>
      <h2>Day by day</h2>
      <table><thead><tr><th>Date</th><th>Day</th><th>Status</th><th class="num">In</th><th class="num">Out</th><th class="num">Hours</th><th class="num">OT</th><th>Notes</th></tr></thead>
      <tbody>${dayRows.join("")}</tbody></table>
      <h2>Leave requests touching this month</h2>
      <table><thead><tr><th>Dates</th><th>Type</th><th class="num">Days</th><th class="num">Paid</th><th class="num">Unpaid</th><th>Status</th><th>Reason</th></tr></thead>
      <tbody>${leaveRows || '<tr><td colspan="7">None</td></tr>'}</tbody></table>
      ${
        balance
          ? `<div class="foot">Paid-leave balance right now: <b>${balance.total_available}</b> day(s)
             (this month ${balance.current_days} + carried ${balance.carried_days})
             · taken this year: ${balance.taken_this_year}
             ${balance.pending_days > 0 ? ` · ${balance.pending_days} day(s) pending approval` : ""}</div>`
          : ""
      }
      <div class="foot">WorkLog · location-based attendance. "Absent" = a working day with no logged session and no approved leave.</div>
      </body></html>`;

    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
  }

  return (
    <main className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Audit trail</h1>
          <p className="text-xs text-ink-muted">Attendance anomalies &amp; manual decisions</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="month"
            aria-label="Select month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="h-9 rounded-lg border border-line-strong bg-white px-3 text-sm"
          />
          <select
            aria-label="Employee for monthly report"
            value={reportEmp}
            onChange={(e) => setReportEmp(e.target.value)}
            className="h-9 max-w-[180px] rounded-lg border border-line-strong bg-white px-2.5 text-sm"
          >
            <option value="">Employee report…</option>
            {emps.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({e.emp_id})
              </option>
            ))}
          </select>
          <button
            onClick={downloadEmployeeReport}
            disabled={!reportEmp || reportBusy}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-line-strong bg-white px-3.5 text-sm font-semibold text-ink transition-colors hover:bg-surface-low disabled:opacity-40"
          >
            <FileDown size={15} />
            {reportBusy ? "Preparing…" : "Download"}
          </button>
        </div>
      </div>
      {reportError && (
        <p className="rounded-lg bg-danger-tint px-3 py-2 text-sm text-danger-deep">{reportError}</p>
      )}

      {/* Filter chips */}
      <div className="scrollbar-none flex gap-1.5 overflow-x-auto pb-0.5">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          const n = f.key === "all" ? Object.values(counts).reduce((a, b) => a + b, 0) : counts[f.key] ?? 0;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                active ? "bg-primary text-white" : "bg-white text-ink-muted hover:bg-surface-low"
              } border ${active ? "border-primary" : "border-line-strong"}`}
            >
              {f.label}
              <span
                className={`rounded px-1.5 text-[11px] tabular-nums ${
                  active ? "bg-white/20" : "bg-surface-low text-outline"
                }`}
              >
                {n}
              </span>
            </button>
          );
        })}
      </div>

      {!loaded ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : flagged.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No anomalies for this filter"
          hint="Clean records for the selected month 🎉"
        />
      ) : (
        <div className="space-y-2">
          <SectionTitle>
            {flagged.length} flagged session{flagged.length !== 1 ? "s" : ""}
          </SectionTitle>
          <Card className="overflow-hidden">
            <div className="divide-y divide-line">
              {flagged.map(({ r, flags }) => (
                <div key={r.id} className="px-4 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">
                        {r.emp?.name ?? "—"}{" "}
                        <span className="text-xs font-normal text-outline">{r.emp?.emp_id}</span>
                      </p>
                      <p className="mt-0.5 text-[13px] text-ink-muted">
                        {fmtDate(r.work_date)} · {fmtTime(r.started_at)}
                        {r.ended_at ? ` – ${fmtTime(r.ended_at)}` : " · running"}
                        {(r.total_minutes ?? 0) > 0 ? ` · ${fmtMinutes(r.total_minutes)}` : ""}
                      </p>
                    </div>
                    <a
                      href={`https://www.google.com/maps?q=${r.start_lat},${r.start_lng}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
                    >
                      <MapPin size={13} />
                      Map
                    </a>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {flags.map((f) => (
                      <Badge key={f} tone={FLAG_TONE[f]}>
                        {FLAG_LABEL[f]}
                      </Badge>
                    ))}
                    {r.decider?.name && r.decided_at && (
                      <span className="text-[11px] text-outline">
                        · {r.status === "denied" ? "denied" : "decided"} by {r.decider.name} on{" "}
                        {fmtDate(r.decided_at)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </main>
  );
}

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
