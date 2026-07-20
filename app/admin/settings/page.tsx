"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Card, FieldLabel, inputCls } from "@/components/ui";
import { Clock, Plane, Sandwich } from "lucide-react";

type Settings = {
  shift_start: string;
  shift_end: string;
  late_grace_min: number;
  early_departure_grace_min: number;
  monthly_leave_alloc: number;
  carry_forward_months: number;
  sandwich_enabled: boolean;
};

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabaseBrowser().from("app_settings").select("*").maybeSingle();
    if (data) {
      setS({
        shift_start: (data.shift_start as string).slice(0, 5),
        shift_end: (data.shift_end as string).slice(0, 5),
        late_grace_min: data.late_grace_min,
        early_departure_grace_min: data.early_departure_grace_min,
        monthly_leave_alloc: data.monthly_leave_alloc,
        carry_forward_months: data.carry_forward_months,
        sandwich_enabled: data.sandwich_enabled,
      });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!s) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    const { error } = await supabaseBrowser()
      .from("app_settings")
      .update({ ...s, updated_at: new Date().toISOString() })
      .eq("id", true);
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  if (!s) return <main className="p-4 text-sm text-ink-muted">Loading…</main>;

  return (
    <main className="mx-auto max-w-xl space-y-4 p-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
        <p className="text-xs text-ink-muted">Shift times, punctuality, and leave policy</p>
      </div>

      <form onSubmit={save} className="space-y-4">
        <Card className="space-y-4 p-5">
          <div className="flex items-center gap-2">
            <Clock size={16} className="text-primary" strokeWidth={2.25} />
            <h2 className="text-sm font-semibold text-ink">Shift &amp; punctuality</h2>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <FieldLabel>Shift start</FieldLabel>
              <input type="time" value={s.shift_start} onChange={(e) => setS({ ...s, shift_start: e.target.value })} className={inputCls} />
            </div>
            <div className="space-y-1">
              <FieldLabel>Shift end</FieldLabel>
              <input type="time" value={s.shift_end} onChange={(e) => setS({ ...s, shift_end: e.target.value })} className={inputCls} />
            </div>
            <div className="space-y-1">
              <FieldLabel>Late grace (min)</FieldLabel>
              <input type="number" min={0} value={s.late_grace_min} onChange={(e) => setS({ ...s, late_grace_min: Number(e.target.value) })} className={inputCls} />
            </div>
            <div className="space-y-1">
              <FieldLabel>Early-leave grace (min)</FieldLabel>
              <input type="number" min={0} value={s.early_departure_grace_min} onChange={(e) => setS({ ...s, early_departure_grace_min: Number(e.target.value) })} className={inputCls} />
            </div>
          </div>
          <p className="text-xs text-outline">
            Late = clock-in after {s.shift_start} + {s.late_grace_min} min · Early departure =
            clock-out before {s.shift_end} − {s.early_departure_grace_min} min.
          </p>
        </Card>

        <Card className="space-y-4 p-5">
          <div className="flex items-center gap-2">
            <Plane size={16} className="text-primary" strokeWidth={2.25} />
            <h2 className="text-sm font-semibold text-ink">Paid leave policy</h2>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <FieldLabel>Days credited / month</FieldLabel>
              <input type="number" min={0} step="0.5" value={s.monthly_leave_alloc} onChange={(e) => setS({ ...s, monthly_leave_alloc: Number(e.target.value) })} className={inputCls} />
            </div>
            <div className="space-y-1">
              <FieldLabel>Carry-forward (months)</FieldLabel>
              <input type="number" min={0} value={s.carry_forward_months} onChange={(e) => setS({ ...s, carry_forward_months: Number(e.target.value) })} className={inputCls} />
            </div>
          </div>
          <p className="text-xs text-outline">
            Changing these affects future monthly credits &amp; expiry — not already-issued balances.
          </p>
        </Card>

        <Card className="p-5">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={s.sandwich_enabled}
              onChange={(e) => setS({ ...s, sandwich_enabled: e.target.checked })}
              className="mt-0.5 h-4 w-4 rounded border-line-strong text-primary focus:ring-primary"
            />
            <span>
              <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                <Sandwich size={15} className="text-amber-600" />
                Sandwich leave rule
              </span>
              <span className="mt-0.5 block text-xs text-ink-muted">
                When on leave both Saturday and the following Monday, the Sunday in between is
                automatically counted as an unpaid leave day.
              </span>
            </span>
          </label>
        </Card>

        {error && <p className="rounded-lg bg-danger-tint px-3 py-2 text-sm text-danger-deep">{error}</p>}
        <div className="flex items-center gap-3">
          <button
            disabled={busy}
            className="h-11 rounded-lg bg-primary px-6 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save settings"}
          </button>
          {saved && <span className="text-sm font-medium text-success">✓ Saved</span>}
        </div>
      </form>
    </main>
  );
}
