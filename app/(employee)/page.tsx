"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useMe, istToday, getPosition, geoErrorMessage, nudgePushProcessor } from "@/lib/hooks";
import { elapsedSince, fmtMinutes, fmtTime } from "@/lib/format";
import type { WorkSession, WorkLocation, LeaveBalance } from "@/lib/types";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Card, StatCard, Badge, Skeleton } from "@/components/ui";
import {
  TimerOff,
  Timer,
  Play,
  Square,
  Clock,
  CalendarCheck2,
  Plane,
  TrendingUp,
  MapPin,
  CircleCheck,
} from "lucide-react";

function greeting() {
  const h = Number(
    new Date().toLocaleString("en-US", { hour: "2-digit", hour12: false, timeZone: "Asia/Kolkata" })
  );
  if (h < 12) return "Good Morning";
  if (h < 17) return "Good Afternoon";
  return "Good Evening";
}

export default function HomePage() {
  const { me } = useMe();
  const [session, setSession] = useState<WorkSession | null>(null);
  const [locations, setLocations] = useState<Record<string, WorkLocation>>({});
  const [monthSessions, setMonthSessions] = useState<WorkSession[]>([]);
  const [balance, setBalance] = useState<LeaveBalance | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [confirming, setConfirming] = useState<"start" | "end" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const meId = me?.id;

  const refresh = useCallback(async () => {
    if (!meId) return;
    const supabase = supabaseBrowser();
    const monthStart = `${istToday().slice(0, 7)}-01`;
    const year = Number(istToday().slice(0, 4));
    const [{ data: s }, { data: locs }, { data: month }, { data: bal }] = await Promise.all([
      supabase
        .from("work_sessions")
        .select("*")
        .eq("employee_id", meId)
        .eq("work_date", istToday())
        .maybeSingle(),
      supabase.from("locations").select("*").eq("active", true),
      supabase
        .from("work_sessions")
        .select("*")
        .eq("employee_id", meId)
        .gte("work_date", monthStart),
      supabase
        .from("leave_balances")
        .select("*")
        .eq("employee_id", meId)
        .eq("year", year)
        .maybeSingle(),
    ]);
    setSession(s ?? null);
    setLocations(Object.fromEntries((locs ?? []).map((l: WorkLocation) => [l.id, l])));
    setMonthSessions(month ?? []);
    setBalance(bal);
    setLoaded(true);
  }, [meId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

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

  void tick;
  const running =
    session &&
    !session.ended_at &&
    (session.status === "active" || session.status === "pending_approval");
  const elapsedMs = session ? Date.now() - new Date(session.started_at).getTime() : 0;
  const over11h = running && elapsedMs > 11 * 3600 * 1000;

  const todayMinutes =
    session?.total_minutes ??
    (running ? Math.floor(elapsedMs / 60000) : 0);
  const monthDone = monthSessions.filter((s) => (s.total_minutes ?? 0) > 0);
  const monthMinutes = monthDone.reduce((a, s) => a + (s.total_minutes ?? 0), 0);
  const monthOT = monthDone.reduce((a, s) => a + (s.overtime_minutes ?? 0), 0);
  const leaveLeft = balance ? balance.quota - balance.used : null;

  const dateStr = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });

  return (
    <main className="space-y-6 p-4 md:p-6">
      {/* Welcome */}
      <section>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          {greeting()}, {me?.name?.split(" ")[0] ?? "there"}
        </h1>
        <p className="mt-0.5 text-sm text-ink-muted">{dateStr}</p>
      </section>

      {/* Primary action card */}
      {!loaded ? (
        <Skeleton className="h-44 w-full" />
      ) : (
        <Card featured className="p-6 md:p-8">
          {!session && (
            <div className="flex flex-col items-center gap-6 text-center md:flex-row md:justify-between md:text-left">
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 font-semibold text-danger">
                  <TimerOff size={20} />
                  <span className="text-lg">Not Clocked In</span>
                </div>
                <p className="max-w-md text-sm text-ink-muted">
                  Press Clock In to start your work session. Your location will be verified
                  against the approved work locations.
                </p>
              </div>
              <button
                onClick={() => setConfirming("start")}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-10 py-4 text-lg font-bold text-white transition-all hover:bg-primary-hover active:scale-95 md:w-auto"
              >
                <Play size={20} fill="currentColor" />
                Clock In
              </button>
            </div>
          )}

          {session && running && (
            <div className="flex flex-col items-center gap-6 text-center md:flex-row md:justify-between md:text-left">
              <div className="space-y-2">
                <div
                  className={`inline-flex items-center gap-2 font-semibold ${
                    session.status === "active" ? "text-success" : "text-amber-600"
                  }`}
                >
                  <Timer size={20} />
                  <span className="text-lg">
                    {session.status === "active" ? "Clocked In" : "Waiting for Approval"}
                  </span>
                </div>
                <p className="font-mono text-[40px] font-bold leading-none tracking-tight tabular-nums text-ink">
                  {elapsedSince(session.started_at)}
                </p>
                <p className="text-sm text-ink-muted">
                  Started {fmtTime(session.started_at)}
                  {session.start_location_id && locations[session.start_location_id] ? (
                    <span className="inline-flex items-center gap-1">
                      {" · "}
                      <MapPin size={13} className="inline" />
                      {locations[session.start_location_id].name}
                    </span>
                  ) : null}
                </p>
                {session.status === "pending_approval" && (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    You&apos;re not at an approved location — the admin has been notified. Your
                    time counts from when you pressed Clock In.
                  </p>
                )}
                {over11h && (
                  <p className="rounded-lg bg-danger-tint px-3 py-2 text-xs font-semibold text-danger-deep">
                    You&apos;ve been clocked in over 11 hours. Auto clock-out at 12 hours.
                  </p>
                )}
              </div>
              <button
                onClick={() => setConfirming("end")}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-ink px-10 py-4 text-lg font-bold text-white transition-all hover:bg-ink/90 active:scale-95 md:w-auto"
              >
                <Square size={18} fill="currentColor" />
                Clock Out
              </button>
            </div>
          )}

          {session && !running && (
            <div className="flex flex-col items-center gap-2 text-center">
              {session.status !== "denied" ? (
                <>
                  <div className="inline-flex items-center gap-2 font-semibold text-success">
                    <CircleCheck size={20} />
                    <span className="text-lg">Shift Complete</span>
                  </div>
                  <p className="text-[40px] font-bold leading-tight tracking-tight tabular-nums text-ink">
                    {fmtMinutes(session.total_minutes)}
                  </p>
                  <p className="text-sm text-ink-muted">
                    {fmtTime(session.started_at)} – {fmtTime(session.ended_at)}
                  </p>
                  {session.status === "pending_approval" && (
                    <Badge tone="amber">awaiting location approval</Badge>
                  )}
                  {(session.overtime_minutes ?? 0) > 0 && (
                    <Badge tone="indigo">+{fmtMinutes(session.overtime_minutes)} overtime</Badge>
                  )}
                  <p className="mt-2 text-sm text-ink-muted">That&apos;s a wrap for today 🎉</p>
                </>
              ) : (
                <>
                  <div className="inline-flex items-center gap-2 font-semibold text-danger">
                    <TimerOff size={20} />
                    <span className="text-lg">Session Denied</span>
                  </div>
                  <p className="max-w-md text-sm text-ink-muted">
                    Your work session request was denied by the admin. Contact them if this
                    seems wrong.
                  </p>
                </>
              )}
            </div>
          )}
        </Card>
      )}

      {error && (
        <p className="rounded-lg bg-danger-tint px-4 py-3 text-sm text-danger-deep">{error}</p>
      )}

      {/* Bento stats */}
      {!loaded ? (
        <div className="grid grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[130px]" />
          ))}
        </div>
      ) : (
        <section className="grid grid-cols-2 gap-4">
          <StatCard
            label="Today's Hours"
            value={fmtMinutes(todayMinutes)}
            sub="Goal: 9h"
            icon={Clock}
            tone="primary"
          />
          <StatCard
            label="Days This Month"
            value={monthDone.length}
            icon={CalendarCheck2}
            tone="emerald"
          />
          <StatCard
            label="Leave Balance"
            value={leaveLeft != null ? `${leaveLeft} Days` : "—"}
            icon={Plane}
            tone="slate"
            href="/leave"
          />
          <StatCard
            label="Month Overtime"
            value={fmtMinutes(monthOT)}
            sub={`${fmtMinutes(monthMinutes)} total`}
            icon={TrendingUp}
            tone="primary"
            highlight={monthOT > 0}
          />
        </section>
      )}

      <ConfirmDialog
        open={confirming === "start"}
        title="Clock in now?"
        message="We'll verify your current location against the approved work locations and start your timer."
        confirmLabel="Yes, clock in"
        busy={busy}
        onConfirm={doStart}
        onCancel={() => setConfirming(null)}
      />
      <ConfirmDialog
        open={confirming === "end"}
        title="Clock out?"
        message="This ends today's work session and saves your working hours. You can't start another session today."
        confirmLabel="Clock out"
        danger
        busy={busy}
        onConfirm={doEnd}
        onCancel={() => setConfirming(null)}
      />
    </main>
  );
}
