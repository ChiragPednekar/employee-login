import type { WorkSession } from "@/lib/types";

/** Shift start assumption for punctuality. Configurable later — surfaced in the UI. */
export const SHIFT_START = "09:00";
export const LATE_GRACE_MIN = 15;
export const LATE_LABEL = "after 9:15 AM";

export function istClockInMinutes(startedAt: string): number {
  const t = new Date(startedAt).toLocaleTimeString("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function isLate(session: Pick<WorkSession, "started_at" | "status">): boolean {
  if (session.status === "denied" || session.status === "pending_approval") return false;
  const [sh, sm] = SHIFT_START.split(":").map(Number);
  const threshold = sh * 60 + sm + LATE_GRACE_MIN;
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
