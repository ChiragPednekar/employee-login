"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { istToday } from "@/lib/hooks";
import type { Holiday } from "@/lib/types";
import { Card, FieldLabel, inputCls, EmptyState } from "@/components/ui";
import { CalendarDays, Plus, X, Trash2 } from "lucide-react";

export default function HolidaysPage() {
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const { data } = await supabaseBrowser()
      .from("holidays")
      .select("*")
      .order("holiday_date");
    setHolidays(data ?? []);
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!date) {
      setError("Pick a date");
      return;
    }
    if (name.trim().length < 2) {
      setError("Give the holiday a name");
      return;
    }
    setBusy(true);
    const { error } = await supabaseBrowser()
      .from("holidays")
      .insert({ holiday_date: date, name: name.trim() });
    setBusy(false);
    if (error) {
      setError(
        error.message.includes("duplicate")
          ? "A holiday already exists on that date."
          : error.message
      );
      return;
    }
    setDate("");
    setName("");
    setShowForm(false);
    refresh();
  }

  async function remove(h: Holiday) {
    await supabaseBrowser().from("holidays").delete().eq("id", h.id);
    refresh();
  }

  const today = istToday();
  const { upcoming, past } = useMemo(() => {
    return {
      upcoming: holidays.filter((h) => h.holiday_date >= today),
      past: holidays.filter((h) => h.holiday_date < today).reverse(),
    };
  }, [holidays, today]);

  function Row({ h, isPast }: { h: Holiday; isPast?: boolean }) {
    const d = new Date(h.holiday_date);
    return (
      <div className="flex items-center justify-between px-5 py-3.5">
        <div className="flex items-center gap-3">
          <span
            className={`flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg ${
              isPast ? "bg-slate-100" : "bg-primary-tint"
            }`}
          >
            <span
              className={`text-[10px] font-semibold uppercase leading-none ${
                isPast ? "text-ink-muted" : "text-primary-deep"
              }`}
            >
              {d.toLocaleDateString("en-US", { month: "short", timeZone: "Asia/Kolkata" })}
            </span>
            <span className={`text-sm font-bold leading-tight ${isPast ? "text-ink-muted" : "text-primary"}`}>
              {d.toLocaleDateString("en-US", { day: "numeric", timeZone: "Asia/Kolkata" })}
            </span>
          </span>
          <div>
            <p className="text-sm font-semibold text-ink">{h.name}</p>
            <p className="text-xs text-ink-muted">
              {d.toLocaleDateString("en-US", {
                weekday: "long",
                year: "numeric",
                timeZone: "Asia/Kolkata",
              })}
            </p>
          </div>
        </div>
        <button
          onClick={() => remove(h)}
          aria-label={`Delete ${h.name}`}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-danger-tint hover:text-danger"
        >
          <Trash2 size={16} />
        </button>
      </div>
    );
  }

  return (
    <main className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Holiday calendar</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
        >
          {showForm ? <X size={15} /> : <Plus size={15} />}
          {showForm ? "Close" : "Add holiday"}
        </button>
      </div>

      {showForm && (
        <Card className="p-5">
          <form onSubmit={add} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <FieldLabel>Date</FieldLabel>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div className="space-y-1">
                <FieldLabel>Name</FieldLabel>
                <input
                  placeholder="e.g. Diwali"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>
            {error && (
              <p className="rounded-lg bg-danger-tint px-3 py-2 text-sm text-danger-deep">{error}</p>
            )}
            <button
              disabled={busy}
              className="h-11 w-full rounded-lg bg-primary text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              {busy ? "Adding…" : "Add holiday"}
            </button>
          </form>
        </Card>
      )}

      {loaded && holidays.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="No holidays added"
          hint="Add your company's holidays so they show on employees' calendars."
        />
      ) : (
        <>
          {upcoming.length > 0 && (
            <div className="space-y-2">
              <p className="px-0.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                Upcoming
              </p>
              <Card className="overflow-hidden">
                <div className="divide-y divide-line">
                  {upcoming.map((h) => (
                    <Row key={h.id} h={h} />
                  ))}
                </div>
              </Card>
            </div>
          )}
          {past.length > 0 && (
            <div className="space-y-2">
              <p className="px-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                Past
              </p>
              <Card className="overflow-hidden">
                <div className="divide-y divide-line">
                  {past.map((h) => (
                    <Row key={h.id} h={h} isPast />
                  ))}
                </div>
              </Card>
            </div>
          )}
        </>
      )}
    </main>
  );
}
