"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useMe, istToday, nudgePushProcessor } from "@/lib/hooks";
import { fmtDate } from "@/lib/format";
import type { LeaveRequest, LeaveBalance } from "@/lib/types";

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

  return (
    <main className="space-y-4 p-4">
      <div className="flex items-center justify-between rounded-2xl bg-gradient-to-br from-indigo-600 to-indigo-500 p-5 text-white shadow-md">
        <div>
          <p className="text-sm text-indigo-100">Leave balance {istToday().slice(0, 4)}</p>
          <p className="text-3xl font-bold">
            {remaining ?? "—"}
            <span className="text-base font-normal text-indigo-200">
              {" "}
              / {balance?.quota ?? "—"} days
            </span>
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-indigo-600 shadow"
        >
          {showForm ? "Close" : "+ Apply"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={submit} className="space-y-4 rounded-2xl bg-white p-5 shadow-sm">
          <div>
            <label className="mb-1 block text-sm font-medium">Type</label>
            <div className="flex gap-2">
              {(["full", "first_half", "second_half"] as const).map((p) => (
                <button
                  type="button"
                  key={p}
                  onClick={() => setDayPart(p)}
                  className={`flex-1 rounded-lg border px-2 py-2 text-xs font-semibold ${
                    dayPart === p
                      ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                      : "border-slate-200 text-slate-500"
                  }`}
                >
                  {DAY_PART_LABEL[p]}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-sm font-medium">
                {dayPart === "full" ? "From" : "Date"}
              </label>
              <input
                type="date"
                required
                value={start}
                min={istToday()}
                onChange={(e) => setStart(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
            {dayPart === "full" && (
              <div className="flex-1">
                <label className="mb-1 block text-sm font-medium">To</label>
                <input
                  type="date"
                  required
                  value={end}
                  min={start}
                  onChange={(e) => setEnd(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
            )}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Reason</label>
            <textarea
              required
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Tell your admin why you need this leave…"
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </div>
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}
          <button
            disabled={busy}
            className="w-full rounded-xl bg-indigo-600 py-3 font-bold text-white disabled:opacity-50"
          >
            {busy ? "Submitting…" : "Submit leave request"}
          </button>
        </form>
      )}

      <div className="space-y-2">
        <p className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Your requests
        </p>
        {requests.length === 0 && (
          <p className="p-4 text-center text-sm text-slate-400">No leave requests yet</p>
        )}
        {requests.map((r) => (
          <div key={r.id} className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="font-semibold">
                {fmtDate(r.start_date)}
                {r.end_date !== r.start_date && ` → ${fmtDate(r.end_date)}`}
              </p>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  r.status === "approved"
                    ? "bg-emerald-100 text-emerald-700"
                    : r.status === "denied"
                      ? "bg-red-100 text-red-700"
                      : "bg-amber-100 text-amber-700"
                }`}
              >
                {r.status}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {DAY_PART_LABEL[r.day_part]} · {r.days} day{r.days !== 1 ? "s" : ""}
            </p>
            <p className="mt-2 text-sm text-slate-600">{r.reason}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
