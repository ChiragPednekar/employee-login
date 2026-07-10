"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useMe, istToday, getPosition, geoErrorMessage, nudgePushProcessor } from "@/lib/hooks";
import { elapsedSince, fmtMinutes, fmtTime, SESSION_STATUS_LABEL } from "@/lib/format";
import type { WorkSession, WorkLocation } from "@/lib/types";
import ConfirmDialog from "@/components/ConfirmDialog";

export default function HomePage() {
  const { me } = useMe();
  const [session, setSession] = useState<WorkSession | null>(null);
  const [locations, setLocations] = useState<Record<string, WorkLocation>>({});
  const [loaded, setLoaded] = useState(false);
  const [confirming, setConfirming] = useState<"start" | "end" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const meId = me?.id;

  const refresh = useCallback(async () => {
    if (!meId) return;
    const supabase = supabaseBrowser();
    const [{ data: s }, { data: locs }] = await Promise.all([
      supabase
        .from("work_sessions")
        .select("*")
        .eq("employee_id", meId)
        .eq("work_date", istToday())
        .maybeSingle(),
      supabase.from("locations").select("*").eq("active", true),
    ]);
    setSession(s ?? null);
    setLocations(Object.fromEntries((locs ?? []).map((l: WorkLocation) => [l.id, l])));
    setLoaded(true);
  }, [meId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll while a session is pending/active; tick the timer every second
  const status = session?.status;
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    let poll: ReturnType<typeof setInterval> | undefined;
    if (status === "pending_approval" || status === "active") {
      poll = setInterval(refresh, 15000);
    }
    return () => {
      clearInterval(timer);
      if (poll) clearInterval(poll);
    };
  }, [status, refresh]);

  async function doStart() {
    setBusy(true);
    setError(null);
    try {
      const pos = await getPosition();
      const { data, error } = await supabaseBrowser().rpc("start_session", {
        p_lat: pos.coords.latitude,
        p_lng: pos.coords.longitude,
      });
      if (error) throw new Error(error.message);
      setSession(data as WorkSession);
      nudgePushProcessor();
    } catch (e) {
      setError(geoErrorMessage(e));
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  async function doEnd() {
    setBusy(true);
    setError(null);
    try {
      const pos = await getPosition();
      const { data, error } = await supabaseBrowser().rpc("end_session", {
        p_lat: pos.coords.latitude,
        p_lng: pos.coords.longitude,
      });
      if (error) throw new Error(error.message);
      setSession(data as WorkSession);
      nudgePushProcessor();
    } catch (e) {
      setError(geoErrorMessage(e));
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  if (!loaded) {
    return <main className="p-6 text-center text-slate-400">Loading…</main>;
  }

  const running = session && !session.ended_at && (session.status === "active" || session.status === "pending_approval");
  const elapsedMs = session ? Date.now() - new Date(session.started_at).getTime() : 0;
  const over11h = running && elapsedMs > 11 * 3600 * 1000;
  void tick;

  return (
    <main className="space-y-4 p-4">
      {/* Big status circle */}
      <div className="flex flex-col items-center rounded-3xl bg-white p-8 shadow-sm">
        {!session && (
          <>
            <p className="mb-6 text-sm text-slate-500">You haven&apos;t logged work today</p>
            <button
              onClick={() => setConfirming("start")}
              className="flex h-44 w-44 items-center justify-center rounded-full bg-indigo-600 text-xl font-bold text-white shadow-xl shadow-indigo-200 transition active:scale-95"
            >
              Start
              <br />
            </button>
            <p className="mt-6 text-xs text-slate-400">
              Your location will be checked when you start
            </p>
          </>
        )}

        {session && running && (
          <>
            <span
              className={`mb-3 rounded-full px-3 py-1 text-xs font-semibold ${
                session.status === "active"
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-amber-100 text-amber-700"
              }`}
            >
              {SESSION_STATUS_LABEL[session.status]}
            </span>
            <p className="font-mono text-5xl font-bold tabular-nums">
              {elapsedSince(session.started_at)}
            </p>
            <p className="mt-2 text-sm text-slate-500">
              Started at {fmtTime(session.started_at)}
              {session.start_location_id && locations[session.start_location_id]
                ? ` · ${locations[session.start_location_id].name}`
                : ""}
            </p>
            {session.status === "pending_approval" && (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-center text-xs text-amber-800">
                You&apos;re not at an approved location. The admin has been notified — your time
                is counting from when you pressed Start and will be confirmed once approved.
              </p>
            )}
            {over11h && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-center text-xs font-semibold text-red-700">
                ⚠️ You&apos;ve been logged in for over 11 hours. The session auto-closes at 12 hours.
              </p>
            )}
            <button
              onClick={() => setConfirming("end")}
              className="mt-6 w-full rounded-2xl bg-slate-900 py-4 text-lg font-bold text-white transition active:scale-[0.98]"
            >
              Work Done
            </button>
          </>
        )}

        {session && !running && (
          <>
            <span
              className={`mb-3 rounded-full px-3 py-1 text-xs font-semibold ${
                session.status === "denied"
                  ? "bg-red-100 text-red-700"
                  : "bg-slate-200 text-slate-700"
              }`}
            >
              {SESSION_STATUS_LABEL[session.status]}
            </span>
            {session.status !== "denied" ? (
              <>
                <p className="text-4xl font-bold">{fmtMinutes(session.total_minutes)}</p>
                <p className="mt-2 text-sm text-slate-500">
                  {fmtTime(session.started_at)} – {fmtTime(session.ended_at)}
                </p>
                {session.status === "pending_approval" && (
                  <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Waiting for admin approval of your work location.
                  </p>
                )}
                {(session.overtime_minutes ?? 0) > 0 && (
                  <p className="mt-3 rounded-lg bg-indigo-50 px-3 py-1.5 text-sm font-semibold text-indigo-700">
                    Overtime: {fmtMinutes(session.overtime_minutes)}
                  </p>
                )}
                <p className="mt-6 text-sm text-slate-400">That&apos;s a wrap for today 🎉</p>
              </>
            ) : (
              <p className="mt-2 text-sm text-slate-500">
                Your session request was denied by the admin. Contact them if this seems wrong.
              </p>
            )}
          </>
        )}
      </div>

      {error && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      <ConfirmDialog
        open={confirming === "start"}
        title="Start logging work?"
        message="We'll verify your current location against the approved work locations and start your timer."
        confirmLabel="Yes, start"
        busy={busy}
        onConfirm={doStart}
        onCancel={() => setConfirming(null)}
      />
      <ConfirmDialog
        open={confirming === "end"}
        title="Finish work?"
        message="This ends today's work session and saves your working hours. You can't start another session today."
        confirmLabel="Work done"
        danger
        busy={busy}
        onConfirm={doEnd}
        onCancel={() => setConfirming(null)}
      />
    </main>
  );
}
