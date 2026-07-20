export type Employee = {
  id: string;
  emp_id: string;
  name: string;
  email: string;
  contact: string | null;
  role: "employee" | "manager" | "admin" | "audit";
  department: string | null;
  manager_id: string | null;
  office_id: string | null;
  auth_user_id: string | null;
  active: boolean;
};

export type LeaveStatus = {
  current_month: string;
  current_days: number;
  carried_days: number;
  total_available: number;
  expiring_days: number;
  expiring_on: string;
};

export type LeaveLedgerEntry = {
  id: string;
  employee_id: string;
  alloc_month: string;
  kind: "allocation" | "consumption" | "expiry" | "adjustment";
  days: number;
  leave_request_id: string | null;
  note: string | null;
  created_at: string;
};

export type WorkLocation = {
  id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  radius_m: number;
  active: boolean;
};

export type SessionStatus =
  | "pending_approval"
  | "active"
  | "completed"
  | "auto_closed"
  | "denied";

export type WorkSession = {
  id: string;
  employee_id: string;
  work_date: string;
  started_at: string;
  ended_at: string | null;
  start_location_id: string | null;
  end_location_id: string | null;
  end_out_of_range: boolean;
  status: SessionStatus;
  total_minutes: number | null;
  overtime_minutes: number | null;
  warned_11h: boolean;
};

export type LeaveRequest = {
  id: string;
  employee_id: string;
  start_date: string;
  end_date: string;
  day_part: "full" | "first_half" | "second_half";
  days: number;
  reason: string;
  status: "pending" | "approved" | "denied" | "cancelled";
  paid_days?: number;
  unpaid_days?: number;
  created_at: string;
};

export type LeaveBalance = {
  employee_id: string;
  year: number;
  quota: number;
  used: number;
};

export type Holiday = {
  id: string;
  holiday_date: string;
  name: string;
};

export type TeamStatus = {
  name: string;
  emp_id: string;
  status: "working" | "on leave" | "done today" | "off";
};
