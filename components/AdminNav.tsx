"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  MapPin,
  Plane,
  CalendarClock,
  BarChart3,
  ShieldCheck,
  Users,
  Building2,
  CalendarDays,
  Lock,
  Timer,
} from "lucide-react";
import type { LucideProps } from "lucide-react";
import type { ComponentType } from "react";

type Tab = {
  href: string;
  label: string;
  icon: ComponentType<LucideProps>;
  adminOnly?: boolean;
};

const tabs: Tab[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/approvals", label: "Approvals", icon: MapPin },
  { href: "/admin/leaves", label: "Leaves", icon: Plane },
  { href: "/admin/attendance", label: "Attendance", icon: CalendarClock },
  { href: "/admin/analytics", label: "Analytics", icon: BarChart3, adminOnly: true },
  { href: "/admin/audit", label: "Audit", icon: ShieldCheck, adminOnly: true },
  { href: "/admin/employees", label: "Employees", icon: Users, adminOnly: true },
  { href: "/admin/locations", label: "Locations", icon: Building2, adminOnly: true },
  { href: "/admin/holidays", label: "Holidays", icon: CalendarDays, adminOnly: true },
  { href: "/admin/security", label: "Security", icon: Lock, adminOnly: true },
];

export default function AdminNav({ role }: { role: string }) {
  const pathname = usePathname();
  const visible = tabs.filter((t) => !t.adminOnly || role === "admin");
  return (
    <nav aria-label="Admin sections" className="scrollbar-none flex gap-1.5 overflow-x-auto px-3 pb-2.5">
      {visible.map((t) => {
        const active = pathname === t.href;
        const Icon = t.icon;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              active
                ? "bg-primary text-white"
                : "text-ink-muted hover:bg-surface-low hover:text-ink"
            }`}
          >
            <Icon size={15} strokeWidth={2.25} />
            {t.label}
          </Link>
        );
      })}
      {role === "manager" && (
        <Link
          href="/"
          className="ml-auto flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-low hover:text-ink"
        >
          <Timer size={15} strokeWidth={2.25} />
          My attendance
        </Link>
      )}
    </nav>
  );
}
