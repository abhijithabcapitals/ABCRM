# Lead Base

A two-way Excel copy of **all lead data** that reaches the CRM's Business Development tab:

- **Pipeline leads** (`bd_leads`): every lead created in the CRM, whatever its source.
- **Platform prospects** (`bd_platform_prospects`): leads pulled from lead-generation platforms (Explee today;
  Google Sheets, Meta Lead Ads, Google Ads and others land in the same table as they are integrated, and appear
  here automatically).

The CRM database (Supabase) stays the source of truth. Lead Base reads it, and sends your edits back through
the same database functions the CRM screen uses, signed in as you. Row-level security, duplicate checks,
validation and the audit log apply exactly as in the CRM; nothing is written straight into tables.

## Start

Double-click `Lead-Base.cmd`. The first time it asks for your CRM email and password (typed in the window,
never stored; only a sign-in token is kept in `data/.session.json` on this PC). Then pick:

1. **Refresh** (`pull`): downloads everything into `data/Lead_Base.xlsx`.
2. **Push**: sends your edits to the CRM, then refreshes the workbook.
3. **Watch**: refreshes the workbook every 5 minutes while the window is open.

Command line equivalents: `python leadbase.py login | pull | push | watch 5 | logout`
(use `..\..\.venv\Scripts\python.exe`).

## Workbook

| Sheet | What you can do |
|---|---|
| Summary | Counts by source and platform, last refresh, who is signed in |
| Pipeline Leads | Edit the **yellow** cells: name, contact, designation, mobile, WhatsApp, email, website, country, emirate, priority, budget, currency, notes, source detail, and **Stage** (dropdown) |
| New Leads | Add a row per new lead: name, type, contact, mobile or email, source, initial summary (20+ characters) and next follow-up (DD/MM/YYYY HH:MM) are required. You become the owner |
| Prospects | Set **Status** to `new` or `dismissed`. Add a prospect to the pipeline from the CRM's Lead Generation tab |

Rules enforced by the CRM on push: at least one contact method; valid email; no duplicate name, email or
mobile (managers can approve exceptions in the CRM); stage moves follow the pipeline rules; you can only edit
leads your BD role allows. Status, owner, won/lost and services keep their CRM workflows.

Refused rows are listed in `data/push_report.csv` (and in the New Leads **Result** column) and stay in the
workbook so you can fix them and push again. Applied rows are never sent twice.

Safety: `pull` and `watch` never overwrite a workbook that has unpushed edits; run `push` first, or
`pull --force` to discard them. Close the workbook in Excel before pushing.

## Privacy

`data/` holds client contact data and the sign-in token. It is git-ignored: never commit or share it.

## Database pieces

- `Database Module/migrations/bd/006_bd_lead_base.sql`: `bd_update_lead(p_lead_id, p_changes)` (validated,
  audited edits) and removal of TRUNCATE from browser roles on all BD tables.
- Reads: `bd_ui_leads`, `bd_platform_prospects`, `bd_lead_sources`, `profiles`. Writes: `bd_update_lead`,
  `bd_change_stage`, `bd_create_lead`, and prospect status updates.
