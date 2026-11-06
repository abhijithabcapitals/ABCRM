# Business Setup Service Work (C1) Implementation Plan

> Run task by task, tests first. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every listed service its own checklist with manager sign-off and automatic progress, and finish Pipeline and Completion.

**Architecture:** Lists are templates. Accepting a quote copies a list onto the service. Items change only through `security definer` functions, which write history and work out progress. Screens read those functions.

**Tech Stack:** Supabase Postgres, React with Vite, Deno Edge Function `client-portal`, `node --test`, throwaway Postgres through `tests/run-local.sh`.

**Spec:** `Business Setup Module/docs/2026-11-05-business-setup-service-work-design.md`.

## Global Constraints

- Worktree `D:\Abhijith Projects\CRM-bs-restructure`, branch `business-setup-restructure`. Merge `origin/main` first, because other sessions keep releasing.
- Migrations live and never edited: Business Setup 001-021, Client Login 001-005. New work goes in `022_checkpoints.sql`, re-runnable and tested by running twice, with `rollback/022_rollback.sql`. Add 022's undo to `rollback/013_019_rollback.sql` too, because its test re-applies every migration.
- Redefine a live function by copying its latest definition unchanged apart from the change. `business_setup_quote_accept_body` and `business_setup_case_docs` are latest in 017. Check each function's latest definer before copying.
- Tables stay read-only through the API. Writes go through `security definer` RPCs with explicit `revoke` and `grant`. Blocked actions raise one plain sentence.
- Existing services and quotes are never changed by the migration. Banking and Accounting behave as before.
- Client view never holds a reason, note, attachment, assignee or staff name.
- Styling stays as it is today. Never swallow an error.
- Nothing goes live without the user's approval. A release deploys to `abcrm` and `crm-abcapital.pages.dev`.

**Tests:** `PG_PORT=55503 bash "Database Module/Business Setup Base/tests/run-local.sh"`, the same with `ROLLBACK_TEST=1`, `node --test` per module folder, `npm run build` in `Main Module`. Read every exit code. New SQL tests start by re-applying 013-019 and 022, because earlier files restore old functions and grant every function to staff.

## Review Focus

1. **Quote revised after checklists exist:** cancelled services keep their items frozen, and the new quote's services get fresh copies. Test in Task 2.
2. **A list edited while a service runs:** the running copy doesn't change. Test in Task 2.
3. **All items Not Applicable:** progress is 0, and Confirm is allowed if none is an open Mandatory item. Test in Task 3.
4. **A sign-off racing a reopen:** one wins, and the other gets a plain refusal. Test in Task 3.
5. **Reopening a confirmed service on a case at Completion:** the case returns to Pipeline, and is refused while With Accounts. Test in Task 3.

---

### Task 1: Lists and the seed

**Files:** create `Database Module/Business Setup Base/scripts/build_checkpoints.py`, `migrations/022_checkpoints.sql`, `rollback/022_rollback.sql`, `tests/210_checkpoints_test.sql`. Modify `tests/run-local.sh` (order 13 14 20 21 15 16 17 18 19 22 23; test glob already reaches 2x0).

**Produces:** tables in spec section 3, fee item `checkpoint_set_id`, and `business_setup_checkpoint_list_save(p jsonb) returns uuid`, needing `setup.fees.manage`.

- [ ] **Test:** `seed_counts`: 45 sets, 512 steps, 40 Optional, all `department = 'Business Setup'`; a re-run adds none and leaves an edited list alone. `fee_items`: 45 new items, `is_service` true, empty amount, VAT 5, each linked. `save`: non-holder refused; a list with no steps refused.
- [ ] Run. Expected: FAIL.
- [ ] Implement. The script parses the checklists file and writes the seed section. Seed only when a set of that name is absent.
- [ ] Run all SQL tests and `ROLLBACK_TEST=1`. Expected: exit 0.
- [ ] Commit.

### Task 2: Copy on accept, and service details

**Files:** `migrations/022_checkpoints.sql`, `tests/210_checkpoints_test.sql`, `rollback` files.

**Produces:** `business_setup_quote_accept_body` copies steps per service. Service columns from spec section 3. `business_setup_service_details_save(p_id uuid, p jsonb)`.

