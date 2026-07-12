import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import BottomNav from "@/components/BottomNav";
import LogoutButton from "@/components/LogoutButton";
import PushSetup from "@/components/PushSetup";
import { BriefcaseBusiness } from "lucide-react";

export default async function EmployeeLayout({
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
    .select("id, name, emp_id, role")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!emp) redirect("/login");
  if (emp.role === "admin") redirect("/admin");

  return (
    <div className="mx-auto min-h-dvh w-full max-w-2xl pb-20">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-surface/95 px-4 backdrop-blur">
        <div className="flex items-center gap-2">
          <BriefcaseBusiness size={22} className="text-primary" strokeWidth={2.25} />
          <span className="text-lg font-bold tracking-tight text-primary">WorkLog</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-[13px] font-semibold leading-4 text-ink">{emp.name}</p>
            <p className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">
              {emp.emp_id}
            </p>
          </div>
          <LogoutButton />
        </div>
      </header>
      {children}
      <BottomNav />
      <PushSetup employeeId={emp.id} />
    </div>
  );
}
