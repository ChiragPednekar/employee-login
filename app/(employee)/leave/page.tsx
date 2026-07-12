"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useMe, istToday, nudgePushProcessor } from "@/lib/hooks";
import { fmtDate } from "@/lib/format";
import type { LeaveRequest, LeaveBalance } from "@/lib/types";
import { Card, Badge, FieldLabel, inputCls, EmptyState } from "@/components/ui";
import { Plane, Plus, X } from "lucide-react";

const DAY_PART_LABEL = {
  full: "Full day",
  first_half: "First half",
  second_half: "Second half",
};

export default function LeavePage() {
  const { me } = useMe();
  const [balance, setBalance] = useState<LeaveBalance | null>(null);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [showForm, setShowForm] = useState(false);
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
    const [{ data: bal }, { data: reqs }] = await Promise.all([
      supabase
        .from("leave_balances")
        .select("*")
        .eq("employee_id", meId)
        .eq("year", year)
        .maybeSingle(),
      supabase
        .from("leave_requests")
        .select("*")
        .eq("employee_id", meId)
        .order("created_at", { ascending: false })
        .limit(30),
    ]);
    setBalance(bal);
    setRequests(reqs ?? []);
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

  const remaining = balance ? balance.quota - balance.used : null;
  const pct = balance && balance.quota > 0 ? (remaining! / balance.quota) : 0;

  return (
    <main className="space-y-6 p-4 md:p-6">
      {/* Balance card */}
      <Card featured className="p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
              Leave Balance · {istToday().slice(0, 4)}
            </p>
            <p className="mt-1 text-[32px] font-semibold leading-10 tracking-tight tabular-nums text-ink">
              {remaining ?? "—"}
              <span className="text-base font-normal text-ink-muted">
                {" "}
                / {balance?.quota ?? "—"} days
              </span>
            </p>
            <div className="mt-3 h-1.5 w-40 overflow-hidden rounded-full bg-surface-low">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${Math.max(0, Math.min(100, pct * 100))}%` }}
              />
            </div>
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-white transition-all hover:bg-primary-hover active:scale-[0.98]"
          >
            {showForm ? <X size={16} /> : <Plus size={16} />}
            {showForm ? "Close" : "Apply"}
          </button>
        </div>
      </Card>

      {/* Application form */}
      {showForm && (
        <Card className="p-6">
          <h2 className="mb-5 text-base font-semibold tracking-tight text-ink">
            New Leave Request
          </h2>
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
            <div className="flex gap-4">
              <div className="flex-1 space-y-1.5">
                <FieldLabel htmlFor="start">{dayPart === "full" ? "From" : "Date"}</FieldLabel>
                <input
                  id="start"
                  type="date"
                  required
                  value={start}
                  min={istToday()}
                  onChange={(e) => setStart(e.target.value)}
                  className={inputCls}
                />
              </div>
              {dayPart === "full" && (
                <div className="flex-1 space-y-1.5">
                  <FieldLabel htmlFor="end">To</FieldLabel>
                  <input
                    id="end"
                    type="date"
                    required
                    value={end}
                    min={start}
                    onChange={(e) => setEnd(e.target.value)}
                    className={inputCls}
                  />
                </div>
              )}
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
              <p className="rounded-lg bg-danger-tint px-3 py-2 text-sm text-danger-deep">
                {error}
              </p>
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

      {/* Requests */}
      <div className="space-y-2">
        <p className="px-0.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
          Your requests
        </p>
        {requests.length === 0 ? (
          <EmptyState
            icon={Plane}
            title="No leave requests yet"
            hint="Tap Apply to request your first leave."
          />
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
                            : "amber"
                      }
                    >
                      {r.status}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {DAY_PART_LABEL[r.day_part]} · {r.days} day{r.days !== 1 ? "s" : ""}
                  </p>
                  <p className="mt-2 text-sm text-ink-muted">“{r.reason}”</p>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </main>
  );
}