- [ ] **Test:** `copy_once`: accept copies each list once; `list_edit`: later edit leaves the copy; `no_list`: cost line and typed service get none; `revise`: quote revised before acceptance copies nothing, cancelled services keep frozen items; `assigned_default`: `assigned_to` is the case owner; `existing_untouched`: a service made before 022 has no items and keeps simple statuses.
- [ ] Run. Expected: FAIL.
- [ ] Implement, with accept rolling everything back if a copy fails.
- [ ] Run all SQL tests. Expected: exit 0.
- [ ] Commit.

### Task 3: Item rules, sign-off and confirm

**Files:** `migrations/022_checkpoints.sql`, `tests/210_checkpoints_test.sql`, `rollback` files.

**Produces:**
- `business_setup_checkpoint_set(p_id uuid, p_status text, p_note text default null) returns void`
- `business_setup_checkpoint_assign(p_id uuid, p_user uuid, p_due date) returns void`
- `business_setup_checkpoint_verify(p_id uuid) returns void`, `business_setup_service_verify_all(p_service uuid) returns int`
- `business_setup_service_confirm(p_id uuid, p_output_details text default null, p_override_reason text default null) returns void`, wrapping `business_setup_service_complete`. Check its real signature first.
- `business_setup_service_reopen(p_id uuid, p_note text) returns void`
- `business_setup_service_checklist(p_service uuid) returns jsonb` with items, progress, next action, and pending approval
- `business_setup_checkpoint_file_add(p_id uuid, p_path text, p_name text, p_size bigint)`

- [ ] **Test:** one per rule in spec section 4: `any_order`, `who_changes`, `who_verifies`, `na_reason`, `reopen_note`, `reopen_clears`, `locked_after_signoff`, `progress_mix`, `progress_all_na`, `first_activity`, `confirm_blocks_names_item`, `confirm_closes_optional`, `confirm_output`, `verify_all_only_completed_mandatory`, `cancel_freezes`, `reopen_service_to_pipeline`, `reopen_refused_with_accounts`, `race_verify_reopen` (locks row, re-reads status), `history_written`, `history_no_edit`.
- [ ] Run. Expected: FAIL.
- [ ] Implement.
- [ ] Run all SQL tests and `ROLLBACK_TEST=1`. Expected: exit 0.
- [ ] Commit.

### Task 4: Pipeline, service page and portal

**Files:** create `Business Setup Module/components/ServicePage.jsx`, `logic/progress.js`. Modify `components/Cases.jsx`, `services/businessSetupApi.js`, `migrations/022_checkpoints.sql` (`business_setup_case_list` adds services summary, and `business_setup_portal_view` adds items), `Client Login Module/portal/ServicesTab.jsx` or `SetupView.jsx`, `tests/onboarding.test.mjs`, `tests/render.test.mjs`, `tests/040_portal_test.sql`.

**Produces:** `progressLabel(service)`, `groupByStage(items)` in `logic/progress.js`.

- [ ] **Test:** `groupByStage` keeps order with and without stages; a cancelled service labels Cancelled; screen gates match the RPC rights; portal view holds no reason, note, assignee or staff name.
- [ ] Run. Expected: FAIL.
- [ ] Implement per spec section 5. Pipeline's case page gains status, assign, Complete and links.
- [ ] Run node, SQL and build. Expected: exit 0.
- [ ] Commit.

### Task 5: Completion, list editor and referrer

**Files:** `components/Completion.jsx`, `components/FeeMaster.jsx`, `components/ClientOnboarding.jsx`, `migrations/022_checkpoints.sql` (`case_list` completion figures), tests.

- [ ] **Test:** completion row carries total, net paid, balance, invoice count, pending claims; the dialog text has one "AED"; list editor saves through `business_setup_checkpoint_list_save`; referrer dialog shows only for admins and needs a reason.
- [ ] Run. Expected: FAIL.
- [ ] Implement.
- [ ] Run everything: SQL, `ROLLBACK_TEST=1`, node, build, and `deno check` if `client-portal` changed. Expected: exit 0.
- [ ] Commit.

### Task 6: Release (user approval needed)

- [ ] Ask the user, naming what goes live.
- [ ] On approval: merge `origin/main`, re-run tests, check live for drift on functions 022 replaces, back up, apply 022 in one transaction, deploy `client-portal` if changed, push `main` with an explicit refspec, deploy both Cloudflare sites.
- [ ] Walk on the TEST client: quote with a listed service, accept, checklist appears, tick in any order, Not Applicable, sign off all, confirm, Completion figures, send.
- [ ] Report what wasn't walked.
