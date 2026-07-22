"use client";

import { useEffect, useId } from "react";
import { MapPinOff } from "lucide-react";

/** Popup shown when a check-in or check-out is refused by the office geofence.
 *  Attendance is NOT marked — the request goes to HR for permission. */
export default function GeofenceAlert({
  open,
  kind,
  distanceM,
  radiusM,
  officeName,
  onClose,
}: {
  open: boolean;
  kind: "check_in" | "check_out";
  distanceM: number | null;
  radiusM: number | null;
  officeName?: string | null;
  onClose: () => void;
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const away =
    distanceM == null
      ? null
      : distanceM >= 1000
        ? `${(distanceM / 1000).toFixed(1)} km`
        : `${Math.round(distanceM)} m`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-4 sm:items-center"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="w-full max-w-sm rounded-xl border border-line bg-white p-6 shadow-lg">
        <div className="flex flex-col items-center text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-danger-tint text-danger">
            <MapPinOff size={26} strokeWidth={2.25} />
          </span>
          <h2 id={titleId} className="mt-4 text-lg font-semibold tracking-tight text-ink">
            You&apos;re outside the office area
          </h2>
          <p className="mt-2 text-sm text-ink-muted">
            Your {kind === "check_in" ? "check-in" : "check-out"} was{" "}
            <strong className="text-ink">not recorded</strong>. You must be within{" "}
            {radiusM ?? 200} m of {officeName ?? "your office"} to mark attendance
            {away ? <> — you appear to be about <strong className="text-ink">{away}</strong> away</> : null}.
          </p>
          <p className="mt-3 w-full rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {kind === "check_in" ? (
              <>
                Your timer has <strong>not</strong> started. HR has been notified and can grant
                permission — the clock will start from the moment they approve.
              </>
            ) : (
              <>
                You are <strong>still clocked in</strong>. HR has been notified and can grant
                permission — your hours are saved when they approve.
              </>
            )}
          </p>
        </div>
        <button
          onClick={onClose}
          autoFocus
          className="mt-6 h-11 w-full rounded-lg bg-primary text-sm font-semibold text-white transition-all hover:bg-primary-hover active:scale-[0.98]"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
