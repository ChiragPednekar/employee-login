import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import LogoutButton from "@/components/LogoutButton";
import PushSetup from "@/components/PushSetup";
import AdminNav from "@/components/AdminNav";

export default async function AdminLayout({
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
  if (emp.role !== "admin") redirect("/");

  return (
    <div className="mx-auto min-h-dvh max-w-3xl pb-10">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <p className="text-sm font-bold">{emp.name}</p>
            <p className="text-xs text-indigo-600">Admin</p>
          </div>
          <LogoutButton />
        </div>
        <AdminNav />
      </header>
      {children}
      <PushSetup employeeId={emp.id} />
    </div>
  );
}
