"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { istToday } from "@/lib/hooks";
import { fmtDate, fmtTime, fmtMinutes } from "@/lib/format";
import type { WorkSession, Employee } from "@/lib/types";
import {
  monthRange,
  sessionFlags,
  FLAG_LABEL,
  FLAG_TONE,
  type SessionFlag,
} from "@/lib/analytics";
import { Card, Badge, EmptyState, SectionTitle, Skeleton } from "@/components/ui";
import { ShieldCheck, MapPin } from "lucide-react";

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

  return (
    <main className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Audit trail</h1>
          <p className="text-xs text-ink-muted">Attendance anomalies &amp; manual decisions</p>
        </div>
        <input
          type="month"
          aria-label="Select month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="h-9 rounded-lg border border-line-strong bg-white px-3 text-sm"
        />
      </div>

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
