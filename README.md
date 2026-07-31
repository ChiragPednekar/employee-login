# WorkLog — Location-Based Attendance PWA

Attendance + leave management for field employees. Employees mark attendance from their phone; the app verifies their GPS location against admin-approved work locations.

## How it works

**Employee** (`/`)
- Logs in with email + password. First login: they set their own password ("First time here?" on the login page).
- **Clock In** → confirmation → GPS check against **every location the employee is cleared
  for** (their primary office plus any extra approved sites the admin granted them).
  - Inside any of them → session starts immediately, tagged with the matched site.
  - Outside all of them → **refused**. The press (time + coordinates) is recorded and sent
    to HR for permission; the timer does *not* run. On approval the clock starts from the
    approval moment. On denial no hours are credited.
- **Clock Out** → GPS checked again. Out of range → refused the same way; the employee
  stays clocked in until HR approves, then hours + overtime are saved.
- Employees with no assigned location at all fall back to matching any active approved location.
- The home screen lists every approved site with a Google map, the geofence circles drawn to
  scale, and a "Check location" button showing live distance to the nearest one.
- One session per day. Warning at 11 h, auto-cutoff at 12 h (server cron, runs every minute).
- Overtime = anything beyond 9 h/day.
- Leave tab: apply with date range / half-day + free-text reason; paid balance comes from the
  monthly `leave_ledger`; admin approves/denies with push both ways.

**Admin** (`/admin`)
- Overview: who's working now, pending requests.
- Approvals / Leaves: approve or deny with one tap.
- Attendance: monthly per-employee hours + overtime, CSV export.
- Employees: add employees (they activate on first login), set the **primary office**, grant
  **extra sites** they may also check in from, credit/deduct paid-leave days, deactivate.
- Locations: add / edit / disable / delete approved locations on a Google map (address search,
  tap or drag the pin), radius per location, and a count of how many staff each one covers.

### Paid leave

Balances live in `leave_ledger` (2 days credited per month, one month of carry-forward,
oldest-first consumption, automatic expiry). Both the admin Employees screen and the
employee home read it live via `leave_balances_all()` / `leave_status()`. The old
`leave_balances` (yearly quota/used) table is **vestigial** — nothing writes it, so any
screen reading it will show numbers frozen at the moment the ledger replaced it.
Admins adjust balances with `adjust_leave()` ("Adjust balance" on the Employees page),
which writes an audited `adjustment` row rather than editing a quota.

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

## Google Maps

Maps are used in two places: the admin Locations picker (address search + tap/drag the pin)
and the employee home map of approved sites.

Set **`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`** to switch them on. Without it the app still works —
the location picker falls back to the OpenStreetMap/Leaflet picker and the employee map is
hidden.

To create the key:

1. Google Cloud Console → **APIs & Services → Library** → enable **Maps JavaScript API**
   and **Geocoding API** (the second one powers the address search box).
2. **Credentials → Create credentials → API key.**
3. Restrict it: *Application restrictions* → **Websites**, allowing
   `https://worklog-attendance.vercel.app/*` and `http://localhost:3000/*`.
   *API restrictions* → limit to the two APIs above.
4. Add it to `.env.local` for local dev, and to Vercel → Project → Settings →
   **Environment Variables** for production, then redeploy.

The key ships in the browser bundle (that is unavoidable for a JS-API map), so the referrer
restriction in step 3 is what actually protects it — do not skip it.

## Deploying

Deploy to Vercel and set the `NEXT_PUBLIC_*` env vars. HTTPS is required for geolocation + push on phones (Vercel provides it automatically).
