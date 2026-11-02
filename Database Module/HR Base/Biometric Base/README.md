# Biometric Base

Brings punches from the e-timeoffice biometric service into HR > Attendance. It runs on Supabase every 15 minutes, so no office PC is needed.

| Path | Purpose |
|---|---|
| `API Documentation.pdf` | The vendor's API document |
| `schedule.sql` | Scheduler job, its secret and `hr_biometric_secret_ok`. Run on live only, after the steps below |
| `../migrations/009_hr_biometric.sql` | `hr_biometric_punches`, `hr_biometric_sync`, `hr_employees.biometric_code`, `hr_attendance.source`, roll-up and link functions |
| `HR Module/supabase/hr-biometric-sync/` | Edge Function and API client (`etimeoffice.js`) |
| `HR Module/components/BiometricPanel.jsx` | Attendance tab, HR only: status, Sync now, Catch up dates, Link a code |

## How data flows

1. Each run calls `DownloadPunchDataMCID` for all employees over the last 3 days. Punches are unique per code and time, so re-reading is safe and picks up late device uploads. `DownloadLastPunchData` is not used: its first `LastRecord` value and its behaviour across months are not documented.
2. Raw punches are stored in `hr_biometric_punches`.
3. A code matches `biometric_code`, then `employee_code` of an employee with no `biometric_code`. It is an exact text match. Codes that match nobody are listed for HR to link, and their punches are kept.
4. A matched day becomes Present, with the first punch as time in and the last as time out.

## Rules

- A day edited by hand is `manual` and the sync never changes it.
- The sync never marks Absent. A day with no punches stays blank for HR to decide.
- Days outside employment dates, and future days, are not written.
- A punch inside approved leave writes Present. Payroll's review note flags it for unpaid leave.
- Every written day is audited, so a change to an approved month appears in the run's changes after approval. Approved pay does not change.
- Overnight shifts are not supported: each calendar day stands alone.
- Times are stored as the provider sends them, assumed to be UAE time.
- The provider's `Status`, `Late_In` and `OverTime` values (`DownloadInOutPunchData`) are not used. Their meanings are not defined in the document.

## Go-live, in order

Nothing here is on live. Each step needs the user's approval.

1. Put the HR Module live first (`../README.md`, Before go-live), including migrations 001 to 009.
2. Add the login as Edge Function secrets or in Settings > Integrations where that screen is live: `ETIMEOFFICE_CORPORATE_ID`, `ETIMEOFFICE_USERNAME`, `ETIMEOFFICE_PASSWORD`.
3. Deploy `hr-biometric-sync` with JWT verification off (`--no-verify-jwt`): copy `index.ts` and `etimeoffice.js` into one `supabase/functions/hr-biometric-sync` folder and use `--project-ref pnnakrhfzyxudjaghoxx --use-api`.
4. On HR > Attendance, press **Sync now**. Check the result against the e-timeoffice portal for a few people, and link any listed codes.
5. Run `schedule.sql` on live.
6. Use **Catch up dates** for earlier months, if wanted.

## Not yet proven

No real e-timeoffice login has been used. These need checking at step 4:

- **Login format.** The document gives `Corporateid:Username:Password:True`, but its sample Base64 decodes to `support:support:support:true:`, with a trailing colon. The code sends the written format with no trailing colon.
- **Response shape.** The code follows the document's sample for `DownloadPunchDataMCID`.
- **Device clock.** UAE time is assumed. The document's support number and sample names suggest an India-based vendor, so confirm the times match the portal.
