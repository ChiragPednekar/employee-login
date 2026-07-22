# WorkLog — verification guide

Two layers: **automated SQL** (business rules, no login needed) and **manual UI**
(needs a real signed-in session, so it can't be scripted here).

---

## 1. Automated — run these first

```bash
psql "$DATABASE_URL" -f tests/business-rules.sql       # T1-T9  leave, sandwich, geofence math
psql "$DATABASE_URL" -f tests/geofence-permission.sql  # G1-G7  HR permission flow
```

Both are self-cleaning and abort loudly on the first failed assertion. Silence +
`ALL … PASSED` notices = green. `geofence-permission.sql` refuses to run if EMP001
already has a session today, so it never destroys real attendance data.

Get `DATABASE_URL` from Supabase → Project Settings → Database → Connection string.

---

## 2. Faking your GPS (the key trick)

You do **not** need to travel to test the geofence. In desktop Chrome:

1. Open the app, press <kbd>F12</kbd>
2. <kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> → type "sensors" → **Show Sensors**
3. Location → **Other…** → enter coordinates → reload the page

| Where | Latitude | Longitude | Distance |
|---|---|---|---|
| Inside the office | `19.081264` | `72.904332` | ~45 m — allowed |
| Just outside | `19.083500` | `72.904332` | ~290 m — needs permission |
| Far away (Dadar) | `19.018200` | `72.844400` | ~9.4 km — needs permission |

Note the app rejects readings with poor accuracy (`ACCURACY_LIMIT_M` in `lib/hooks.ts`).
DevTools reports perfect accuracy, so overrides always pass that check.

---

## 3. Geofence + HR permission (the new feature)

Sign in as an employee in one browser, and as admin in a second **incognito**
window so both sessions stay live.

| # | Do this | Expect |
|---|---|---|
| 3.1 | Set location inside, press **Clock In** | Timer starts immediately. Card reads "Clocked In". |
| 3.2 | Set location far away, press **Clock In** | Refused. Card reads **"Check-in Awaiting HR Permission"**, shows press time + distance, **timer stays at 00:00:00**. |
| 3.3 | As admin open `/admin/approvals` | Request listed, tagged **Check-in**, with press time, metres from office, and a Google Maps link to the exact spot. |
| 3.4 | Click the Maps link | Opens where the employee pressed it — *not* the office. |
| 3.5 | Press **Approve** | Employee's page flips to a running timer within ~15 s (it polls). Timer starts from **now**, not from the earlier press. |
| 3.6 | Still far away, press **Clock Out** | Refused. Employee **stays clocked in**, timer keeps running, amber "Check-out Awaiting HR Permission" note. Clock Out button hidden. |
| 3.7 | As admin, **Deny** it | Employee returns to normal "Clocked In". Still not checked out. |
| 3.8 | Press **Clock Out** again, admin **Approves** | Session completes. Hours saved, ending at the approval moment. Flagged out-of-range in `/admin/attendance`. |
| 3.9 | Move location inside, Clock In / Clock Out fresh next day | Both work with no approval at all. |

**Push notifications:** these only arrive over HTTPS with notifications allowed —
they will not fire on `http://localhost`. Test on the deployed Vercel URL. If push
is silent, the request still appears in `/admin/approvals` (it polls every 20 s).

---

## 4. The rest of the app

### Attendance
- [ ] Two sessions in one day → second is refused ("already logged a session today")
- [ ] Work past 9 h → overtime appears on the dashboard and in `/admin/attendance`
- [ ] 11 h warning / 12 h auto-close — driven by the `session-maintenance` cron.
      Force it without waiting: `select session_maintenance();` after backdating a
      session's `started_at`.
- [ ] `/admin/attendance` monthly totals and **CSV export** open correctly in Excel

### Leave
- [ ] Apply full-day, half-day, and multi-day ranges
- [ ] Balance decreases only after **approval**, not on submission
- [ ] Sandwich rule: take Saturday + Monday → Sunday is consumed too
- [ ] Cancel a pending request → balance restored
- [ ] Apply for more days than the balance → split into paid + unpaid
- [ ] Admin approve/deny both notify the employee

### Admin
- [ ] Add an employee → they activate via "First time here?" on the login page
- [ ] Deactivate an employee → they can no longer sign in
- [ ] Add / edit / disable a location; "Use my location" fills the coordinates
- [ ] Add a holiday → shows in the employee's Upcoming Holidays
- [ ] `/admin/analytics` charts match `/admin/attendance` numbers
- [ ] `/admin/audit` shows the blocked / pending / marked events from section 3

### Roles
- [ ] Employee cannot open any `/admin/*` route
- [ ] Audit role (`amit@test.com`) can view but **cannot** approve or edit anything
- [ ] Manager sees and approves only their own reports

### PWA
- [ ] "Add to Home Screen" works on a phone against the HTTPS deployment
- [ ] Turn airplane mode on → `offline.html` appears rather than a browser error
- [ ] Push permission prompt appears and a test approval delivers a notification

---

## 5. Known gaps to decide on

- **A denied check-in locks the employee out for the whole day.** The
  one-session-per-day rule counts denied rows, so someone who is refused, denied,
  and then travels to the office still cannot check in until tomorrow.
- **GPS is trusted as sent.** A rooted phone with a mock-location app can report
  any coordinates. The audit log is the real control, not the geofence.
- **Office coordinates are approximate** (geocoded from a neighbouring building).
  Fix on-site via Locations → Edit → Use my location, then tighten the radius.
