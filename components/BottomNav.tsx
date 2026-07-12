"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, History, Plane } from "lucide-react";
import type { LucideProps } from "lucide-react";
import type { ComponentType } from "react";

const tabs: { href: string; label: string; icon: ComponentType<LucideProps> }[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/history", label: "History", icon: History },
  { href: "/leave", label: "Leave", icon: Plane },
];

export default function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-2xl">
        {tabs.map((t) => {
          const active = pathname === t.href;
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-semibold ${
                active ? "text-primary" : "text-ink-muted hover:text-ink"
              }`}
            >
              <Icon size={20} strokeWidth={active ? 2.5 : 2} />
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
