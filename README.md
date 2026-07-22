# WorkLog — Location-Based Attendance PWA

Attendance + leave management for field employees. Employees mark attendance from their phone; the app verifies their GPS location against admin-approved work locations.

## How it works

**Employee** (`/`)
- Logs in with email + password. First login: they set their own password ("First time here?" on the login page).
- **Clock In** → confirmation → GPS check against the employee's assigned office (200 m radius).
  - In range → session starts immediately.
  - Out of range → **refused**. The press (time + coordinates) is recorded and sent to HR
    for permission; the timer does *not* run. On approval the clock starts from the
    approval moment. On denial no hours are credited.
- **Clock Out** → GPS checked again. Out of range → refused the same way; the employee
  stays clocked in until HR approves, then hours + overtime are saved.
- Employees with no assigned office fall back to matching any active approved location.
- One session per day. Warning at 11 h, auto-cutoff at 12 h (server cron, runs every minute).
- Overtime = anything beyond 9 h/day.
- Leave tab: apply with date range / half-day + free-text reason; yearly balance tracked; admin approves/denies with push both ways.

**Admin** (`/admin`)
- Overview: who's working now, pending requests.
- Approvals / Leaves: approve or deny with one tap.
- Attendance: monthly per-employee hours + overtime, CSV export.
- Employees: add employees (they activate on first login), edit leave quota, deactivate.
- Locations: add/edit approved locations ("Use my current location" helper), radius per location.

## Test accounts (temp seed data)

| Who | Email | Role |
|---|---|---|
| Admin | chiragpednekar3@gmail.com | admin |
| Employee | rahul@test.com | employee |
| Manager | priya@test.com | manager |
| Audit | amit@test.com | audit |

Passwords are deliberately **not** recorded here — this repo is public. Set or reset
them from `/admin/security`, or via "First time here?" on the login page.

> ⚠️ Earlier revisions of this file did contain the seed passwords, so they remain
> readable in git history. Treat every seed password as compromised and rotate it
> before this goes anywhere real.

## Stack

- **Next.js 16** (App Router) + Tailwind — PWA with service worker (`public/sw.js`) + web push.
- **Supabase** project `employee-attendance` (`pbxtegggoifdzdvcatfq`, ap-south-1):
  - Postgres with RLS; all business logic in `security definer` RPCs (`start_session`, `end_session`, `decide_session`, `apply_leave`, `decide_leave`).
  - `pg_cron` job (`session-maintenance`, every minute): 11 h warning, 12 h auto-close, triggers push delivery.
  - Edge functions: `activate-account` (first-login password set), `process-notifications` (drains `notification_queue`, sends web push via VAPID).
  - VAPID keys live in the `app_secrets` table (service-role only).
- Work dates use `Asia/Kolkata`.

## Run locally

```bash
npm install
npm run dev
```

Env vars are in `.env.local` (Supabase URL, anon key, VAPID public key). No service-role key is needed by the app.

## Deploying

Deploy to Vercel and set the three `NEXT_PUBLIC_*` env vars. HTTPS is required for geolocation + push on phones (Vercel provides it automatically).
