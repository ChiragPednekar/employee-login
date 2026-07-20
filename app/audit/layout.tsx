import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import LogoutButton from "@/components/LogoutButton";
import { BriefcaseBusiness, ShieldCheck } from "lucide-react";

export default async function AuditLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: emp } = await supabase
    .from("employees")
    .select("id, name, role")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!emp) redirect("/login");
  // Audit route is exclusive to the audit role
  if (emp.role !== "audit") {
    redirect(emp.role === "admin" || emp.role === "manager" ? "/admin" : "/");
  }

  return (
    <div className="mx-auto min-h-dvh w-full max-w-6xl px-0 pb-10 lg:px-6">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-surface/95 px-4 backdrop-blur">
        <div className="flex items-center gap-2">
          <BriefcaseBusiness size={22} className="text-primary" strokeWidth={2.25} />
          <span className="text-lg font-bold tracking-tight text-primary">WorkLog</span>
          <span className="ml-1 flex items-center gap-1 rounded bg-primary-tint px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary-deep">
            <ShieldCheck size={11} />
            Audit
          </span>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-[13px] font-semibold text-ink">{emp.name}</p>
          <LogoutButton />
        </div>
      </header>
      {children}
      <p className="px-4 pt-6 text-center text-[11px] text-outline">
        Read-only audit access · you cannot modify attendance, leave, or settings
      </p>
    </div>
  );
}
