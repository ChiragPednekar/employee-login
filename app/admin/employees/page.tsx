"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { istToday } from "@/lib/hooks";
import type { Employee, LeaveBalance } from "@/lib/types";

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [balances, setBalances] = useState<Record<string, LeaveBalance>>({});
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ emp_id: "", name: "", email: "", contact: "", role: "employee" });
  const [quotaEdit, setQuotaEdit] = useState<{ id: string; quota: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const year = Number(istToday().slice(0, 4));

  const refresh = useCallback(async () => {
    const supabase = supabaseBrowser();
    const [{ data: emps }, { data: bals }] = await Promise.all([
      supabase.from("employees").select("*").order("emp_id"),
      supabase.from("leave_balances").select("*").eq("year", year),
    ]);
    setEmployees(emps ?? []);
    setBalances(Object.fromEntries((bals ?? []).map((b: LeaveBalance) => [b.employee_id, b])));
  }, [year]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function addEmployee(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = supabaseBrowser();
    const { data, error } = await supabase
      .from("employees")
      .insert({
        emp_id: form.emp_id.trim(),
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        contact: form.contact.trim() || null,
        role: form.role,
      })
      .select()
      .single();
    if (!error && data) {
      await supabase.from("leave_balances").insert({ employee_id: data.id, year, quota: 12, used: 0 });
    }
    setBusy(false);
    if (error) {
      setError(error.message.includes("duplicate") ? "An employee with this Emp ID or email already exists." : error.message);
      return;
    }
    setForm({ emp_id: "", name: "", email: "", contact: "", role: "employee" });
    setShowForm(false);
    refresh();
  }

  async function saveQuota() {
    if (!quotaEdit) return;
    const q = Number(quotaEdit.quota);
    if (isNaN(q) || q < 0) return;
    await supabaseBrowser()
      .from("leave_balances")
      .upsert({ employee_id: quotaEdit.id, year, quota: q }, { onConflict: "employee_id,year" });
    setQuotaEdit(null);
    refresh();
  }

  async function toggleActive(emp: Employee) {
    await supabaseBrowser().from("employees").update({ active: !emp.active }).eq("id", emp.id);
    refresh();
  }

  return (
    <main className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Employees</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
        >
          {showForm ? "Close" : "+ Add employee"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={addEmployee} className="space-y-3 rounded-xl border border-line bg-white p-5">
          <div className="grid grid-cols-2 gap-3">
            <input
              required
              placeholder="Emp ID (e.g. EMP005)"
              value={form.emp_id}
              onChange={(e) => setForm({ ...form, emp_id: e.target.value })}
              className="rounded-lg border border-line-strong px-3 py-2 text-sm"
            />
            <input
              required
              placeholder="Full name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="rounded-lg border border-line-strong px-3 py-2 text-sm"
            />
          </div>
          <input
            required
            type="email"
            placeholder="Email (they log in with this)"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="w-full rounded-lg border border-line-strong px-3 py-2 text-sm"
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              placeholder="Contact number"
              value={form.contact}
              onChange={(e) => setForm({ ...form, contact: e.target.value })}
              className="rounded-lg border border-line-strong px-3 py-2 text-sm"
            />
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              className="rounded-lg border border-line-strong bg-white px-3 py-2 text-sm"
            >
              <option value="employee">Employee</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          {error && <p className="rounded-lg bg-danger-tint px-3 py-2 text-sm text-danger-deep">{error}</p>}
          <button
            disabled={busy}
            className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
          >
            {busy ? "Adding…" : "Add employee"}
          </button>
          <p className="text-xs text-outline">
            The employee sets their own password the first time they open the app.
          </p>
        </form>
      )}

      <div className="space-y-2">
        {employees.map((emp) => {
          const bal = balances[emp.id];
          return (
            <div key={emp.id} className={`rounded-xl border border-line bg-white p-4 ${!emp.active ? "opacity-50" : ""}`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-bold">
                    {emp.name}{" "}
                    <span className="text-xs font-normal text-outline">{emp.emp_id}</span>
                    {emp.role === "admin" && (
                      <span className="ml-1.5 rounded-full bg-primary-tint px-2 py-0.5 text-xs font-semibold text-primary-deep">
                        admin
                      </span>
                    )}
                    {!emp.auth_user_id && (
                      <span className="ml-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-ink-muted">
                        not activated
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-ink-muted">
                    {emp.email}
                    {emp.contact ? ` · ${emp.contact}` : ""}
                  </p>
                </div>
                <button
                  onClick={() => toggleActive(emp)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                    emp.active ? "bg-slate-100 text-ink-muted" : "bg-emerald-100 text-emerald-700"
                  }`}
                >
                  {emp.active ? "Deactivate" : "Reactivate"}
                </button>
              </div>
              <div className="mt-2 flex items-center gap-2 text-sm">
                <span className="text-ink-muted">
                  Leave {year}: <b>{bal ? `${bal.quota - bal.used} / ${bal.quota}` : "—"}</b> left
                </span>
                {quotaEdit?.id === emp.id ? (
                  <span className="flex items-center gap-1.5">
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={quotaEdit.quota}
                      onChange={(e) => setQuotaEdit({ id: emp.id, quota: e.target.value })}
                      className="w-20 rounded-lg border border-line-strong px-2 py-1 text-sm"
                    />
                    <button onClick={saveQuota} className="text-xs font-bold text-emerald-600">
                      Save
                    </button>
                    <button onClick={() => setQuotaEdit(null)} className="text-xs text-outline">
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setQuotaEdit({ id: emp.id, quota: String(bal?.quota ?? 12) })}
                    className="text-xs font-semibold text-primary"
                  >
                    Edit quota
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
