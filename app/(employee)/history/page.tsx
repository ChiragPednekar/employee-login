"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useMe } from "@/lib/hooks";
import { fmtDate, fmtMinutes, fmtSessionMinutes, fmtTime } from "@/lib/format";
import type { WorkSession, WorkLocation } from "@/lib/types";
import { Card, StatCard, Badge, Skeleton, EmptyState } from "@/components/ui";
import { CalendarDays, Clock, TrendingUp, MapPin, CalendarX2 } from "lucide-react";

const STATUS_TONE: Record<string, "emerald" | "amber" | "red" | "slate"> = {
  completed: "emerald",
  active: "emerald",
  pending_approval: "amber",
  auto_closed: "amber",
  denied: "red",
};

const STATUS_LABEL: Record<string, string> = {
  pending_approval: "pending",
  active: "working",
  completed: "completed",
  auto_closed: "auto-closed",
  denied: "denied",
};

export default function HistoryPage() {
  const { me } = useMe();
  const [sessions, setSessions] = useState<WorkSession[]>([]);
  const [locations, setLocations] = useState<Record<string, WorkLocation>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!me) return;
    const supabase = supabaseBrowser();
    Promise.all([
      supabase
        .from("work_sessions")
        .select("*")
        .eq("employee_id", me.id)
        .order("work_date", { ascending: false })
        .limit(60),
      supabase.from("locations").select("*"),
    ]).then(([{ data: s }, { data: locs }]) => {
      setSessions(s ?? []);
      setLocations(Object.fromEntries((locs ?? []).map((l: WorkLocation) => [l.id, l])));
      setLoaded(true);
    });
  }, [me]);

  const thisMonth = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }).slice(0, 7);
  const monthSessions = sessions.filter(
    (s) => s.work_date.startsWith(thisMonth) && (s.total_minutes ?? 0) > 0
  );
  const totalMin = monthSessions.reduce((a, s) => a + (s.total_minutes ?? 0), 0);
  const otMin = monthSessions.reduce((a, s) => a + (s.overtime_minutes ?? 0), 0);

  return (
    <main className="space-y-6 p-4 md:p-6">
      {/* Month summary */}
      {!loaded ? (
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[120px]" />
          ))}
        </div>
      ) : (
        <section className="grid grid-cols-3 gap-4">
          <StatCard label="Days" value={monthSessions.length} icon={CalendarDays} tone="primary" />
          <StatCard label="Hours" value={Math.floor(totalMin / 60)} icon={Clock} tone="slate" />
          <StatCard
            label="Overtime"
            value={fmtMinutes(otMin)}
            icon={TrendingUp}
            tone="primary"
            highlight={otMin > 0}
          />
        </section>
      )}
      <p className="px-0.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
        This month · {thisMonth}
      </p>

      {/* Attendance log */}
      {!loaded ? (
        <Skeleton className="h-64 w-full" />
      ) : sessions.length === 0 ? (
        <EmptyState
          icon={CalendarX2}
          title="No attendance yet"
          hint="Your work sessions will appear here."
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="border-b border-line bg-slate-50/50 px-5 py-3.5">
            <h2 className="text-base font-semibold tracking-tight text-ink">Attendance Log</h2>
          </div>
          <div className="divide-y divide-line">
            {sessions.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">{fmtDate(s.work_date)}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-[13px] text-ink-muted">
                    {fmtTime(s.started_at)} – {fmtTime(s.ended_at)}
                    <span className="text-outline">·</span>
                    <MapPin size={12} className="shrink-0" />
                    {s.start_location_id && locations[s.start_location_id]
                      ? locations[s.start_location_id].name
                      : "Unlisted"}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <p className="text-sm font-semibold tabular-nums text-ink">
                    {fmtSessionMinutes(s.total_minutes, s.status)}
                    {(s.overtime_minutes ?? 0) > 0 && (
                      <span className="text-primary"> +{fmtMinutes(s.overtime_minutes)}</span>
                    )}
                  </p>
                  <Badge tone={STATUS_TONE[s.status] ?? "slate"}>
                    {STATUS_LABEL[s.status] ?? s.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </main>
  );
}
