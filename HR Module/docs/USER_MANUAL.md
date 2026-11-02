# HR: user guide

Open **HR** in the CRM sidebar. An administrator must give you the HR tab in Settings > Users & Permissions, and your login must be linked to your employee record. You only see the tabs and rows your role allows.

| If you are | You see tabs |
|---|---|
| Administrator or on the HR list | Dashboard, Employees, Documents, Leave, Attendance, Payroll, Settings |
| A manager (someone has you as their manager) | Dashboard, Employees, Leave, Attendance, Payroll |
| An employee | Dashboard, Employees, Documents, Leave, Attendance, Payroll |
| A member with no employee record | A message asking you to get your login linked. Ask HR or an administrator |

If the page shows an error about a missing function, the HR database set-up has not been applied yet. Tell an administrator.

## Dashboard

Four numbers at the top: headcount, present today, pending leave and documents expiring (expired or within 90 days). Below them, each person's open tasks from the CRM, overdue first. Click a task to open it.

- Administrators and HR see everyone. A manager sees their direct reports and themselves. An employee sees only themselves.
- **Managers see the titles of their reports' open tasks.** Those titles can name clients or work the manager does not otherwise have access to.
- "No CRM login" means the employee is not linked to a CRM member, so no tasks can show.
- A red warning about the same name means two employees share a name. Tasks are matched by name, so the list may include the other person's tasks. Ask an administrator to make the names different.

## Employees

The list shows code, name, department, designation, manager and status. Open a row for the profile.

- **HR** adds and edits employees, sets each person's manager and records an exit date. Personal details (date of birth, nationality, address, emergency contact) are visible to HR and to the employee, not to managers.
- **Managers** see their reports' job details only.
- **Employees** see their own record.
- Set the status to Left only together with the exit date. Attendance and payroll stop at the exit date.
- A new employee is first added here or in Settings > Employees; onboarding a CRM member links them to that row.

## Documents

For HR: every employee's documents. For an employee: their own. Managers have no Documents tab.

1. Press **+ Add document**, choose the employee (HR only) and the type: Passport, Residence visa, Emirates ID, Labour card, Medical insurance, Driving licence or Other.
2. Choose the file (PDF, image, Word, Excel, CSV or text, up to 25 MB). If the Client Module is running on your PC, the fields are filled from the file; check them. If it is not, type them. The upload works either way.
3. Save. If the upload fails, nothing is saved.

Expiry shows as expired, within 30, 60 or 90 days. **View** opens the file through a link that works for five minutes. Stored files are never replaced; add a new document instead.

## Leave

- **Employees** press **+ Request leave**, choose the type and dates. Weekends and holidays are not counted. A request across a year end is saved as one row per year. Pending or approved leave can be cancelled.
- **Managers** approve or reject their reports' pending requests. **Nobody can decide their own leave.** If you have no manager, HR decides.
- **HR** can enter leave for anyone, including people with no CRM login, and decide any pending request.
- The **Balances** panel shows entitlement, adjustment, used, pending and remaining per leave type. Choose an employee to see theirs.
- Two requests for the same person cannot overlap. A warning after saving (for example a low balance) does not stop the request; HR decides.

**Half-pay leave needs a manual adjustment.** The system does not calculate reduced pay for long sick leave or similar half-pay days. It treats paid leave as fully paid. A leave type marked with a half-pay note shows "Review note" in Settings, and the payroll line for anyone who took it carries a review note. HR must adjust that person's line by hand before approving the run.

## Attendance

A month grid: one line per person, one column per day. Use the arrows to change month. The grid scrolls sideways inside its box on a phone.

- P = Present, A = Absent, L = Leave, H = Holiday, W = Weekend. A blank cell is a working day with nothing recorded. Approved leave, holidays and weekends fill in by themselves.
- **HR** clicks any day to set it. **A manager** sets their reports' days, not their own. **Employees** only read.
- Choose the status and, for Present, the times as HH:MM. Absent, Leave, Holiday and Weekend cannot have times. Future days cannot be set. A day that already has an entry is replaced and the change is logged.
- **Overnight shifts are not supported.** Time out cannot be earlier than time in. Record a shift across midnight as a note on the day, not as times.
- Someone marked Left cannot be edited until HR records their exit date. Days after the exit date cannot be edited.

## Payroll

**Employees and managers** see their own approved months, with **Details** (how the figure was worked out) and **Print payslip**. Nothing shows until HR approves the month.

**HR** works in this order:

1. **Settings first.** The run cannot start until the payroll settings are filled in. They are blank on purpose because they are policy choices that need confirming (see below).
2. **Pay details.** Add each person's basic wage, allowances (one per line, like `Housing: 3000`), IBAN, bank routing code and WPS labour card, with an effective date. To change pay, add a new row with a later date. A person with no IBAN blocks approval. Only HR can see pay details; lists show only the last four IBAN digits.
3. **Create run.** Choose the month and press **Create run**. One draft per month. It loads pay details, attendance and unpaid leave into a line per person.
4. **Review.** Open the run. **How worked out** shows every figure and note. **Adjust** adds a labelled amount. **Recalculate** reloads after attendance or leave changes. Lines marked Missing data, and review notes, need attention first.
5. **Approve.** The database recalculates and locks the run. Approved runs cannot be edited; correct mistakes with an adjustment in the next run. If you prepared or adjusted the run, approving it yourself needs an extra confirmation that is logged; have a second person approve where you can. A pay change that starts mid-month blocks approval until you adjust the line or acknowledge it, because the system does not split the month.
6. **Print payslip.** On an approved run only. It opens a new window and the print dialog; choose Save as PDF if you want a file. Allow pop-ups for the CRM site, or the button shows an error. The payslip shows only the last four IBAN digits and no internal notes.

**Payroll settings need confirming before first use.** Pay day divisor (a fixed number of days, calendar days or working days), the wage that unpaid leave is taken from (basic or total), and the gratuity method, cap, daily divisor and service-end counting are all empty until HR confirms them with a qualified UAE labour adviser. The screen lists exactly which are missing.

**The WPS file is not available yet.** The system does not produce a salary file for the bank. It needs a sample or specification from your bank or MOHRE. Keep paying through your current method.

The module never sends money or files anything with a bank.

## Settings (HR and administrators)

- **HR access list.** Administrators only. People listed see and change all HR data.
- **Leave types.** Empty at the start. Add each type, whether it is paid, the annual days (blank for no limit) and, for half-pay types, a note.
- **Holidays.** Add each public holiday by date.
- **Working week.** Tick the weekend days.
- **Payroll basis.** The settings above.

## Common questions

- **I do not see a tab.** Your role does not include it, or the HR tab is not granted to you.
- **My payslip button says to allow pop-ups.** Allow pop-ups for the CRM site and press the button again.
- **A request was refused.** The message says why: an overlap, an approval of your own leave, or a day after the exit date.
