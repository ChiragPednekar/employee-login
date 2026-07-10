# WorkLog — Location-Based Attendance PWA

Attendance + leave management for field employees. Employees mark attendance from their phone; the app verifies their GPS location against admin-approved work locations.

## How it works

**Employee** (`/`)
- Logs in with email + password. First login: they set their own password ("First time here?" on the login page).
- **Start** button → confirmation → GPS check against approved locations (default 200 m radius).
  - In range → session starts immediately.
  - Out of range → session starts as *pending* and admins get a push notification to approve/deny. Time counts from the button press.
- **Work Done** → GPS checked again (out-of-range checkouts are flagged for admin), hours + overtime saved.
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

| Who | Email | Password |
|---|---|---|
| Admin | chiragpednekar3@gmail.com | admin123 |
| Employee | rahul@test.com | password123 |
| Employee | priya@test.com | priya1234 |
| Employee (not yet activated) | amit@test.com | — use "First time here?" |

⚠️ Change the admin password before going live.

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
