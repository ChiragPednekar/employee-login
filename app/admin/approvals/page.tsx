"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { nudgePushProcessor } from "@/lib/hooks";
import { fmtDate, fmtTime } from "@/lib/format";
import type { WorkSession, Employee } from "@/lib/types";

type PendingSession = WorkSession & {
  start_lat: number;
  start_lng: number;
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
      .order("started_at");
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
      <h1 className="px-1 text-lg font-bold">Location approval requests</h1>
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {loaded && pending.length === 0 && (
        <p className="rounded-2xl bg-white p-8 text-center text-sm text-slate-400 shadow-sm">
          No pending requests 🎉
        </p>
      )}
      {pending.map((s) => (
        <div key={s.id} className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="font-bold">
                {s.employees.name}{" "}
                <span className="text-xs font-normal text-slate-400">{s.employees.emp_id}</span>
              </p>
              <p className="mt-0.5 text-sm text-slate-500">
                {fmtDate(s.work_date)} · pressed Start at {fmtTime(s.started_at)}
                {s.ended_at ? ` · pressed Done at ${fmtTime(s.ended_at)}` : " · still working"}
              </p>
              {s.employees.contact && (
                <a href={`tel:${s.employees.contact}`} className="text-sm text-indigo-600">
                  📞 {s.employees.contact}
                </a>
              )}
            </div>
          </div>
          <a
            href={`https://www.google.com/maps?q=${s.start_lat},${s.start_lng}`}
            target="_blank"
            rel="noreferrer"
            className="mt-2 block rounded-xl bg-slate-50 p-3 text-sm text-indigo-600"
          >
            📍 View their location on Google Maps →
          </a>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => decide(s.id, false)}
              disabled={busyId === s.id}
              className="flex-1 rounded-xl border border-red-200 py-2.5 font-semibold text-red-600 disabled:opacity-50"
            >
              Deny
            </button>
            <button
              onClick={() => decide(s.id, true)}
              disabled={busyId === s.id}
              className="flex-1 rounded-xl bg-emerald-600 py-2.5 font-semibold text-white disabled:opacity-50"
            >
              Approve
            </button>
          </div>
        </div>
      ))}
    </main>
  );
}
