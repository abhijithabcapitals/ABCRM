# Business Setup Service Work (C1): Design Spec

Date: 2026-11-05. Status: awaiting the user's review. Nothing here is built.

This spec replaces sections 8 and 9 of `2026-11-05-business-setup-client-flow-design.md`, and is the first step of `2026-11-05-business-setup-pro-brief.md`. The lists are in `2026-11-05-business-setup-service-checklists.md`: 45 services, 512 items, 40 of them Optional.

## 1. Purpose

Staff work each service through its own checklist, managers sign off the mandatory items, and progress calculates itself. A case moves to Completion when every service is confirmed, and the department admin sends it to Accounting.

The work is done when this runs on the TEST client:

Quote with a listed service → client accepts → case reaches Pipeline → the service has its checklist → staff tick in any order → manager signs off → service confirmed → Completion shows the money → sent to Accounting.

## 2. Decisions

All are the user's, 2026-11-05.

| Topic | Decision |
|---|---|
| Order of work | C1 service work, then C2 OneDrive, C3 renewals, C4 management. Each releases on its own approval |
| Stages | Lists start flat. An optional stage name can be added by admins, and items then group by it |
| Item statuses | Not Started, In Progress, Pending Client, Pending Authority, On Hold, Completed, Not Applicable, Reopened |
| Progress | Completed divided by all items except Not Applicable. Automatic, never typed |
| Sign-off | Any order. Mandatory items need a manager's sign-off, and Optional items don't |
| A manager's own work | A manager may sign off their own items. Each sign-off is logged with the name |
| Tables | New tables take new names. `business_setup_services` stays as the client's services. A service on a case is the brief's Service Request |
| Roles | Admin and Manager stay. Employee means Sales and Document Executive. Viewer means Read Only. Business Banking is a link only |
| Tabs | Unchanged. The brief's 15-tab layout is decided at the end |

## 3. Data

Migration `022_checkpoints.sql`, re-runnable, with `rollback/022_rollback.sql`.

### Lists (the templates)

| Table | Holds |
|---|---|
| `business_setup_checkpoint_sets` | `id`, `department`, `category`, `name`, `active`, `updated_at`, `updated_by`. Unique on department and name |
| `business_setup_checkpoint_steps` | `id`, `set_id`, `sort_order`, `label`, `stage` (optional), `requirement` (`Mandatory` or `Optional`) |

- `business_setup_fee_items` gains `checkpoint_set_id`. The seed adds one fee item per service: `is_service` true, empty amount, VAT 5, linked to its list.
- `department` is `Business Setup` for all 45.
- A step containing "(if " or "(where " starts as Optional. Others start as Mandatory.
- `scripts/build_checkpoints.py` turns the checklists file into the seed, so the file stays the source.

### A service's own copy

`business_setup_service_checkpoints`: `id`, `service_id`, `sort_order`, `label`, `stage`, `requirement`, `status`, `reason`, `assigned_to`, `due_date`, `started_at`, `completed_at`, `completed_by`, `verified_at`, `verified_by`, `updated_at`.

- Steps are copied when a quote is accepted, in the same transaction that creates the service. Later edits to a list leave running services unchanged.
- A service with no list keeps today's simple statuses.
- Every change writes to `business_setup_service_history` with who, when, old and new values, and any note. History is never edited or deleted.

### Services

`business_setup_services` gains `assigned_to`, `reviewer_id`, `priority` (`Low`, `Normal`, `High`, `Urgent`, default `Normal`), `authority`, `expected_completion`, all optional. `assigned_to` defaults to the case owner.

### Attachments

`business_setup_checkpoint_files`: `id`, `checkpoint_id`, `storage_path`, `file_name`, `size_bytes`, `created_at`, `created_by`. Stored in CRM private storage for now. C2 moves them. PDF, JPG, PNG, WEBP, TIFF, up to 25 MB.

## 4. Rules

| Rule | Detail |
|---|---|
| Who changes an item | The service's assigned employee, the item's assignee, the case owner, or a holder of `setup.cases.approve` |
| Who signs off | A holder of `setup.cases.approve`. Only a Completed Mandatory item can be signed off |
| Any order | Any item can be worked on at any time |
| Not Applicable | Needs a reason, and clears any sign-off |
| Reopened | Needs a note, clears the completed time and sign-off, and lowers progress |
| Status moves | Reopened can be set only from Completed. Any other status can move to any other |
| Editing after sign-off | Refused. Reopen it first |
| Progress | Completed divided by all except Not Applicable, rounded down, 0 when no item applies. Returned by the server, never stored or typed |
| Pending approval | Shown when a Mandatory item is Completed and not signed off. Worked out, not stored |
| First activity | The first item moved off Not Started moves the service to In progress |
| Holds | Pending Client and Pending Authority count as not done. Today's Waiting flags on the service stay |

### Confirming a service

