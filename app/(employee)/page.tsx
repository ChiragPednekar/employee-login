"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import {
  useMe,
  istToday,
  getPosition,
  attendanceErrorMessage,
  geoErrorMessage,
  distanceM,
  ACCURACY_LIMIT_M,
  nudgePushProcessor,
} from "@/lib/hooks";
import { elapsedSince, fmtMinutes, fmtTime } from "@/lib/format";
import type {
  WorkSession,
  WorkLocation,
  LeaveBalance,
  Holiday,
  TeamStatus,
} from "@/lib/types";
import ConfirmDialog from "@/components/ConfirmDialog";
import GeofenceAlert from "@/components/GeofenceAlert";
import Avatar from "@/components/Avatar";
import { Card, StatCard, Badge, Skeleton, SectionTitle } from "@/components/ui";
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
  const [weekSessions, setWeekSessions] = useState<WorkSession[]>([]);
  const [balance, setBalance] = useState<LeaveBalance | null>(null);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [team, setTeam] = useState<TeamStatus[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [confirming, setConfirming] = useState<"start" | "end" | null>(null);
  const [blocked, setBlocked] = useState<{
    kind: "check_in" | "check_out";
    distance: number | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [office, setOffice] = useState<WorkLocation | null>(null);
  const [geoStatus, setGeoStatus] = useState<
    | { checking: true }
    | { checking: false; distance: number; inside: boolean; accuracy: number }
    | { checking: false; error: string }
    | null
  >(null);
  const meId = me?.id;
  const officeId = me?.office_id;

  const refresh = useCallback(async () => {
    if (!meId) return;
    const supabase = supabaseBrowser();
    const monthStart = `${istToday().slice(0, 7)}-01`;
    const year = Number(istToday().slice(0, 4));
    const weekAgo = new Date(Date.now() - 6 * 86400000).toLocaleDateString("en-CA", {
      timeZone: "Asia/Kolkata",
    });
    const [
      { data: s },
      { data: locs },
      { data: month },
      { data: week },
      { data: bal },
      { data: hols },
      { data: teamRows },
    ] = await Promise.all([
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
        .from("work_sessions")
        .select("*")
        .eq("employee_id", meId)
        .gte("work_date", weekAgo),
      supabase
        .from("leave_balances")
        .select("*")
        .eq("employee_id", meId)
        .eq("year", year)
        .maybeSingle(),
      supabase
        .from("holidays")
        .select("*")
        .gte("holiday_date", istToday())
        .order("holiday_date")
        .limit(3),
      supabase.rpc("team_status"),
    ]);
    setSession(s ?? null);
    setLocations(Object.fromEntries((locs ?? []).map((l: WorkLocation) => [l.id, l])));
    setMonthSessions(month ?? []);
    setWeekSessions(week ?? []);
    setBalance(bal);
    setHolidays(hols ?? []);
    setTeam((teamRows as TeamStatus[]) ?? []);
    setLoaded(true);
  }, [meId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Load the employee's assigned office (for the geofence status widget)
  useEffect(() => {
    if (!officeId) {
      setOffice(null);
      return;
    }
    supabaseBrowser()
      .from("locations")
      .select("*")
      .eq("id", officeId)
      .maybeSingle()
      .then(({ data }) => setOffice(data));
  }, [officeId]);

  async function checkLocation() {
    setGeoStatus({ checking: true });
    try {
      const pos = await getPosition();
      if (!office) {
        setGeoStatus({ checking: false, error: "No office assigned" });
        return;
      }
      const d = distanceM(pos.coords.latitude, pos.coords.longitude, office.lat, office.lng);
      setGeoStatus({
        checking: false,
        distance: Math.round(d),
        inside: d <= office.radius_m,
        accuracy: Math.round(pos.coords.accuracy),
      });
    } catch (e) {
      setGeoStatus({ checking: false, error: geoErrorMessage(e) });
    }
  }

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
      if (pos.coords.accuracy > ACCURACY_LIMIT_M) {
        throw new Error(
          `Location accuracy is too low (±${Math.round(pos.coords.accuracy)} m) to verify your office reliably. Move to an open area and try again.`
        );
      }
      const { data, error } = await supabaseBrowser().rpc("start_session", {
        p_lat: pos.coords.latitude,
        p_lng: pos.coords.longitude,
      });
      if (error) throw new Error(error.message);
      const s = data as WorkSession;
      setSession(s);
      // Refused by the geofence — attendance was NOT marked. Tell them plainly.
      if (s?.pending_kind === "check_in") {
        setBlocked({ kind: "check_in", distance: s.start_distance_m });
      }
      nudgePushProcessor();
    } catch (e) {
      setError(attendanceErrorMessage(e));
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
      if (pos.coords.accuracy > ACCURACY_LIMIT_M) {
        throw new Error(
          `Location accuracy is too low (±${Math.round(pos.coords.accuracy)} m) to verify your office reliably. Move to an open area and try again.`
        );
      }
      const { data, error } = await supabaseBrowser().rpc("end_session", {
        p_lat: pos.coords.latitude,
        p_lng: pos.coords.longitude,
      });
      if (error) throw new Error(error.message);
      const s = data as WorkSession;
      setSession(s);
      if (s?.pending_kind === "check_out") {
        setBlocked({ kind: "check_out", distance: s.end_distance_m });
      }
      nudgePushProcessor();
    } catch (e) {
      setError(attendanceErrorMessage(e));
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  void tick;
  // A geofence-refused check-in has no start time yet — nothing is running until HR approves.
  const awaitingCheckIn = session?.pending_kind === "check_in";
  const awaitingCheckOut = session?.pending_kind === "check_out";
  const running = Boolean(session && session.started_at && !session.ended_at);
  const elapsedMs =
    session?.started_at ? Date.now() - new Date(session.started_at).getTime() : 0;
  const over11h = running && elapsedMs > 11 * 3600 * 1000;

  const todayMinutes =
    session?.total_minutes ??
    (running ? Math.floor(elapsedMs / 60000) : 0);
  const monthDone = monthSessions.filter((s) => (s.total_minutes ?? 0) > 0);
  const monthMinutes = monthDone.reduce((a, s) => a + (s.total_minutes ?? 0), 0);
  const monthOT = monthDone.reduce((a, s) => a + (s.overtime_minutes ?? 0), 0);
  const leaveLeft = balance ? balance.quota - balance.used : null;

  // Last 7 days worked-minutes, oldest → newest
  const weekByDate = new Map(weekSessions.map((s) => [s.work_date, s.total_minutes ?? 0]));
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * 86400000);
    const key = d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    return {
      key,
      label: d.toLocaleDateString("en-US", { weekday: "narrow", timeZone: "Asia/Kolkata" }),
      minutes: weekByDate.get(key) ?? 0,
    };
  });
  const weekMinutes = weekDays.reduce((a, d) => a + d.minutes, 0);
  const maxWeek = Math.max(60, ...weekDays.map((d) => d.minutes));

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

          {session && awaitingCheckIn && (
            <div className="flex flex-col items-center gap-6 text-center md:flex-row md:justify-between md:text-left">
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 font-semibold text-amber-600">
                  <TimerOff size={20} />
                  <span className="text-lg">Check-in Awaiting HR Permission</span>
                </div>
                <p className="max-w-md text-sm text-ink-muted">
                  You pressed Clock In at {fmtTime(session.requested_at)}
                  {session.start_distance_m != null && office
                    ? `, about ${Math.round(session.start_distance_m)} m from ${office.name} (limit ${office.radius_m} m).`
                    : ", outside your office location."}
                </p>
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Your timer has <strong>not</strong> started. HR has been notified — once they
                  approve, the clock starts from that moment. This page updates automatically.
                </p>
              </div>
            </div>
          )}

          {session && running && (
            <div className="flex flex-col items-center gap-6 text-center md:flex-row md:justify-between md:text-left">
              <div className="space-y-2">
                <div
                  className={`inline-flex items-center gap-2 font-semibold ${
                    awaitingCheckOut ? "text-amber-600" : "text-success"
                  }`}
                >
                  <Timer size={20} />
                  <span className="text-lg">
                    {awaitingCheckOut ? "Check-out Awaiting HR Permission" : "Clocked In"}
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
                {awaitingCheckOut && (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    You pressed Clock Out at {fmtTime(session.requested_at)} away from the office,
                    so it was refused. You are <strong>still clocked in</strong> and the timer is
                    running. HR has been notified — your hours are saved when they approve.
                  </p>
                )}
                {over11h && (
                  <p className="rounded-lg bg-danger-tint px-3 py-2 text-xs font-semibold text-danger-deep">
                    You&apos;ve been clocked in over 11 hours. Auto clock-out at 12 hours.
                  </p>
                )}
              </div>
              {!awaitingCheckOut && (
                <button
                  onClick={() => setConfirming("end")}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-ink px-10 py-4 text-lg font-bold text-white transition-all hover:bg-ink/90 active:scale-95 md:w-auto"
                >
                  <Square size={18} fill="currentColor" />
                  Clock Out
                </button>
              )}
            </div>
          )}

          {session && !running && !awaitingCheckIn && (
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

      {/* Geofence status (assigned-office employees) */}
      {office && (
        <Card className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                <MapPin size={15} className="text-primary" />
                {office.name}
              </p>
              <p className="mt-0.5 text-xs text-ink-muted">
                Allowed radius: {office.radius_m} m · outside this, check-in and check-out need
                HR permission
              </p>
            </div>
            <button
              onClick={checkLocation}
              disabled={geoStatus?.checking}
              className="h-9 shrink-0 rounded-lg border border-line-strong bg-white px-3 text-sm font-semibold text-ink transition-colors hover:bg-surface-low disabled:opacity-50"
            >
              {geoStatus?.checking ? "Checking…" : "Check location"}
            </button>
          </div>
          {geoStatus && !geoStatus.checking && "distance" in geoStatus && (
            <div
              className={`mt-3 flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
                geoStatus.inside ? "bg-success-tint text-success-deep" : "bg-danger-tint text-danger-deep"
              }`}
            >
              <span className="font-semibold">
                {geoStatus.inside ? "✓ Inside geofence" : "✕ Outside geofence"}
              </span>
              <span className="tabular-nums">
                {geoStatus.distance} m away · ±{geoStatus.accuracy} m
              </span>
            </div>
          )}
          {geoStatus && !geoStatus.checking && "error" in geoStatus && (
            <p className="mt-3 rounded-lg bg-danger-tint px-3 py-2 text-sm text-danger-deep">
              {geoStatus.error}
            </p>
          )}
        </Card>
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

      {/* This week summary */}
      {loaded && (
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp size={16} className="text-primary" strokeWidth={2.25} />
              <h2 className="text-sm font-semibold text-ink">This week</h2>
            </div>
            <p className="text-sm font-semibold tabular-nums text-ink">
              {fmtMinutes(weekMinutes)}
            </p>
          </div>
          <div className="flex h-24 items-end gap-2">
            {weekDays.map((d) => (
              <div key={d.key} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
                <div
                  className={`w-full max-w-9 rounded-md transition-all duration-500 ${
                    d.minutes > 0 ? "bg-primary" : "bg-slate-200/80"
                  }`}
                  style={{
                    height: `${d.minutes > 0 ? Math.max(8, Math.round((d.minutes / maxWeek) * 72)) : 4}px`,
                  }}
                  title={`${fmtMinutes(d.minutes)} on ${d.key}`}
                />
                <span className="text-[11px] font-medium text-outline">{d.label}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Upcoming holidays */}
      {loaded && holidays.length > 0 && (
        <div className="space-y-2">
          <SectionTitle>Upcoming holidays</SectionTitle>
          <Card className="overflow-hidden">
            <div className="divide-y divide-line">
              {holidays.map((h, i) => {
                const d = new Date(h.holiday_date);
                const away = Math.round(
                  (d.getTime() - new Date(istToday()).getTime()) / 86400000
                );
                return (
                  <div key={h.id} className="flex items-center justify-between px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg bg-primary-tint">
                        <span className="text-[10px] font-semibold uppercase leading-none text-primary-deep">
                          {d.toLocaleDateString("en-US", { month: "short", timeZone: "Asia/Kolkata" })}
                        </span>
                        <span className="text-sm font-bold leading-tight text-primary">
                          {d.toLocaleDateString("en-US", { day: "numeric", timeZone: "Asia/Kolkata" })}
                        </span>
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-ink">{h.name}</p>
                        <p className="text-xs text-ink-muted">
                          {d.toLocaleDateString("en-US", {
                            weekday: "long",
                            timeZone: "Asia/Kolkata",
                          })}
                        </p>
                      </div>
                    </div>
                    {i === 0 && (
                      <Badge tone="indigo">
                        {away === 0 ? "today" : away === 1 ? "tomorrow" : `in ${away} days`}
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      )}

      {/* Team availability */}
      {loaded && team.length > 0 && (
        <div className="space-y-2">
          <SectionTitle>Team availability</SectionTitle>
          <Card className="overflow-hidden">
            <div className="divide-y divide-line">
              {team.map((t) => (
                <div key={t.emp_id} className="flex items-center justify-between px-5 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={t.name} size={36} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{t.name}</p>
                      <p className="text-xs text-outline">{t.emp_id}</p>
                    </div>
                  </div>
                  <span className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        t.status === "working"
                          ? "bg-success"
                          : t.status === "on leave"
                            ? "bg-amber-500"
                            : t.status === "done today"
                              ? "bg-primary"
                              : "bg-slate-300"
                      }`}
                    />
                    {t.status}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      <GeofenceAlert
        open={blocked !== null}
        kind={blocked?.kind ?? "check_in"}
        distanceM={blocked?.distance ?? null}
        radiusM={office?.radius_m ?? null}
        officeName={office?.name}
        onClose={() => setBlocked(null)}
      />

      <ConfirmDialog
        open={confirming === "start"}
        title="Clock in now?"
        message="We'll check your location against your office. If you're outside the allowed radius, your check-in is refused and sent to HR for permission — the timer starts only once they approve."
        confirmLabel="Yes, clock in"
        busy={busy}
        onConfirm={doStart}
        onCancel={() => setConfirming(null)}
      />
      <ConfirmDialog
        open={confirming === "end"}
        title="Clock out?"
        message="This ends today's work session and saves your working hours. If you're outside your office radius, it's refused and sent to HR — you stay clocked in until they approve. You can't start another session today."
        confirmLabel="Clock out"
        danger
        busy={busy}
        onConfirm={doEnd}
        onCancel={() => setConfirming(null)}
      />
    </main>
  );
}
