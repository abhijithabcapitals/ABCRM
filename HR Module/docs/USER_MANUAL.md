# HR: user guide

Open **HR** in the CRM sidebar. An administrator must give you the HR tab in Settings > Users & Permissions, and your login must be linked to your employee record. You only see the tabs and rows your role allows.

| If you are | You see tabs |
|---|---|
| Administrator or on the HR list | Dashboard, Employees, Leave, Requests, Attendance, Payroll, Settings |
| A manager (someone has you as their manager) | Dashboard, Employees, Leave, Requests, Attendance, Payroll |
| An employee | Dashboard, Employees, Leave, Requests, Attendance, Payroll |
| A member with no employee record | A message asking you to get your login linked. Ask HR or an administrator |

If the page shows an error about a missing function, the HR database set-up has not been applied yet. Tell an administrator.

## Employee profile

HR and the employee see the photo, personal details, visa and IDs, documents, insurance, mobile plan and assets issued. Only HR sees salary, bank account and gratuity, and only HR changes them. Managers see job details only. The visa, Emirates ID and licence rows are the same records as Documents. Gratuity needs the four gratuity settings filled in.

## Dashboard

Cards at the top: today's date, Present, Absent, On Leave (with Annual and Unpaid shown separately), Late, Overtime, Work From Home and Active. Click a card to see who is in it. Present, Late, Overtime and Work From Home show the login time, logoff time and overtime hours, day by day for a longer period. Below them, each person's Annual leave this year (credit, used, pending, balance), then pending leave, documents expiring (expired or within 90 days) and each person's open tasks from the CRM, overdue first. Click a task to open it.

- Administrators and HR see everyone. A manager sees their direct reports and themselves. An employee sees only themselves.
- **Managers see the titles of their reports' open tasks.** Those titles can name clients or work the manager does not otherwise have access to.
- "No CRM login" means the employee is not linked to a CRM member, so no tasks can show.
- A red warning about the same name means two employees share a name. Tasks are matched by name, so the list may include the other person's tasks. Ask an administrator to make the names different.

## Employees

The list shows code, name, department, designation, manager and status. Open a row for the profile.

- **HR** adds and edits employees, sets each person's manager and records an exit date. Personal details (date of birth, nationality, address, emergency contact) are visible to HR and to the employee, not to managers.
- **Managers** see their reports' job details only.
- **Employees** see their own record.
- Set the status to Left only together with the exit date. Attendance and payroll stop at the exit date. Someone marked Left also loses HR and manager access; they keep their own record and payslips. An administrator keeps access.
- **On payroll.** HR can untick this on the employee form. That person then gets no pay line in a run.
- A new employee is first added here or in Settings > Employees; onboarding a CRM member links them to that row.
- **Link login.** Administrators only: open an employee and, under Link login, choose a CRM login that has no employee yet, or unlink the current one. Each change is logged.
- Employees are never deleted. Use status and exit date.

## Documents

Documents sit inside Employees. Each profile has a Documents section, and HR also has a People / Documents switch for everyone at once. An employee or a manager sees their own only. A manager does not see their reports' documents.

1. Press **+ Add document**, choose the employee (HR only) and the type: Passport, Residence visa, Emirates ID, Labour card, Medical insurance, Driving licence or Other.
2. Choose the file (PDF, image, Word, Excel, CSV or text, up to 25 MB). If the Client Module is running on your PC, the fields are filled from the file; check them. If it is not, type them. The upload works either way.
3. Save. If the upload fails, nothing is saved.

Expiry shows as expired, within 30, 60 or 90 days. A leaver's document shows "Left: not tracked" and is not counted on the dashboard. **View** opens the file through a link that works for five minutes. Stored files are never replaced; add a new document instead.

## Leave
Annual leave builds up by 2.5 days a month after 6 months of service, from 1 November 2026. Unused days carry forward. Approved Annual leave, Absent days and every 4th late day all use the balance. Anything beyond the balance is unpaid: (total salary / days in the month) x unpaid days. Approved Unpaid leave is always unpaid.

