import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Server-side gate for the admin-only sections. AdminNav merely *hides* these
 * tabs from managers; without this a manager could open them by URL and get a
 * working-looking screen whose writes RLS silently drops.
 */
export async function requireAdmin() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: emp } = await supabase
    .from("employees")
    .select("role")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!emp) redirect("/login");
  if (emp.role !== "admin") redirect("/admin");
  return emp;
}
