import type { WorkSession } from "@/lib/types";

/** Fallback shift policy, used only until app_settings loads (or if it can't be read). */
export const SHIFT_START = "09:00";
export const LATE_GRACE_MIN = 15;

/** The org-wide punctuality policy, as stored in app_settings. */
export type ShiftPolicy = {
  shift_start: string;
  shift_end: string;
  late_grace_min: number;
  early_departure_grace_min: number;
};

export const DEFAULT_SHIFT_POLICY: ShiftPolicy = {
  shift_start: SHIFT_START,
  shift_end: "18:00",
  late_grace_min: LATE_GRACE_MIN,
  early_departure_grace_min: 15,
};

/** "HH:MM[:SS]" → minutes past midnight. */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** Human-readable cutoff, e.g. "after 9:15 AM" — for report headers. */
export function lateLabel(policy: ShiftPolicy): string {
  const mins = timeToMinutes(policy.shift_start) + policy.late_grace_min;
  const h24 = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const ampm = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `after ${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

/** Minutes past IST midnight. Returns -1 when there is no time yet (a check-in
 *  still awaiting HR permission), so such sessions never count as late. */
export function istClockInMinutes(startedAt: string | null | undefined): number {
  if (!startedAt) return -1;
  const t = new Date(startedAt).toLocaleTimeString("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function isLate(
  session: Pick<WorkSession, "started_at" | "status">,
  policy: ShiftPolicy = DEFAULT_SHIFT_POLICY
): boolean {
  if (session.status === "denied" || session.status === "pending_approval") return false;
  const threshold = timeToMinutes(policy.shift_start) + policy.late_grace_min;
  return istClockInMinutes(session.started_at) > threshold;
}

export type SessionFlag =
  | "unlisted_start"
  | "out_of_range_end"
  | "auto_closed"
  | "denied"
  | "offsite_override";

export const FLAG_LABEL: Record<SessionFlag, string> = {
  unlisted_start: "Unlisted start location",
  out_of_range_end: "Ended out of range",
  auto_closed: "Auto-closed (12h)",
  denied: "Denied",
  offsite_override: "Off-site — approved",
};

export const FLAG_TONE: Record<SessionFlag, "amber" | "red" | "slate" | "indigo"> = {
  unlisted_start: "amber",
  out_of_range_end: "amber",
  auto_closed: "red",
  denied: "red",
  offsite_override: "indigo",
};

/** Which anomaly flags apply to a session (may be several). */
export function sessionFlags(
  s: Pick<
    WorkSession,
    "start_location_id" | "end_out_of_range" | "status"
  > & { decided_by?: string | null }
): SessionFlag[] {
  const flags: SessionFlag[] = [];
  if (s.status === "denied") {
    flags.push("denied");
    return flags;
  }
  if (!s.start_location_id) {
    // Off-site: either awaiting/decided. If an admin/manager approved it, mark as override.
    if (s.decided_by) flags.push("offsite_override");
    else flags.push("unlisted_start");
  }
  if (s.end_out_of_range) flags.push("out_of_range_end");
  if (s.status === "auto_closed") flags.push("auto_closed");
  return flags;
}

export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const from = `${month}-01`;
  const to = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;
  return { from, to };
}
