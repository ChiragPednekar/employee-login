import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import BottomNav from "@/components/BottomNav";
import LogoutButton from "@/components/LogoutButton";
import PushSetup from "@/components/PushSetup";

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
    <div className="mx-auto min-h-dvh max-w-md pb-20">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur">
        <div>
          <p className="text-sm font-bold">{emp.name}</p>
          <p className="text-xs text-slate-500">{emp.emp_id}</p>
        </div>
        <LogoutButton />
      </header>
      {children}
      <BottomNav />
      <PushSetup employeeId={emp.id} />
    </div>
  );
}