- **Employees** press **+ Request leave**, choose the type and dates. Weekends and holidays are not counted. A request across a year end is saved as one row per year. You can cancel your own pending leave any time, and your own approved leave only before its first day (Dubai date). After that, ask HR.
- **Managers** approve or reject their reports' pending requests. **Nobody can decide their own leave.** If you have no manager, HR decides.
- **HR** can enter leave for anyone, including people with no CRM login, decide any pending request, and cancel any pending or approved leave.
- The **Balances** panel shows entitlement, adjustment, used, pending and remaining per leave type for the chosen year. Choose an employee to see theirs. **HR** presses **Set entitlement** on a line to set the entitlement and adjustment for that employee, type and year.
- Two requests for the same person cannot overlap. A warning after saving (for example a low balance) does not stop the request; HR decides. Approving paid leave beyond the balance also shows a warning and still approves.
- **Locked months.** If the dates are in a month whose payroll run is approved, the decision or cancellation is saved and the screen says the month is locked. The approved pay does not change: add an adjustment in a later run.
- An Absent entered on a day inside approved paid leave does not reduce pay or gratuity service. The pay line carries a review note so HR can correct the entry.

**Half-pay leave needs a manual adjustment.** The system does not calculate reduced pay for long sick leave or similar half-pay days. It treats paid leave as fully paid. A leave type marked with a half-pay note shows "Review note" in Settings, and the payroll line for anyone who took it carries a review note. HR must adjust that person's line by hand before approving the run.

## Attendance Sheet

In **Month grid**, scroll sideways for any earlier or later month. The title follows the scroll, and P, A, Late and OT count that month. Choose a view: **Month grid**, **Calendar** (one person), **Week**, **Year** (one person) or **Daily list**. Use the arrows to change the period.

- P = Present, A = Absent, WH = Work From Home, L = Leave, H = Holiday, W = Weekly Off. A blank cell is not counted, for example before someone started or a future day.
- Hours are 09:30 to 18:30, and 09:30 to 14:00 on Saturday. Late means the first punch is after 09:30 and under the day's full hours between first and last punch (9 hours, or 4.5 on Saturday). A day with no last punch counts as late until it arrives. Every 4th late day in a month counts as 1 day of leave. Overtime means the last punch is after the day's end, and it does not change pay.
- In **Calendar**, a day with both punches shows the login and logoff times and the total hours between them. The other views show the hours when you hover over a day.
- A late day's colour runs from yellow just after 09:30 to full orange at 10:30 and later. Extra time worked after the day's end is taken off the lateness first, so a day fully made up stays green. The Late card still counts that arrival.
- A blue dot marks a UAE public holiday and a purple dot an India festival. Hover for the name. "(estimated)" means the date is not announced, and the day still counts as a working day.
- Each day is worked out in this order: a day edited by hand, approved leave, a holiday, punches, a Work From Home Saturday, the weekly off. **A working day with none of these is Absent, and Absent is deducted from pay.**
- Someone who has stopped coming shows Absent every day until HR records their exit date.
- Until a join date is entered, Absent counts only from the person's first punch.
- **An administrator** or **HR list member** clicks a day and the change applies at once. **Managers** click a report's day, give a reason and send it for approval. The day keeps its value, and shows a dashed outline, until HR or an administrator decides on the **Approvals** tab. Nobody on the HR list decides their own day.
- **Your own day:** anyone, including an HR member, clicks their own past day or today and chooses **Use Annual leave**, **Work from home** or **Change timing**, with a reason. It goes to HR, and the day keeps its value until HR validates it. A holiday, a weekly off or a month with an approved pay run cannot be changed this way. An Absent day already uses Annual leave, so choosing Annual leave records the same day as Leave and the balance stays the same. With no balance the day is unpaid.
- **History:** below the sheet, every request, decision and manual change, with who and why. You see your own, a manager also sees their reports, and HR sees everyone. Entries cannot be edited or removed.
- Choose the status and, for Present or Work From Home, the times as HH:MM. Other statuses cannot have times. Future days cannot be set. If the month's payroll run is approved, the day is saved, the screen says the month is locked, and the approved pay does not change: add an adjustment in a later run.
- **Overnight shifts are not supported.** Time out cannot be earlier than time in. Record a shift across midnight as a note on the day, not as times.
- Someone marked Left cannot be edited until HR records their exit date. Days after the exit date cannot be edited.

### Biometric sync (HR only)

Punches from e-timeoffice arrive every 15 minutes and show below the grid as **Biometric sync**.

- A day with punches becomes Present, with the first punch as time in and the last as time out. A working day with no punches counts as Absent.
- If you edit a day by hand, the sync leaves that day alone from then on.
- **Sync now** fetches the last 3 days. **Catch up dates** fetches up to 92 days.
- **Device codes that match no employee** are listed. Click **Link** and choose the employee. Their earlier punches are then applied. Use **Link a code** with a blank code to unlink.
- Check the last success time. A failed sync shows its error here.

## Requests

Press **+ New request** and choose the type. Leave and most requests go to your manager or HR, Other goes to HR, and expense claims go to a Finance Manager. Nobody decides their own.

