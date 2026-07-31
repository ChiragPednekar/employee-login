"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { istToday, useMe } from "@/lib/hooks";
import type { Employee, LeaveBalanceRow } from "@/lib/types";
import Avatar from "@/components/Avatar";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Badge, Card, EmptyState, FieldLabel, inputCls } from "@/components/ui";
import { Search, UserPlus, X, Users, KeyRound, MapPin, Check } from "lucide-react";

const ROLE_TONE = { admin: "indigo", manager: "emerald", audit: "amber", employee: "slate" } as const;

const emptyForm = {
  emp_id: "",
  name: "",
  email: "",
  contact: "",
  role: "employee",
  department: "",
  manager_id: "",
  office_id: "",
};

export default function EmployeesPage() {
  const { me } = useMe();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [offices, setOffices] = useState<{ id: string; name: string }[]>([]);
  const [balances, setBalances] = useState<Record<string, LeaveBalanceRow>>({});
  /** Extra approved sites per employee, on top of their primary office. */
  const [extraSites, setExtraSites] = useState<Record<string, string[]>>({});
  const [sitesOpenFor, setSitesOpenFor] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [adjustEdit, setAdjustEdit] = useState<{ id: string; days: string; note: string } | null>(
    null
  );
  const [resetTarget, setResetTarget] = useState<Employee | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Filters
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [deptFilter, setDeptFilter] = useState("all");

  const year = Number(istToday().slice(0, 4));

  const refresh = useCallback(async () => {
    const supabase = supabaseBrowser();
    // Balances come live from the leave ledger — the old leave_balances table
    // was frozen at whatever it held when the ledger replaced it.
    const [{ data: emps }, { data: bals }, { data: locs }, { data: links }] = await Promise.all([
      supabase.from("employees").select("*").order("emp_id"),
      supabase.rpc("leave_balances_all"),
      supabase.from("locations").select("id, name").eq("active", true).order("name"),
      supabase.from("employee_locations").select("employee_id, location_id"),
    ]);
    setEmployees(emps ?? []);
    setBalances(
      Object.fromEntries(((bals ?? []) as LeaveBalanceRow[]).map((b) => [b.employee_id, b]))
    );
    setOffices(locs ?? []);
    const map: Record<string, string[]> = {};
    for (const l of (links ?? []) as { employee_id: string; location_id: string }[]) {
      (map[l.employee_id] ??= []).push(l.location_id);
    }
    setExtraSites(map);
  }, []);

  async function assignOffice(empId: string, officeId: string) {
    setError(null);
    const { error } = await supabaseBrowser()
      .from("employees")
      .update({ office_id: officeId || null })
      .eq("id", empId);
    if (error) setError(error.message);
    refresh();
  }

  /** Add or remove one extra site an employee may check in from. */
  async function toggleSite(empId: string, locationId: string, on: boolean) {
    setError(null);
    const supabase = supabaseBrowser();
    const { error } = on
      ? await supabase.from("employee_locations").insert({ employee_id: empId, location_id: locationId })
      : await supabase
          .from("employee_locations")
          .delete()
          .eq("employee_id", empId)
          .eq("location_id", locationId);
    if (error) setError(error.message);
    refresh();
  }

  useEffect(() => {
    refresh();
  }, [refresh]);

  const managers = employees.filter((e) => (e.role === "manager" || e.role === "admin") && e.active);
  const byId = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const departments = useMemo(
    () => [...new Set(employees.map((e) => e.department).filter(Boolean))].sort() as string[],
    [employees]
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return employees.filter((e) => {
      if (statusFilter === "active" && !e.active) return false;
      if (statusFilter === "inactive" && e.active) return false;
      if (roleFilter !== "all" && e.role !== roleFilter) return false;
      if (deptFilter !== "all" && (e.department ?? "—") !== deptFilter) return false;
      if (!needle) return true;
      return [e.name, e.emp_id, e.email, e.contact ?? "", e.department ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [employees, q, roleFilter, statusFilter, deptFilter]);

  // Group by department
  const grouped = useMemo(() => {
    const map = new Map<string, Employee[]>();
    for (const e of filtered) {
      const key = e.department ?? "No department";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!/^[A-Za-z0-9-]{2,20}$/.test(form.emp_id.trim()))
      errs.emp_id = "2–20 letters, numbers or dashes (e.g. EMP005)";
    if (form.name.trim().length < 2) errs.name = "Enter the full name";
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) errs.email = "Enter a valid email address";
    if (form.contact.trim() && !/^[0-9+\-\s]{7,15}$/.test(form.contact.trim()))
      errs.contact = "Enter a valid phone number";
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function addEmployee(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setBusy(true);
    setError(null);
    const supabase = supabaseBrowser();
    const { error } = await supabase
      .from("employees")
      .insert({
        emp_id: form.emp_id.trim().toUpperCase(),
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        contact: form.contact.trim() || null,
        role: form.role,
        department: form.department.trim() || null,
        manager_id: form.manager_id || null,
        office_id: form.office_id || null,
      })
      .select()
      .single();
    setBusy(false);
    if (error) {
      setError(
        error.message.includes("duplicate")
          ? "An employee with this Emp ID or email already exists."
          : error.message
      );
      return;
    }
    setForm(emptyForm);
    setFormErrors({});
    setShowForm(false);
    refresh();
  }

  /** Credit (+) or deduct (−) paid-leave days against the ledger. */
  async function saveAdjustment() {
    if (!adjustEdit) return;
    const days = Number(adjustEdit.days);
    if (isNaN(days) || days === 0) {
      setError("Enter a non-zero number of days (use −1 to deduct).");
      return;
    }
    setError(null);
    setNotice(null);
    const { error } = await supabaseBrowser().rpc("adjust_leave", {
      p_emp: adjustEdit.id,
      p_days: days,
      p_note: adjustEdit.note,
    });
    if (error) {
      setError(error.message);
      return;
    }
    const who = employees.find((e) => e.id === adjustEdit.id)?.name ?? "Employee";
    setNotice(`${days > 0 ? "Credited" : "Deducted"} ${Math.abs(days)} day(s) for ${who}.`);
    setAdjustEdit(null);
    refresh();
  }

  async function toggleActive(emp: Employee) {
    setError(null);
    const { data, error } = await supabaseBrowser()
      .from("employees")
      .update({ active: !emp.active })
      .eq("id", emp.id)
      .select();
    if (error) {
      setError(error.message);
      return;
    }
    if (!data || data.length === 0) {
      setError(`${emp.name} wasn't updated — only an admin can change employees.`);
      return;
    }
    refresh();
  }

  async function doReset() {
    if (!resetTarget) return;
    setResetBusy(true);
    setError(null);
    setNotice(null);
    const { data, error } = await supabaseBrowser().functions.invoke("admin-reset-password", {
      body: { employee_id: resetTarget.id },
    });
    setResetBusy(false);
    if (error || !data?.ok) {
      let msg = "Could not reset this login.";
      try {
        const body = await (error as { context?: Response })?.context?.json();
        if (body?.error) msg = body.error;
      } catch {}
      setError(msg);
      setResetTarget(null);
      return;
    }
    setNotice(
      `${resetTarget.name}'s login was reset. They can now set a new password via “First time here?” with their email.`
    );
    setResetTarget(null);
    refresh();
  }

  const inactiveCount = employees.filter((e) => !e.active).length;

  return (
    <main className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Employees</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
        >
          {showForm ? <X size={15} /> : <UserPlus size={15} />}
          {showForm ? "Close" : "Add employee"}
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <Card className="p-5">
          <form onSubmit={addEmployee} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <FieldLabel>Emp ID</FieldLabel>
                <input
                  required
                  placeholder="EMP005"
                  value={form.emp_id}
                  onChange={(e) => setForm({ ...form, emp_id: e.target.value })}
                  className={inputCls}
                />
                {formErrors.emp_id && <p className="text-xs text-danger">{formErrors.emp_id}</p>}
              </div>
              <div className="space-y-1">
                <FieldLabel>Full name</FieldLabel>
                <input
                  required
                  placeholder="Full name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className={inputCls}
                />
                {formErrors.name && <p className="text-xs text-danger">{formErrors.name}</p>}
              </div>
            </div>
            <div className="space-y-1">
              <FieldLabel>Email (used to log in)</FieldLabel>
              <input
                required
                type="email"
                placeholder="name@company.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className={inputCls}
              />
              {formErrors.email && <p className="text-xs text-danger">{formErrors.email}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <FieldLabel>Contact</FieldLabel>
                <input
                  placeholder="98xxxxxxxx"
                  value={form.contact}
                  onChange={(e) => setForm({ ...form, contact: e.target.value })}
                  className={inputCls}
                />
                {formErrors.contact && <p className="text-xs text-danger">{formErrors.contact}</p>}
              </div>
              <div className="space-y-1">
                <FieldLabel>Department</FieldLabel>
                <input
                  placeholder="e.g. Field Operations"
                  list="departments"
                  value={form.department}
                  onChange={(e) => setForm({ ...form, department: e.target.value })}
                  className={inputCls}
                />
                <datalist id="departments">
                  {departments.map((d) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <FieldLabel>Role</FieldLabel>
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  className={inputCls}
                >
                  <option value="employee">Employee</option>
                  <option value="manager">Manager</option>
                  <option value="audit">Audit</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="space-y-1">
                <FieldLabel>Reports to</FieldLabel>
                <select
                  value={form.manager_id}
                  onChange={(e) => setForm({ ...form, manager_id: e.target.value })}
                  className={inputCls}
                >
                  <option value="">— No manager —</option>
                  {managers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.role})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <FieldLabel>Assigned office (for geofenced attendance)</FieldLabel>
              <select
                value={form.office_id}
                onChange={(e) => setForm({ ...form, office_id: e.target.value })}
                className={inputCls}
              >
                <option value="">— No office (uses approval fallback) —</option>
                {offices.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            {error && (
              <p className="rounded-lg bg-danger-tint px-3 py-2 text-sm text-danger-deep">{error}</p>
            )}
            <button
              disabled={busy}
              className="h-11 w-full rounded-lg bg-primary text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              {busy ? "Adding…" : "Add employee"}
            </button>
            <p className="text-xs text-outline">
              The employee sets their own password the first time they open the app.
            </p>
          </form>
        </Card>
      )}

      {notice && (
        <p className="rounded-lg bg-success-chip px-3 py-2 text-sm text-success-deep">{notice}</p>
      )}
      {error && !showForm && (
        <p className="rounded-lg bg-danger-tint px-3 py-2 text-sm text-danger-deep">{error}</p>
      )}

      {/* Search + filters */}
      <div className="space-y-2">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
          <input
            type="search"
            aria-label="Search employees"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, ID, email, phone, department…"
            className={`${inputCls} pl-9`}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            aria-label="Filter by role"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="h-9 rounded-lg border border-line-strong bg-white px-2.5 text-sm text-ink"
          >
            <option value="all">All roles</option>
            <option value="admin">Admins</option>
            <option value="manager">Managers</option>
            <option value="employee">Employees</option>
          </select>
          <select
            aria-label="Filter by department"
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            className="h-9 rounded-lg border border-line-strong bg-white px-2.5 text-sm text-ink"
          >
            <option value="all">All departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
            <option value="—">No department</option>
          </select>
          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 rounded-lg border border-line-strong bg-white px-2.5 text-sm text-ink"
          >
            <option value="active">Active</option>
            <option value="inactive">Deactivated{inactiveCount ? ` (${inactiveCount})` : ""}</option>
            <option value="all">All statuses</option>
          </select>
        </div>
      </div>

      {/* Grouped list */}
      {grouped.length === 0 ? (
        <EmptyState icon={Users} title="No employees match" hint="Try changing the search or filters." />
      ) : (
        grouped.map(([dept, list]) => (
          <div key={dept} className="space-y-2">
            <p className="flex items-center gap-2 px-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
              {dept}
              <span className="rounded bg-surface-low px-1.5 py-0.5 text-[10px] text-outline">
                {list.length}
              </span>
            </p>
            <Card className="overflow-hidden">
              <div className="divide-y divide-line">
                {list.map((emp) => {
                  const bal = balances[emp.id];
                  const mgr = emp.manager_id ? byId.get(emp.manager_id) : null;
                  return (
                    <div
                      key={emp.id}
                      className={`px-4 py-3.5 transition-colors hover:bg-slate-50 ${
                        !emp.active ? "opacity-60" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <Avatar name={emp.name} />
                          <div className="min-w-0">
                            <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-ink">
                              <span className="truncate">{emp.name}</span>
                              <span className="text-xs font-normal text-outline">{emp.emp_id}</span>
                              {emp.role !== "employee" && (
                                <Badge tone={ROLE_TONE[emp.role]}>{emp.role}</Badge>
                              )}
                              {!emp.active && <Badge tone="red">deactivated</Badge>}
                              {!emp.auth_user_id && emp.active && (
                                <Badge tone="slate">not activated</Badge>
                              )}
                            </p>
                            <p className="truncate text-[13px] text-ink-muted">
                              {emp.email}
                              {emp.contact ? ` · ${emp.contact}` : ""}
                              {mgr ? ` · reports to ${mgr.name}` : ""}
                            </p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {emp.active && emp.auth_user_id && emp.id !== me?.id && (
                            <button
                              onClick={() => setResetTarget(emp)}
                              title="Reset password"
                              className="flex h-8 items-center gap-1 rounded-lg bg-slate-100 px-2.5 text-xs font-semibold text-ink-muted transition-colors hover:bg-slate-200"
                            >
                              <KeyRound size={13} />
                              Reset
                            </button>
                          )}
                          <button
                            onClick={() => toggleActive(emp)}
                            className={`h-8 rounded-lg px-2.5 text-xs font-semibold transition-colors ${
                              emp.active
                                ? "bg-slate-100 text-ink-muted hover:bg-slate-200"
                                : "bg-success-chip text-success-deep"
                            }`}
                          >
                            {emp.active ? "Deactivate" : "Reactivate"}
                          </button>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 pl-[52px] text-[13px]">
                        <label className="flex items-center gap-1.5 text-ink-muted">
                          Primary office:
                          <select
                            aria-label={`Assign primary office for ${emp.name}`}
                            value={emp.office_id ?? ""}
                            onChange={(e) => assignOffice(emp.id, e.target.value)}
                            className="h-7 rounded-lg border border-line-strong bg-white px-2 text-xs text-ink"
                          >
                            <option value="">None</option>
                            {offices.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.name}
                              </option>
                            ))}
                          </select>
                        </label>

                        <button
                          onClick={() => setSitesOpenFor(sitesOpenFor === emp.id ? null : emp.id)}
                          aria-expanded={sitesOpenFor === emp.id}
                          className="flex h-7 items-center gap-1 rounded-lg border border-line-strong bg-white px-2 text-xs font-semibold text-primary transition-colors hover:bg-surface-low"
                        >
                          <MapPin size={12} />
                          {(extraSites[emp.id]?.length ?? 0) > 0
                            ? `+${extraSites[emp.id].length} more site${
                                extraSites[emp.id].length !== 1 ? "s" : ""
                              }`
                            : "Add other sites"}
                        </button>

                        <span className="text-ink-muted">
                          Paid leave:{" "}
                          <b className="tabular-nums text-ink">
                            {bal ? bal.total_available : "—"}
                          </b>{" "}
                          available
                          {bal && bal.pending_days > 0 && (
                            <span className="text-amber-600"> · {bal.pending_days} pending</span>
                          )}
                          {bal && bal.taken_this_year > 0 && (
                            <span className="text-outline"> · {bal.taken_this_year} taken in {year}</span>
                          )}
                        </span>

                        {adjustEdit?.id === emp.id ? (
                          <span className="flex flex-wrap items-center gap-1.5">
                            <input
                              type="number"
                              step="0.5"
                              aria-label="Days to credit or deduct"
                              placeholder="+1 / −1"
                              value={adjustEdit.days}
                              onChange={(e) =>
                                setAdjustEdit({ ...adjustEdit, days: e.target.value })
                              }
                              className="h-7 w-20 rounded-lg border border-line-strong px-2 text-sm"
                            />
                            <input
                              aria-label="Reason for the adjustment"
                              placeholder="Reason"
                              value={adjustEdit.note}
                              onChange={(e) =>
                                setAdjustEdit({ ...adjustEdit, note: e.target.value })
                              }
                              className="h-7 w-40 rounded-lg border border-line-strong px-2 text-sm"
                            />
                            <button
                              onClick={saveAdjustment}
                              className="text-xs font-bold text-success"
                            >
                              Apply
                            </button>
                            <button
                              onClick={() => setAdjustEdit(null)}
                              className="text-xs text-outline"
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() => setAdjustEdit({ id: emp.id, days: "", note: "" })}
                            className="text-xs font-semibold text-primary hover:underline"
                          >
                            Adjust balance
                          </button>
                        )}
                      </div>

                      {sitesOpenFor === emp.id && (
                        <div className="mt-2 ml-[52px] rounded-lg border border-line bg-surface-low p-3">
                          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                            Other sites {emp.name.split(" ")[0]} may check in from
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {offices.filter((o) => o.id !== emp.office_id).length === 0 ? (
                              <p className="text-xs text-ink-muted">
                                No other locations yet — add them on the Locations page.
                              </p>
                            ) : (
                              offices
                                .filter((o) => o.id !== emp.office_id)
                                .map((o) => {
                                  const on = extraSites[emp.id]?.includes(o.id) ?? false;
                                  return (
                                    <button
                                      key={o.id}
                                      onClick={() => toggleSite(emp.id, o.id, !on)}
                                      aria-pressed={on}
                                      className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                                        on
                                          ? "border-primary bg-primary text-white"
                                          : "border-line-strong bg-white text-ink-muted hover:bg-white"
                                      }`}
                                    >
                                      {on && <Check size={11} />}
                                      {o.name}
                                    </button>
                                  );
                                })
                            )}
                          </div>
                          <p className="mt-2 text-[11px] text-outline">
                            {emp.office_id
                              ? "Their primary office is always allowed. Selected sites are allowed too — anywhere else still needs your approval."
                              : "With no primary office, this employee may check in at any active location. Set a primary office to lock them down."}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        ))
      )}

      <ConfirmDialog
        open={!!resetTarget}
        title="Reset this login?"
        message={`${resetTarget?.name}'s password will be cleared. Their attendance and leave history stay intact — they'll set a new password via “First time here?” with their email. Do this only if they've forgotten their password.`}
        confirmLabel="Reset login"
        danger
        busy={resetBusy}
        onConfirm={doReset}
        onCancel={() => setResetTarget(null)}
      />
    </main>
  );
}