**Confirm service** needs every Mandatory item to be signed off or Not Applicable. The refusal names the items. It turns any open Optional item into Not Applicable, with the reason "Not needed", and then runs `business_setup_service_complete`, which still needs an output file unless overridden with a reason.

### Sign off all

On a service, a holder of `setup.cases.approve` signs off all Completed Mandatory items at once. The history records each item.

### Cancelling

A cancelled service keeps its items as they were, and they can no longer change. Its progress shows as Cancelled, separate from the percentage.

### Reopening a confirmed service

A manager reopens a confirmed service with a note. This is possible until the case is With Accounts, and after Accounts reverts it. The case returns to Pipeline.

## 5. Screens

### Pipeline

- The list adds services, progress, next due date, holds and balance. Search and filter as elsewhere.
- Opening a case lists its services, each with a progress bar. Pipeline gains the service actions it lacks today: status, assign, Complete.
- Opening a service shows the service page.

### Service page

**Overview:** client, service, assigned employee, reviewing manager, priority, authority, expected date, progress, next action, days pending, items pending approval.

**Checklist:** items in order, grouped by stage when stages exist. Each row has status, Mandatory or Optional, assignee, due date, attachments and sign-off state. Overdue items are marked.

**Links:** the client's documents, payments and history open from here. They aren't rebuilt.

Buttons appear only for those allowed to use them, and the server still checks every action.

### Completion

- The list adds quote total, net paid, balance, invoices and pending payment claims.
- The dialog's "AED AED" is fixed.
- Send stays with `setup.cases.approve`. An unpaid balance shows and does not block.

### Services & Fees

A list editor for holders of `setup.fees.manage`: department, category, name, active, and for each step its label, stage, Mandatory or Optional, and order. Saved through `business_setup_checkpoint_list_save`.

### Client portal

Clients see each service's item labels, status and progress. They never see reasons, notes, attachments, assignees or staff names.

### Referrer

Admins change a case's referrer from a small dialog on the case page, using the existing `business_setup_case_set_referrer`, with a required reason.

## 6. Live data

- The 45 fee items and lists are additions, and no existing row changes.
- Existing services, including the 142 Visa Registration services, get no checklist and keep simple statuses.
- The new service columns are empty on existing rows.
- Accepted quotes already on live get no checklist. `BSC000001` to `BSC000003` get theirs when their quotes are accepted, as they haven't been yet.

## 7. Errors

Blocked actions show one plain sentence naming what is missing. A list saved with no steps is refused. Two people changing one item: the second works on the latest state, and a sign-off is refused if the item has moved off Completed.

## 8. Testing

SQL tests on throwaway Postgres, running migrations twice:

- Seed: 45 sets, 512 steps, 40 Optional, all with the department, and a re-run adds none.
- Copy on accept, once only, and a later list edit leaves it unchanged. A cost line and a typed service get no list.
- Any order. Who may change and who may sign off. A non-owner and a non-manager refused.
- Not Applicable needs a reason. Reopening needs a note and clears the sign-off. Editing after sign-off refused.
- Progress for every status mix, including all Not Applicable and Reopened.
- Confirm refused while a Mandatory item is unsigned, and naming it. Optional items closed by Confirm. Output or override still needed.
- Sign off all touches only Completed Mandatory items, and writes history for each.
- Cancelled services locked. Reopening a confirmed service returns the case to Pipeline.
- History cannot be changed or deleted. Portal view holds no reason, note, assignee or staff name.
- Existing services unaffected, and Banking and Accounting behaviour unchanged.

`node --test` covers progress, grouping and screen gates. A browser walk runs the whole flow on the TEST client, with a manager login and an executive login if they are assigned by then.

## 9. Delivery

One release, on the user's approval: backup, apply `022`, deploy `client-portal`, merge, push, deploy both Cloudflare sites, walk.

## 10. Out of scope

| Item | Where |
|---|---|
| OneDrive, and moving attachments | C2. Needs the owner account and Microsoft admin setup |
| Compliance register and reminders | C3 |
| Tasks per checkpoint, alerts, Kanban, reports, workload | C4 |
| Conditional checkpoints, required document types per service | Later, on request |
| Internal approvals other than sign-off | Later, on request |
| 15-tab layout | Decided at the end |
| Business Development transfer | Phase D, unchanged |

## 11. As built (2026-11-06)

Built on branch `business-setup-restructure`, not live. Three changes from section 3, made to reuse what exists:

| Spec | Built |
|---|---|
| New `assigned_to` on services | The existing `owner_id` is the assigned employee. It defaults to the case owner when the quote is accepted |
| New `business_setup_checkpoint_files` table | An attachment is an ordinary client document (`business_setup_documents`, not client-visible) with a new `checkpoint_id`. Same private bucket |
| `business_setup_service_confirm` wrapper | The checklist rule sits inside `business_setup_service_complete`, so every route to Completed obeys it |

Not covered by tests: two people racing a sign-off against a reopen (the functions lock the service row, then the item), and a quote revised after its checklists exist.
