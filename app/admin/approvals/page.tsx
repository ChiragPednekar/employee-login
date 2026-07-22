"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { nudgePushProcessor } from "@/lib/hooks";
import { fmtDate, fmtTime } from "@/lib/format";
import type { WorkSession, Employee } from "@/lib/types";
import { EmptyState } from "@/components/ui";
import { MapPinCheck } from "lucide-react";

type PendingSession = WorkSession & {
  start_lat: number | null;
  start_lng: number | null;
  end_lat: number | null;
  end_lng: number | null;
  employees: Pick<Employee, "name" | "emp_id" | "contact">;
};

export default function ApprovalsPage() {
  const [pending, setPending] = useState<PendingSession[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data } = await supabaseBrowser()
      .from("work_sessions")
      .select("*, employees!employee_id(name, emp_id, contact)")
      .eq("status", "pending_approval")
      .order("requested_at", { nullsFirst: false });
    setPending((data as PendingSession[]) ?? []);
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
    const { error } = await supabaseBrowser().rpc("decide_session", {
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

  return (
    <main className="space-y-3 p-4">
      <h1 className="px-1 text-lg font-bold">Check-in / check-out permission requests</h1>
      {error && <p className="rounded-lg bg-danger-tint p-3 text-sm text-danger-deep">{error}</p>}
      {loaded && pending.length === 0 && (
        <EmptyState
          icon={MapPinCheck}
          title="No pending requests 🎉"
          hint="Check-ins and check-outs refused by the geofence appear here for your permission."
        />
      )}
      {pending.map((s) => {
        const isCheckOut = s.pending_kind === "check_out";
        const lat = isCheckOut ? s.end_lat : s.start_lat;
        const lng = isCheckOut ? s.end_lng : s.start_lng;
        const distance = isCheckOut ? s.end_distance_m : s.start_distance_m;
        return (
        <div key={s.id} className="rounded-xl border border-line bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-bold">
                {s.employees.name}{" "}
                <span className="text-xs font-normal text-outline">{s.employees.emp_id}</span>
              </p>
              <p className="mt-0.5 text-sm text-ink-muted">
                {fmtDate(s.work_date)} · pressed {isCheckOut ? "Clock Out" : "Clock In"} at{" "}
                {fmtTime(s.requested_at)}
                {distance != null ? ` · ${Math.round(distance)} m from the office` : ""}
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                {isCheckOut
                  ? `Still clocked in since ${fmtTime(s.started_at)}. Approving stops the timer now and saves their hours.`
                  : "Their timer has not started. Approving starts it from this moment."}
              </p>
              {s.employees.contact && (
                <a href={`tel:${s.employees.contact}`} className="text-sm text-primary">
                  📞 {s.employees.contact}
                </a>
              )}
            </div>
            <span
              className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${
                isCheckOut ? "bg-amber-100 text-amber-800" : "bg-primary-tint text-primary-deep"
              }`}
            >
              {isCheckOut ? "Check-out" : "Check-in"}
            </span>
          </div>
          {lat != null && lng != null && (
            <a
              href={`https://www.google.com/maps?q=${lat},${lng}`}
              target="_blank"
              rel="noreferrer"
              className="mt-2 block rounded-xl bg-slate-50 p-3 text-sm text-primary"
            >
              📍 Where they pressed it — view on Google Maps →
            </a>
          )}
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => decide(s.id, false)}
              disabled={busyId === s.id}
              className="h-10 flex-1 rounded-lg border border-line-strong text-sm font-semibold uppercase tracking-wide text-ink-muted transition-colors hover:border-danger hover:text-danger disabled:opacity-50"
            >
              Deny
            </button>
            <button
              onClick={() => decide(s.id, true)}
              disabled={busyId === s.id}
              className="h-10 flex-1 rounded-lg bg-primary text-sm font-semibold uppercase tracking-wide text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              Approve
            </button>
          </div>
        </div>
        );
      })}
    </main>
  );
}
