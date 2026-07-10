"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useMe } from "@/lib/hooks";
import { fmtDate, fmtMinutes, fmtTime, SESSION_STATUS_LABEL } from "@/lib/format";
import type { WorkSession, WorkLocation } from "@/lib/types";

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
    <main className="space-y-4 p-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Days</p>
          <p className="text-xl font-bold">{monthSessions.length}</p>
        </div>
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Hours</p>
          <p className="text-xl font-bold">{Math.floor(totalMin / 60)}</p>
        </div>
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Overtime</p>
          <p className="text-xl font-bold text-indigo-600">{fmtMinutes(otMin)}</p>
        </div>
      </div>
      <p className="px-1 text-xs text-slate-400">This month · {thisMonth}</p>

      <div className="space-y-2">
        {!loaded && <p className="p-4 text-center text-slate-400">Loading…</p>}
        {loaded && sessions.length === 0 && (
          <p className="p-4 text-center text-slate-400">No attendance yet</p>
        )}
        {sessions.map((s) => (
          <div key={s.id} className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="font-semibold">{fmtDate(s.work_date)}</p>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  s.status === "completed"
                    ? "bg-emerald-100 text-emerald-700"
                    : s.status === "denied"
                      ? "bg-red-100 text-red-700"
                      : s.status === "auto_closed"
                        ? "bg-orange-100 text-orange-700"
                        : "bg-amber-100 text-amber-700"
                }`}
              >
                {SESSION_STATUS_LABEL[s.status]}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {fmtTime(s.started_at)} – {fmtTime(s.ended_at)}
              {s.start_location_id && locations[s.start_location_id]
                ? ` · ${locations[s.start_location_id].name}`
                : " · Unlisted location"}
            </p>
            <div className="mt-2 flex gap-4 text-sm">
              <span className="font-semibold">{fmtMinutes(s.total_minutes)}</span>
              {(s.overtime_minutes ?? 0) > 0 && (
                <span className="font-semibold text-indigo-600">
                  +{fmtMinutes(s.overtime_minutes)} OT
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
