"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  MapPin,
  Plane,
  CalendarClock,
  Users,
  Building2,
} from "lucide-react";
import type { LucideProps } from "lucide-react";
import type { ComponentType } from "react";

const tabs: { href: string; label: string; icon: ComponentType<LucideProps> }[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/approvals", label: "Approvals", icon: MapPin },
  { href: "/admin/leaves", label: "Leaves", icon: Plane },
  { href: "/admin/attendance", label: "Attendance", icon: CalendarClock },
  { href: "/admin/employees", label: "Employees", icon: Users },
  { href: "/admin/locations", label: "Locations", icon: Building2 },
];

export default function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="scrollbar-none flex gap-1.5 overflow-x-auto px-3 pb-2.5">
      {tabs.map((t) => {
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
    </nav>
  );
}
