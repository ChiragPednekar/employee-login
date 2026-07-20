"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useMe, istToday, nudgePushProcessor } from "@/lib/hooks";
import { fmtDate } from "@/lib/format";
import type { LeaveRequest, Holiday, LeaveStatus, LeaveLedgerEntry } from "@/lib/types";
import { Card, Badge, FieldLabel, EmptyState } from "@/components/ui";
import DateRangePicker from "@/components/DateRangePicker";
import { Plane, Plus, X, Sandwich, History, ChevronDown } from "lucide-react";

const DAY_PART_LABEL = {
  full: "Full day",
  first_half: "First half",
  second_half: "Second half",
};

const LEDGER_LABEL: Record<string, string> = {
  allocation: "Monthly allocation",
  consumption: "Leave used",
  expiry: "Lapsed",
  adjustment: "Adjustment / refund",
};

export default function LeavePage() {
  const { me } = useMe();
  const [status, setStatus] = useState<LeaveStatus | null>(null);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [ledger, setLedger] = useState<LeaveLedgerEntry[]>([]);
  const [sandwich, setSandwich] = useState<{ sunday_date: string }[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [showLedger, setShowLedger] = useState(false);
  const [start, setStart] = useState(istToday());
  const [end, setEnd] = useState(istToday());
  const [dayPart, setDayPart] = useState<"full" | "first_half" | "second_half">("full");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const meId = me?.id;

  const refresh = useCallback(async () => {
    if (!meId) return;
    const supabase = supabaseBrowser();
    const year = Number(istToday().slice(0, 4));
    const [{ data: st }, { data: reqs }, { data: led }, { data: sw }, { data: hols }] = await Promise.all([
      supabase.rpc("leave_status", { p_emp: meId }),
      supabase
        .from("leave_requests")
        .select("*")
        .eq("employee_id", meId)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("leave_ledger")
        .select("*")
        .eq("employee_id", meId)
        .order("created_at", { ascending: false })
        .limit(40),
      supabase.from("sandwich_leaves").select("sunday_date").eq("employee_id", meId).order("sunday_date", { ascending: false }),
      supabase.from("holidays").select("*").gte("holiday_date", `${year}-01-01`).order("holiday_date"),
    ]);
    setStatus((st as LeaveStatus) ?? null);
    setRequests(reqs ?? []);
    setLedger((led as LeaveLedgerEntry[]) ?? []);
    setSandwich((sw as { sunday_date: string }[]) ?? []);
    setHolidays(hols ?? []);
  }, [meId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabaseBrowser().rpc("apply_leave", {
      p_start: start,
      p_end: dayPart === "full" ? end : start,
      p_day_part: dayPart,
      p_reason: reason,
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    nudgePushProcessor();
    setShowForm(false);
    setReason("");
    setDayPart("full");
    refresh();
  }

  async function cancel(id: string) {
    const { error } = await supabaseBrowser().rpc("cancel_leave", { p_id: id });
    if (!error) refresh();
  }

  const calendarDays =
    Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1;

  return (
    <main className="space-y-6 p-4 md:p-6">
      {/* Balance card (ledger model) */}
      <Card featured className="p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
              Paid leave available
            </p>
            <p className="mt-1 text-[32px] font-semibold leading-10 tracking-tight tabular-nums text-ink">
              {status?.total_available ?? "—"}
              <span className="text-base font-normal text-ink-muted"> days</span>
            </p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-muted">
              <span>
                This month: <b className="text-ink">{status?.current_days ?? "—"}</b>
              </span>
              <span>
                Carried over: <b className="text-ink">{status?.carried_days ?? "—"}</b>
              </span>
            </div>
            {status && status.expiring_days > 0 && (
              <p className="mt-2 inline-block rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                ⚠ {status.expiring_days} day{status.expiring_days !== 1 ? "s" : ""} expire on{" "}
                {fmtDate(status.expiring_on)}
              </p>
            )}
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-white transition-all hover:bg-primary-hover active:scale-[0.98]"
          >
            {showForm ? <X size={16} /> : <Plus size={16} />}
            {showForm ? "Close" : "Apply"}
          </button>
        </div>
        <p className="mt-3 border-t border-line pt-3 text-[11px] text-outline">
          2 paid days credited each month · unused days carry over for one month only, then lapse ·
          oldest days are used first. Sundays &amp; holidays aren&apos;t counted as leave.
        </p>
      </Card>

      {/* Application form */}
      {showForm && (
        <Card className="p-6">
          <h2 className="mb-5 text-base font-semibold tracking-tight text-ink">New Leave Request</h2>
          <form onSubmit={submit} className="space-y-5">
            <div className="space-y-1.5">
              <FieldLabel>Type</FieldLabel>
              <div className="flex gap-2">
                {(["full", "first_half", "second_half"] as const).map((p) => (
                  <button
                    type="button"
                    key={p}
                    onClick={() => setDayPart(p)}
                    className={`h-9 flex-1 rounded-lg border text-xs font-semibold transition-colors ${
                      dayPart === p
                        ? "border-primary bg-primary-tint/60 text-primary-deep"
                        : "border-line-strong text-ink-muted hover:bg-surface-low"
                    }`}
                  >
                    {DAY_PART_LABEL[p]}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <FieldLabel>{dayPart === "full" ? "Pick your dates" : "Pick a date"}</FieldLabel>
              <DateRangePicker
                start={start}
                end={dayPart === "full" ? end : start}
                mode={dayPart === "full" ? "range" : "single"}
                holidays={holidays}
                minDate={istToday()}
                onChange={(s, e) => {
                  setStart(s);
                  setEnd(e);
                }}
              />
              <p className="pt-1 text-sm text-ink-muted">
                {dayPart === "full" ? (
                  <>
                    <span className="font-semibold text-ink">{fmtDate(start)}</span>
                    {end !== start && (
                      <>
                        {" → "}
                        <span className="font-semibold text-ink">{fmtDate(end)}</span>
                      </>
                    )}{" "}
                    · {calendarDays} calendar day{calendarDays !== 1 ? "s" : ""} (working days
                    counted; Sundays/holidays excluded)
                  </>
                ) : (
                  <>
                    <span className="font-semibold text-ink">{fmtDate(start)}</span> · 0.5 day
                  </>
                )}
              </p>
            </div>
            <div className="space-y-1.5">
              <FieldLabel htmlFor="reason">Reason</FieldLabel>
              <textarea
                id="reason"
                required
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Tell your admin why you need this leave…"
                className="w-full rounded-lg border border-line-strong bg-white px-3 py-2.5 text-sm text-ink placeholder:text-outline outline-none transition-all focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>
            {error && (
              <p className="rounded-lg bg-danger-tint px-3 py-2 text-sm text-danger-deep">{error}</p>
            )}
            <button
              disabled={busy}
              className="h-11 w-full rounded-lg bg-primary text-sm font-semibold text-white transition-all hover:bg-primary-hover active:scale-[0.98] disabled:opacity-50"
            >
              {busy ? "Submitting…" : "Submit leave request"}
            </button>
          </form>
        </Card>
      )}

      {/* Sandwich notices */}
      {sandwich.length > 0 && (
        <div className="space-y-2">
          <p className="px-0.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
            Sandwich leave (unpaid Sundays)
          </p>
          <Card className="p-4">
            <div className="flex items-start gap-2 text-sm text-ink-muted">
              <Sandwich size={16} className="mt-0.5 shrink-0 text-amber-600" />
              <p>
                {sandwich.map((s) => fmtDate(s.sunday_date)).join(", ")} — counted as unpaid because
                you were on leave the surrounding Saturday &amp; Monday.
              </p>
            </div>
          </Card>
        </div>
      )}

      {/* Requests */}
      <div className="space-y-2">
        <p className="px-0.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
          Your requests
        </p>
        {requests.length === 0 ? (
          <EmptyState icon={Plane} title="No leave requests yet" hint="Tap Apply to request your first leave." />
        ) : (
          <Card className="overflow-hidden">
            <div className="divide-y divide-line">
              {requests.map((r) => (
                <div key={r.id} className="px-5 py-4 transition-colors hover:bg-slate-50">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-ink">
                      {fmtDate(r.start_date)}
                      {r.end_date !== r.start_date && ` → ${fmtDate(r.end_date)}`}
                    </p>
                    <Badge
                      tone={
                        r.status === "approved"
                          ? "emerald"
                          : r.status === "denied"
                            ? "red"
                            : r.status === "cancelled"
                              ? "slate"
                              : "amber"
                      }
                    >
                      {r.status}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {DAY_PART_LABEL[r.day_part]} · {r.days} day{r.days !== 1 ? "s" : ""}
                    {(r.paid_days ?? 0) > 0 && <span className="text-success"> · {r.paid_days} paid</span>}
                    {(r.unpaid_days ?? 0) > 0 && <span className="text-amber-600"> · {r.unpaid_days} unpaid</span>}
                  </p>
                  <p className="mt-2 text-sm text-ink-muted">“{r.reason}”</p>
                  {(r.status === "pending" || r.status === "approved") && (
                    <button
                      onClick={() => cancel(r.id)}
                      className="mt-2 text-xs font-semibold text-danger hover:underline"
                    >
                      Cancel this leave
                    </button>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      {/* Ledger history */}
      {ledger.length > 0 && (
        <div className="space-y-2">
          <button
            onClick={() => setShowLedger(!showLedger)}
            aria-expanded={showLedger}
            className="flex items-center gap-1.5 px-0.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted"
          >
            <History size={13} />
            Leave ledger
            <ChevronDown size={14} className={`transition-transform ${showLedger ? "rotate-180" : ""}`} />
          </button>
          {showLedger && (
            <Card className="overflow-hidden">
              <div className="divide-y divide-line">
                {ledger.map((l) => (
                  <div key={l.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                    <div>
                      <p className="font-medium text-ink">{LEDGER_LABEL[l.kind] ?? l.kind}</p>
                      <p className="text-xs text-outline">
                        {new Date(l.alloc_month).toLocaleDateString("en-US", { month: "short", year: "numeric" })}{" "}
                        bucket · {new Date(l.created_at).toLocaleDateString("en-IN")}
                      </p>
                    </div>
                    <span
                      className={`font-semibold tabular-nums ${l.days >= 0 ? "text-success" : "text-danger"}`}
                    >
                      {l.days >= 0 ? "+" : ""}
                      {l.days}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}
    </main>
  );
}
