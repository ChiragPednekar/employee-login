"use client";

import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import type { LucideProps } from "lucide-react";

/* ------------------------------------------------------------------ *
 * "Precision Enterprise" design system (Stitch)
 * Inter · Action Blue #003ec7 · flat white cards with 1px #E2E8F0
 * borders (no heavy shadows) · 8-12px radii · uppercase micro-labels
 * tabular numerals · tinted borderless status chips
 * ------------------------------------------------------------------ */

export function Card({
  children,
  className = "",
  featured = false,
}: {
  children: ReactNode;
  className?: string;
  featured?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border border-line bg-white ${
        featured ? "border-t-4 border-t-primary" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

const TONE = {
  primary: { icon: "text-primary bg-primary-tint", value: "text-primary" },
  emerald: { icon: "text-success bg-success-tint", value: "text-success" },
  amber: { icon: "text-amber-600 bg-amber-50", value: "text-amber-600" },
  slate: { icon: "text-ink-muted bg-slate-100", value: "text-ink" },
} as const;

export type Tone = keyof typeof TONE;

export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = "slate",
  href,
  highlight,
  progress,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon: ComponentType<LucideProps>;
  tone?: Tone;
  href?: string;
  highlight?: boolean;
  /** 0..1 — renders a thin progress bar under the value (admin metric style) */
  progress?: number;
}) {
  const t = TONE[tone];
  const body = (
    <div className="flex h-full flex-col justify-between gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${t.icon}`}>
          <Icon size={20} strokeWidth={2} />
        </span>
        {sub && (
          <span className="rounded bg-surface-low px-2 py-1 text-[11px] font-semibold text-ink-muted">
            {sub}
          </span>
        )}
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">{label}</p>
        <p
          className={`mt-1 text-[26px] font-semibold leading-8 tracking-tight tabular-nums ${
            highlight ? t.value : "text-ink"
          }`}
        >
          {value}
        </p>
        {typeof progress === "number" && (
          <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-surface-low">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
  const cls = "rounded-xl border border-line bg-white transition-colors hover:bg-slate-50";
  return href ? (
    <Link href={href} className={`block ${cls} active:scale-[0.99]`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="px-0.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
      {children}
    </h2>
  );
}

export function Badge({
  children,
  tone = "slate",
}: {
  children: ReactNode;
  tone?: "emerald" | "amber" | "red" | "slate" | "indigo";
}) {
  const map = {
    emerald: "bg-success-chip text-success-deep",
    amber: "bg-amber-100 text-amber-800",
    red: "bg-danger-tint text-danger-deep",
    slate: "bg-slate-100 text-slate-600",
    indigo: "bg-primary-tint text-primary-deep",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${map[tone]}`}
    >
      {children}
    </span>
  );
}

export function QuickAction({
  label,
  icon: Icon,
  href,
}: {
  label: string;
  icon: ComponentType<LucideProps>;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-white px-3.5 text-sm font-medium text-ink transition-colors hover:border-primary hover:bg-surface-low hover:text-primary active:scale-[0.98]"
    >
      <Icon size={15} strokeWidth={2} />
      {label}
    </Link>
  );
}

export function PrimaryButton({
  children,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      {...props}
      className={`flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-6 text-sm font-semibold text-white transition-all duration-100 hover:bg-primary-hover active:scale-[0.98] disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      {...props}
      className={`flex h-11 items-center justify-center gap-2 rounded-lg border border-line-strong bg-white px-6 text-sm font-semibold text-ink transition-colors hover:bg-surface-low disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-slate-200/60 ${className}`} />;
}

export function EmptyState({
  icon: Icon,
  title,
  hint,
}: {
  icon: ComponentType<LucideProps>;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line-strong bg-white px-6 py-10 text-center">
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-surface-low text-ink-muted">
        <Icon size={20} strokeWidth={2} />
      </span>
      <p className="text-sm font-semibold text-ink">{title}</p>
      {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}

/** Uppercase input label per design system */
export function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-[11px] font-semibold uppercase tracking-wider text-ink-muted"
    >
      {children}
    </label>
  );
}

export const inputCls =
  "w-full h-11 rounded-lg border border-line-strong bg-white px-3 text-sm text-ink placeholder:text-outline outline-none transition-all focus:border-primary focus:ring-1 focus:ring-primary";
