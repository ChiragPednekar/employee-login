"use client";

import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import type { LucideProps } from "lucide-react";

/* ------------------------------------------------------------------ *
 * WorkLog design system — Phase 1
 * Tokens: 8px spacing scale · 12px radius (rounded-xl) on cards/controls
 * Subtle 1px borders + soft shadows · restrained indigo/emerald/amber palette
 * ------------------------------------------------------------------ */

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${className}`}
    >
      {children}
    </div>
  );
}

const TONE = {
  indigo: { text: "text-indigo-600", bg: "bg-indigo-50", ring: "text-indigo-500" },
  emerald: { text: "text-emerald-600", bg: "bg-emerald-50", ring: "text-emerald-500" },
  amber: { text: "text-amber-600", bg: "bg-amber-50", ring: "text-amber-500" },
  slate: { text: "text-slate-900", bg: "bg-slate-100", ring: "text-slate-400" },
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
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon: ComponentType<LucideProps>;
  tone?: Tone;
  href?: string;
  highlight?: boolean;
}) {
  const t = TONE[tone];
  const body = (
    <div className="flex items-start justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <p className={`mt-1 text-2xl font-semibold tracking-tight ${highlight ? t.text : "text-slate-900"}`}>
          {value}
        </p>
        {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
      </div>
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${t.bg} ${t.ring}`}>
        <Icon size={18} strokeWidth={2.25} />
      </span>
    </div>
  );
  const cls =
    "rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:shadow-[0_2px_10px_rgba(15,23,42,0.06)]";
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
    <h2 className="px-0.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
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
    emerald: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-700",
    red: "bg-red-100 text-red-700",
    slate: "bg-slate-100 text-slate-600",
    indigo: "bg-indigo-100 text-indigo-700",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${map[tone]}`}>
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
      className="flex items-center gap-2 rounded-xl border border-slate-200/80 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:border-indigo-200 hover:bg-indigo-50/50 hover:text-indigo-700 active:scale-[0.98]"
    >
      <Icon size={16} strokeWidth={2.25} />
      {label}
    </Link>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-slate-200/70 ${className}`} />;
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
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white/60 px-6 py-10 text-center">
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        <Icon size={20} />
      </span>
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}
