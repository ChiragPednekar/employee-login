"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Holiday } from "@/lib/types";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function ymd(d: Date) {
  return d.toLocaleDateString("en-CA");
}

/**
 * Calendar range picker. In "single" mode only `start` is used.
 * Weekends are dimmed, holidays get a dot + tooltip. Past days disabled.
 */
export default function DateRangePicker({
  start,
  end,
  mode,
  holidays,
  minDate,
  onChange,
}: {
  start: string;
  end: string;
  mode: "range" | "single";
  holidays: Holiday[];
  minDate: string;
  onChange: (start: string, end: string) => void;
}) {
  const [view, setView] = useState(() => {
    const d = new Date(start || minDate);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  // In range mode, once a start is chosen and we're waiting for the end
  const [picking, setPicking] = useState<"start" | "end">("start");

  const holidayMap = new Map(holidays.map((h) => [h.holiday_date, h.name]));

  const year = view.getFullYear();
  const month = view.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
  ];

  function handleClick(d: Date) {
    const key = ymd(d);
    if (mode === "single") {
      onChange(key, key);
      return;
    }
    if (picking === "start" || (start && key < start)) {
      onChange(key, key);
      setPicking("end");
    } else {
      onChange(start, key);
      setPicking("start");
    }
  }

  return (
    <div className="rounded-xl border border-line bg-white p-3">
      <div className="mb-2 flex items-center justify-between px-1">
        <button
          type="button"
          onClick={() => setView(new Date(year, month - 1, 1))}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-low"
          aria-label="Previous month"
        >
          <ChevronLeft size={18} />
        </button>
        <p className="text-sm font-semibold text-ink">
          {view.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        </p>
        <button
          type="button"
          onClick={() => setView(new Date(year, month + 1, 1))}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-low"
          aria-label="Next month"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="mb-1 grid grid-cols-7">
        {WEEKDAYS.map((w, i) => (
          <div
            key={i}
            className={`py-1 text-center text-[11px] font-semibold ${
              i === 0 || i === 6 ? "text-outline" : "text-ink-muted"
            }`}
          >
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const key = ymd(d);
          const dow = d.getDay();
          const isWeekend = dow === 0 || dow === 6;
          const holiday = holidayMap.get(key);
          const disabled = key < minDate;
          const isStart = key === start;
          const isEnd = mode === "range" && key === end && end !== start;
          const inRange = mode === "range" && start && end && key > start && key < end;
          const selected = isStart || isEnd;

          const dateLabel = d.toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
          });
          return (
            <button
              key={i}
              type="button"
              disabled={disabled}
              onClick={() => handleClick(d)}
              title={holiday}
              aria-label={holiday ? `${dateLabel} — ${holiday}` : dateLabel}
              aria-pressed={selected || inRange ? true : false}
              className={`relative flex h-9 items-center justify-center rounded-lg text-sm transition-colors ${
                selected
                  ? "bg-primary font-semibold text-white"
                  : inRange
                    ? "bg-primary-tint text-primary-deep"
                    : disabled
                      ? "cursor-not-allowed text-slate-300"
                      : isWeekend
                        ? "text-outline hover:bg-surface-low"
                        : "text-ink hover:bg-surface-low"
              }`}
            >
              {d.getDate()}
              {holiday && !selected && (
                <span className="absolute bottom-1 h-1 w-1 rounded-full bg-danger" />
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-1 pt-2 text-[11px] text-ink-muted">
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full bg-primary" /> Selected
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-danger" /> Holiday
        </span>
        <span className="text-outline">Weekends dimmed</span>
      </div>
    </div>
  );
}
