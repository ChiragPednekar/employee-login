export function fmtMinutes(min: number | null | undefined): string {
  if (min == null) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

/** Duration for a session row: sub-minute completed sessions read as "< 1m"
 *  instead of a broken-looking "0h 00m". Denied sessions keep 0h 00m (no credit). */
export function fmtSessionMinutes(
  min: number | null | undefined,
  status?: string
): string {
  if (min === 0 && status === "completed") return "< 1m";
  return fmtMinutes(min);
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

export function fmtDate(d: string | Date): string {
  return new Date(d).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function elapsedSince(startIso: string | null | undefined): string {
  if (!startIso) return "00:00:00";
  const secs = Math.max(0, Math.floor((Date.now() - new Date(startIso).getTime()) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export const STANDARD_DAY_MINUTES = 540; // 9 hours

export const SESSION_STATUS_LABEL: Record<string, string> = {
  pending_approval: "Waiting for approval",
  active: "Working",
  completed: "Completed",
  auto_closed: "Auto-closed (12h)",
  denied: "Denied",
};