- **Half day:** the day is not late and takes 0.5 from Annual leave if you worked it. With no punches the day stays Absent.
- **Work from home:** the day shows WFH, unless it was edited by hand.
- **Late concession:** that day no longer counts as late.
- **Sick leave:** 15 paid days a year. Beyond that HR gets a warning. Half pay is not calculated.
- **Overtime payment:** give the date and hours. HR enters the amount, with no automatic rate, and it goes into that month's draft pay run. An approved run does not change.
- **Expense reimbursement:** give the date and amount, and attach the document. After a Finance Manager approves it, Accounts sees it under Accounting > Expenses and records the payment. This does not send money.

You can cancel your own request while it is pending. HR can also cancel an approved one, unless it has been paid, and its effect goes away.

## Payroll
**Salaries** (here and on the Accounting page) shows what is Payable, Paid and Outstanding for each approved run. HR, administrators and the Accounts team can record a payment, in part or for everyone at once. Recording a payment does not send money. A payment entered by mistake can be removed, and the removal is logged.

**Employees and managers** see their own approved months, with **Details** (how the figure was worked out) and **Print payslip**. Nothing shows until HR approves the month.

**HR** works in this order:

1. **Settings first.** The run cannot start until the payroll settings are filled in. They are blank on purpose because they are policy choices that need confirming (see below).
2. **Pay details.** Add each person's basic wage, allowances (one per line, like `Housing: 3000`), IBAN, bank routing code and WPS labour card, with an effective date. To change pay, add a new row with a later date. A person with no IBAN blocks approval. Only HR can see pay details; lists show only the last four IBAN digits.
3. **Create run.** Choose the month and press **Create run**. One draft per month. The current month (Dubai date) is the latest allowed. Anyone with On payroll unticked is left out. It loads pay details, attendance and unpaid leave into a line per person.
4. **Review.** Open the run. **How worked out** shows every figure and note. **Adjust** adds a labelled amount. **Recalculate** reloads after attendance or leave changes. Lines marked Missing data, and review notes, need attention first.
5. **Approve.** The database recalculates and locks the run. Approved runs cannot be edited; correct mistakes with an adjustment in the next run. If you prepared or adjusted the run, approving it yourself needs an extra confirmation that is logged; have a second person approve where you can. A pay change that starts mid-month blocks approval until you adjust the line or press **Acknowledge pay change** and give a note, because the system does not split the month. Acknowledging adds no amount and does not appear on the payslip; the note goes to the audit log. If pay changes again, approval is blocked again. An approved run lists any changes made to that month after approval, for you to adjust in a later run.
6. **Print payslip.** On an approved run only. It opens a new window and the print dialog; choose Save as PDF if you want a file. Allow pop-ups for the CRM site, or the button shows an error. The payslip shows only the last four IBAN digits and no internal notes.

**Gratuity estimate.** On the Payroll tab, HR chooses an employee and exit date and presses **Work out** to see the calculation step by step. It is an estimate that needs confirming. It is not added to pay and nothing is saved. If a setting is missing, the message says which.

**Payroll settings need confirming before first use.** Pay day divisor (a fixed number of days, calendar days or working days), pay days basis (the number of days, used with the fixed mode), the wage that unpaid leave is taken from (basic or total), and the gratuity method, cap, daily divisor and service-end counting are all empty until HR confirms them with a qualified UAE labour adviser. The screen lists exactly which are missing.

**The WPS file is not available yet.** The system does not produce a salary file for the bank. It needs a sample or specification from your bank or MOHRE. Keep paying through your current method.

The module never sends money or files anything with a bank.

## Settings (HR and administrators)

- **HR access list.** Administrators only. People listed see and change all HR data, unless their linked employee is marked Left. Removing someone asks you to confirm. Additions and removals are logged.
- **Leave types.** Empty at the start. Add each type, whether it is paid, the annual days (blank for no limit) and, for half-pay types, a note.
- **Holidays.** Add each public holiday by date.
- **Calendar marks.** Estimated UAE Islamic holidays and India festivals. When the UAE date is announced, press **Confirm** and enter it. Until you do, that day still counts as a working day, and a blank day shows Absent. Rows marked "Confirm the date" are within 30 days or past.
- **Working week.** Tick the weekend days.
- **Payroll basis.** The settings above.

## Common questions

- **I do not see a tab.** Your role does not include it, or the HR tab is not granted to you.
- **My payslip button says to allow pop-ups.** Allow pop-ups for the CRM site and press the button again.
- **A request was refused.** The message says why: an overlap, an approval of your own leave, or a day after the exit date.
