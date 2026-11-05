# Business Setup Client Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change Business Setup to the client flow in the spec: open link, All Leads, Client Onboarding, portal acceptance, Zoho invoice, optional-timing payment, 45 service checklists, Completion, Accounting.

**Architecture:** Cases stay the unit of work, and `business_setup_case_sync` stays the only automatic stage mover, with a new stage list. A new public Edge Function takes open-link submissions. The client portal gains decide and payment-claim actions. Checklists are copied per service when a quote is accepted.

**Tech Stack:** Supabase Postgres (plpgsql, `security definer` RPCs), React with Vite (`Main Module` shell), Deno Edge Functions, `node --test`, throwaway Postgres 18 through `tests/run-local.sh`, DOC OCR Module in the browser.

**Spec:** `Business Setup Module/docs/2026-11-05-business-setup-client-flow-design.md`, with `2026-11-05-business-setup-service-checklists.md`. Read `2026-11-04-business-setup-restructure-design.md` for what the new spec keeps.

## Global Constraints

- Worktree `D:\Abhijith Projects\CRM-bs-restructure`, branch `business-setup-restructure`.
- Migrations are in `Database Module/Business Setup Base/migrations`, re-runnable and tested by running twice. Live has `001` to `014`, and those are not edited. `015` and `018` are not live, so they are edited in place until Task 9 applies them.
- Migration run order: `015`, `016_client_flow`, `018_portal` (phase A), `019_intake` (phase B), `022_checkpoints` (phase C), `023_bd_transfer` (phase D). `020` and `021` are already live from another release (client main fields, visa registration), so this plan skips them. `run-local.sh` applies 13 14 20 21 15 16 18 then 19 22 23. There is no `017`.
- Tables stay read-only through the API. Writes go through `security definer` RPCs starting with `business_setup_require(...)`, each with explicit `revoke` and `grant` lines.
- Portal and intake functions take no `auth.uid()`, resolve the client on the server, and are callable by the service role only.
- Blocked actions raise one plain sentence naming what is missing.
- Client data, prices and `Resources/` never enter the repository. The public repo holds no template file with bank details.
- Banking, Accounting and Template Hub documents calculate exactly as before.
- Keep every key `business_setup_dashboard` returns today, because `Dashboard Module/services/summaryApi.js` reads it. New keys are additions.
- All OCR goes through `DOC OCR Module/browser/readDocument.js`. No cloud OCR.
- Zoho stays drafts-only: no call that updates, sends or deletes a Zoho document.
- Styling stays as it is today.
- Each migration gets its reverse in `rollback/013_019_rollback.sql` (name kept). `ROLLBACK_TEST=1` in `run-local.sh` must pass.
- Do not touch cases BSC000001 to BSC000003 beyond the stage mapping.
- Nothing goes live, is pushed or is merged without the user's separate approval per phase (Tasks 9, 13, 16, 18). Each release deploys to `abcrm` and `crm-abcapital.pages.dev`.
- Deploy `client-portal` only from this branch once merged with `origin/main`, since it holds both sides' actions.

**Test commands:**
- SQL: `bash "Database Module/Business Setup Base/tests/run-local.sh"`. Expected: exits 0.
- Logic: `node --test "Business Setup Module/tests/"`. Expected: all pass.
- Build: `npm run build` in `Main Module`. Expected: exits 0.

New SQL tests follow `tests/050_handover_test.sql` for setup and acting users (`public.bs_as`). The lists below name what each test must prove.

## Review Focus

1. **A link revoked while a client is filling the form:** submit is refused with a plain message, and the answers stay on screen. Test in Task 11.
2. **A link submission whose email matches a client who already has a login:** staff link the existing client, no second login is made, no password resets, and files appear in that client's account. Test in Task 10.
3. **A quote revised after the client accepted it and the letter was accepted:** refused once any service has started. Before that, both acceptances clear and the case stays at Onboarding. Test in Task 3.
4. **A payment claim confirmed twice, or one above the balance:** one payment and one voucher only, and the overpayment rule still applies. Test in Task 4.
5. **A mapped live case with no form or no client at Onboarding:** the screen opens, Fields can be filled by staff, and the quote asks for a client. Test in Task 2.

---

## Phase A: Core flow

### Task 1: Merge main and rework Task 7-8 work

**Files:**
- Modify: branch merge, `migrations/015_documentation.sql`, `migrations/018_portal.sql`, `tests/090_documentation_test.sql`, `tests/100_portal_signed_test.sql`, `tests/110_phase2_fixes_test.sql`, `tests/run-local.sh`, `Client Login Module/supabase/client-portal/index.ts`, `Client Login Module/portal/ClientPortal.jsx`

**Interfaces:**
- Produces: `business_setup_fee_items.is_service boolean not null default true`. The existing 24 items are set false by migration, matched by being present before the migration runs.
- Produces: `business_setup_invoice_record(p jsonb) returns uuid`, keys `case_id`, `quote_id`, `invoice_number`, `invoice_date`, `amount`, `file_path`, needing `setup.payments.manage`. `business_setup_case_invoice_override(p_case uuid, p_reason text)`, needing `setup.payments.override`. Finish either if Task 9 of the old plan left it partial.

- [ ] **Step 1:** Commit the three new docs and the untracked `tests/110_phase2_fixes_test.sql`. `Add Business Setup client flow spec and plan`
- [ ] **Step 2:** Merge `origin/main`. For the two `Template Module/templates/Service_*.docx` conflicts, take `main`'s copies, then run `Template Module/scripts/build_service_templates.py` only if its diff still adds Net and VAT rows. Run all test commands. Expected: pass.
- [ ] **Step 3: Write the failing test** in `090`:

```text
letter_without_payment: accepted quote, no payment, letter allowed
letter_needs_acceptance: unaccepted quote, letter refused
no_paid_override: business_setup_case_paid_override no longer exists
no_task7_items: Company registration, Company renewal, Visa not seeded
cost_line_no_service: a line whose fee item has is_service false creates no service on accept
invoice_two: a second invoice is allowed, and a duplicate number on one quote is refused
invoice_override: needs permission and reason
```

- [ ] **Step 4:** Run SQL tests. Expected: FAIL.
- [ ] **Step 5:** Edit `015`: drop the paid gate on letters, the paid override, the three items, and keep `paid_override_reason` out of new code. Add `is_service`. Edit `018` and `client-portal`: remove `setup_signed_upload` and its portal screen. Remove the matching tests.
- [ ] **Step 6:** Run all test commands. Expected: PASS.
- [ ] **Step 7: Commit.** `Rework documentation for acceptance without a payment gate`

### Task 2: New stages and mapping

**Files:**
- Create: `migrations/016_client_flow.sql`, `tests/120_client_flow_test.sql`
- Modify: `rollback/013_019_rollback.sql`, `tests/rollback-check-013.sql`

**Interfaces:**
- Produces: `business_setup_cases.stage` check: `Lead, Review, Onboarding, Pipeline, Completion, With Accounts, Completed, Cancelled, Lost`.
- Produces: `business_setup_case_move_to_onboarding(p_case uuid, p_client text default null, p_allow_duplicate boolean default false) returns text`, returning the client id. Reuses `business_setup_case_link_client_body`.
- Produces: `business_setup_case_list(p_view text)` views: `assigned`, `leads`, `inputs`, `onboarding`, `pipeline`, `completion`, `closed`. Each row keeps today's keys and adds `referred_by_name`.
- Produces: `business_setup_case_docs(p_case uuid)` keys: `fields`, `documents`, `quote`, `login`, `quote_accepted`, `letter`, `letter_accepted`, `invoice`, `balance`.

- [ ] **Step 1: Write the failing test:**

```text
mapping: Contact to Lead; Services and Documentation to Onboarding; Assignment and In service to Pipeline; Completed, Cancelled, Lost unchanged
map_twice: running the migration again changes nothing
move_no_owner: refused with "Assign the lead before moving it."
move_non_owner: refused; a holder of setup.cases.approve allowed
move_duplicate: refused on a duplicate until staff link or allow it
no_form_case: case with no form or client at Onboarding lists, and fields item reads false
to_pipeline: all items met moves to Pipeline with zero payment
service_gate: service on a case starts with no payment; service with no case still needs one
all_closed: all services closed with one Completed moves to Completion; all cancelled moves to Cancelled
lost_after_pipeline: refused
```

- [ ] **Step 2:** Run SQL tests. Expected: FAIL.
- [ ] **Step 3:** Implement: replace the check before updating rows, redefine `business_setup_case_sync`, `business_setup_case_list`, `business_setup_case_docs`, `business_setup_case_lost`, and `business_setup_start_gate` so a service whose quote has a case passes. Update `tests/070` and `080` to the new names.
- [ ] **Step 4:** Run all test commands. Expected: PASS.
- [ ] **Step 5: Commit.** `Move cases to the client flow stages`

### Task 3: Acceptance records and login on quote

**Files:**
- Modify: `migrations/016_client_flow.sql`, `migrations/018_portal.sql`, `tests/120_client_flow_test.sql`, `tests/100_portal_signed_test.sql`, `Client Login Module/supabase/client-portal/index.ts`

**Interfaces:**
- Produces: table `business_setup_acceptances` as in spec section 6, append-only.
- Produces: `business_setup_portal_decide(p_account uuid, p_document uuid, p_decision text, p_note text default null) returns void`, service role only. `p_decision` is `Accepted` or `Rejected`.
- Produces: `business_setup_issue_login_ok(p_case uuid) returns jsonb` keys `client_id`, `email`, `has_login`, needing `setup.leads.manage`, refusing unless the quote is issued.
- Produces: portal actions `setup_decide { document_id, decision, note }`, and staff action `setup_issue_login { case_id }` returning `{ ok, emailed, username }` and never the password.

- [ ] **Step 1: Write the failing test:**

```text
decide_own_only: another client's document refused
decide_quote: Accepted calls accept logic, creates services, stores login and revision
decide_reject: Rejected needs a note, and creates no service
decide_expired: refused
decide_twice: a second decision on one revision refused
letter_order: a letter decision refused before the quote is accepted
revise_clears: revising clears quote and letter acceptance, case stays at Onboarding
revise_after_start: refused once any service has started
staff_signed: confirming a staff-uploaded signed copy writes an acceptance with source Staff, for quote and letter
login_once: issuing twice makes one account, and no password change
login_perm: a user without setup.leads.manage refused
```

- [ ] **Step 2:** Run SQL tests. Expected: FAIL.
- [ ] **Step 3:** Implement the functions and portal actions. `setup_issue_login` generates the password server-side using `logic/loginSecret.js`'s rules, stores it through the path `admin_grant_access` uses, and emails it. A failed email returns `emailed: false`, keeping the login. Returning clients get a notice email only.
- [ ] **Step 4:** Run all test commands. Expected: PASS.
- [ ] **Step 5: Commit.** `Add client acceptance and issue the login with the quote`

### Task 4: Payment claims

**Files:**
- Modify: `migrations/016_client_flow.sql`, `migrations/018_portal.sql`, `tests/120_client_flow_test.sql`, `Client Login Module/supabase/client-portal/index.ts`

**Interfaces:**
- Produces: table `business_setup_payment_claims` as in spec section 7.
- Produces: `business_setup_portal_claim_add(p_account uuid, p jsonb) returns uuid`, keys `invoice_id`, `amount`, `paid_on`, `reference`, `proof_path`.
- Produces: `business_setup_payment_add(p jsonb)` accepts optional `claim_id`, and marks that claim Confirmed in the same transaction.
- Produces: `business_setup_claim_refuse(p_id uuid, p_note text) returns void`, needing `setup.payments.manage`.
- Produces: `business_setup_dashboard` new keys: `client_inputs`, `awaiting_client`, `payment_claims`, `at_completion`.
- Produces: portal action `setup_payment_claim`, and proof upload through `upload_start` with PDF, JPG, PNG, 10 MB.

- [ ] **Step 1: Write the failing test:**

```text
claim_no_balance: a claim leaves net paid and balance unchanged, and no voucher
claim_confirm: payment_add with claim_id creates one payment, one voucher, claim Confirmed
claim_confirm_twice: second confirm refused, still one voucher
claim_over: amount above the balance follows the existing overpayment rule
claim_refuse: needs a note, client sees status and note
claim_other_client: another client's invoice refused
part_payment: two payments give the right balance through With Accounts
dashboard_keys: old keys present, new keys count correctly
```

- [ ] **Step 2:** Run SQL tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run all test commands. Expected: PASS.
- [ ] **Step 5: Commit.** `Add client payment claims confirmed by staff`

### Task 5: Zoho Publish to client

**Files:**
- Modify: `Integrations Module/supabase/zoho-books/handlers.ts`, `handlers.test.ts`, `index.ts`, `Integrations Module/components/ZohoPanel.jsx`, `migrations/016_client_flow.sql`

**Interfaces:**
- Produces: action `document_publish { source_table, source_id, kind }`, needing the manage permission. Returns `{ invoice_id }`.
- Produces: `business_setup_invoice_publish(p jsonb) returns uuid`, service role only, keys `quote_id`, `invoice_number`, `invoice_date`, `amount`, `file_path`, `zoho_id`. Repeat call with the same `zoho_id` returns the same row.

- [ ] **Step 1: Write the failing tests** in `handlers.test.ts`:

```text
publish_refuses_draft: Zoho status draft returns "Send this invoice in Zoho first."
publish_stores: status sent reads PDF, stores it, records one invoice
publish_twice: returns the same invoice, stores no second file
publish_get_only: the only Zoho calls made are GET
publish_estimate_refused: kind estimate refused
```

- [ ] **Step 2:** Run `deno test` on the folder, as the existing tests do. Expected: FAIL.
- [ ] **Step 3:** Implement using the existing state and PDF readers. Add the **Publish to client** button in `ZohoPanel` only when a `publish` prop is passed, so Banking and Accounting stay unchanged.
- [ ] **Step 4:** Run tests and the build. Expected: PASS.
- [ ] **Step 5: Commit.** `Publish a sent Zoho invoice to the client's login`

### Task 6: Tabs and All Leads

**Files:**
- Create: `Business Setup Module/components/AllLeads.jsx`
- Modify: `logic/nav.js`, `components/BusinessSetup.jsx`, `components/Dashboard.jsx`, `services/businessSetupApi.js`, `tests/logic.test.mjs`, `tests/render.test.mjs`
- Remove once replaced: `components/Leads.jsx`

**Interfaces:**
- Consumes: `business_setup_case_list`, `business_setup_case_move_to_onboarding`, `business_setup_case_take`, reassign functions.
- Produces: `NAV` keys in order: `dashboard, leads, onboarding, pipeline, completion, clients, services, tasks, settings`. Labels: Dashboard, All Leads, Client Onboarding, Pipeline, Completion, Clients, Services & Fees, Tasks, ⚙ Settings.

- [ ] **Step 1: Write the failing test** in `logic.test.mjs` and `render.test.mjs`:

```text
nav_order: the nine keys and labels above
leads_sections: three headed sections render in order, the first expanded
assign_button: shown only on unowned rows
```

- [ ] **Step 2:** Run logic tests. Expected: FAIL.
- [ ] **Step 3:** Implement, moving the New lead, Mark lost and reassign actions from `Leads.jsx` and the link-client step from `ShareLink.jsx` into a Move to Client Onboarding dialog. Update Dashboard figures per spec section 12. Pipeline temporarily renders `Cases.jsx`. Completion renders a list and the existing send button.
- [ ] **Step 4:** Run all test commands. Expected: PASS.
- [ ] **Step 5: Commit.** `Add All Leads and the new Business Setup tabs`

### Task 7: Client Onboarding screen

**Files:**
- Create: `Business Setup Module/components/ClientOnboarding.jsx`, `Business Setup Module/logic/ocrFill.js`
- Modify: `components/Onboarding.jsx`, `components/DocumentationPage.jsx`, `components/workspace/Quotes.jsx`, `logic/checklist.js`, `tests/logic.test.mjs`

**Interfaces:**
- Consumes: `business_setup_case_docs`, Task 3 and 4 RPCs and actions, Task 5 `publish` prop.
- Produces: `mergeOcr(answers, read) -> { answers, conflicts }` in `logic/ocrFill.js`: fills empty fields only, and lists differing values.
- Produces: `CHECKLIST` keys equal to `business_setup_case_docs`' keys, except `balance`.

- [ ] **Step 1: Write the failing test:**

```text
merge_fills_empty: an empty field takes the read value
merge_keeps_value: a filled field stays, and the difference is in conflicts
merge_ignores_unknown: a read key not on the form is dropped
checklist_order: fields, documents, quote, login, quote_accepted, letter, letter_accepted, invoice
```

- [ ] **Step 2:** Run logic tests. Expected: FAIL.
- [ ] **Step 3:** Implement the screen: reuse the review screen from `Onboarding.jsx` for Fields and Documents, `Quotes.jsx` for quote and letter with the AB Capital template as default, the Banking `KycDocumentFill` pattern for **Read documents**, staff signed upload, invoice record and publish, claims with Confirm and Refuse, **Resend** login. The issue-quote action calls `setup_issue_login` after the quote saves.
- [ ] **Step 4:** Run all test commands. Expected: PASS.
- [ ] **Step 5: Commit.** `Add the Client Onboarding screen with OCR`

### Task 8: Portal screens

**Files:**
- Modify: `Client Login Module/portal/ClientPortal.jsx`, `Client Login Module/portal/portalApi.js`, `migrations/018_portal.sql`, `tests/040_portal_test.sql`

**Interfaces:**
- Consumes: `setup_view`, `setup_decide`, `setup_payment_claim`.
- Produces: `business_setup_portal_view` new keys: `letters`, `claims`, each quote's and letter's `decision`. Keeps all others.

- [ ] **Step 1: Write the failing test** in `040`:

```text
view_decisions: a quote shows its decision and revision
view_only_published: an invoice appears only once recorded or published
view_forbidden: no staff name, note, reason, or override text in the view
view_claims: client sees own claims and status only
```

- [ ] **Step 2:** Run SQL tests. Expected: FAIL.
- [ ] **Step 3:** Implement the view, and portal sections per spec section 10: Accept and Reject on quotes and letters, Reject needs a note, **I have paid** on invoices.
- [ ] **Step 4:** Run all test commands. Expected: PASS.
- [ ] **Step 5: Commit.** `Show acceptance and payment claims in the client portal`

### Task 9: Phase A release (user approval needed)

- [ ] **Step 1:** Local walk on port 5181 is not possible without live data, so list what the walk will cover and ask the user to approve. Name the migrations, functions, and that test cases stay mapped.
- [ ] **Step 2:** On approval: back up live function definitions and affected rows, check no drift against `014`, apply `015`, `016`, `018` in one transaction, deploy `client-portal` and `zoho-books`, merge, push `main`, run `npm run deploy:cloudflare`, and confirm both addresses serve the build.
- [ ] **Step 3:** Browser walk with the TEST client and the user's sign-in: lead, Move to Onboarding, quote, login email, Accept in portal, letter, Accept, record invoice, Pipeline with zero payment, claim, Confirm, voucher. No console errors. Report what was not walked.

---

## Phase B: Open link

### Task 10: Intake data

**Files:**
- Create: `migrations/019_intake.sql`, `tests/130_intake_test.sql`
- Modify: `rollback/013_019_rollback.sql`, `tests/run-local.sh`, `components/ClientOnboarding.jsx`

**Interfaces:**
- Produces: tables `business_setup_intake_links`, `business_setup_form_files`, `business_setup_intake_rate`, form and case columns per spec section 5.
- Produces, staff: `business_setup_intake_link_new() returns jsonb` (`id`, `token`), `business_setup_intake_link_list() returns setof jsonb`, `business_setup_intake_link_revoke(p_id uuid)`, `business_setup_case_spam(p_case uuid, p_reason text)`, returning the storage paths for deletion.
- Produces, service role: `business_setup_intake_open(p_token text) returns jsonb` (`definition`, `version`), `business_setup_intake_upload_ok(p_token text, p_submission uuid, p_kind text, p_filename text, p_size bigint) returns text` (path), `business_setup_intake_submit(p_token text, p_submission uuid, p_answers jsonb, p_ip_hash text) returns uuid` (case id), `business_setup_intake_cleanup() returns setof text`.

- [ ] **Step 1: Write the failing test:**

```text
link_multi: two submissions on one link make two cases, both referred_by the generator, owner null, stage Review
link_history: case history names the referrer and link date
revoked: open, upload and submit refused after revoke
submit_retry: same submission id returns the same case
limits: 31st submission per link per day refused; 6th per address per hour refused; 16th file refused; 11 MB refused; .exe refused
required: missing required answer refused
list_scope: a user sees own links; holder of setup.cases.approve sees all and revokes any
anon: anon and authenticated cannot read links, tokens of others, forms or files, or call service functions
existing_client: linking a client with a login makes no second login, resets no password, and writes files to client_portal_documents when the login exists
files_copied: files written to client_portal_documents when the login is issued
spam: needs setup.cases.approve, sets Lost, and returns paths
cleanup: returns only paths older than 7 days with no submission
```

- [ ] **Step 2:** Run SQL tests. Expected: FAIL.
- [ ] **Step 3:** Implement. The token comes from `gen_random_bytes(32)`, hex encoded. Existing form functions handle a null account. Show form files in `ClientOnboarding.jsx`.
- [ ] **Step 4:** Run all test commands. Expected: PASS.
- [ ] **Step 5: Commit.** `Add intake links and open-form data`

### Task 11: Public function and form

**Files:**
- Create: `Business Setup Module/supabase/setup-intake/index.ts`, `index.test.ts`, `Business Setup Module/components/IntakeForm.jsx`, `Business Setup Module/components/IntakeLinks.jsx`, `Business Setup Module/services/intakeApi.js`
- Modify: `Main Module/src/Root.jsx`, `components/AllLeads.jsx`, `tests/render.test.mjs`, `tests/undefined.test.mjs`

**Interfaces:**
- Consumes: Task 10 functions.
- Produces: Edge Function `setup-intake`, deployed with `--no-verify-jwt`. Actions `open`, `upload_start`, `submit` per spec section 5. The address is hashed with a server-side salt secret, `INTAKE_IP_SALT`.
- Produces: a daily scheduled call of `cleanup` through the existing schedule pattern.

- [ ] **Step 1: Write the failing test** in `index.test.ts` and `render.test.mjs`:

```text
trap_field: a filled trap returns a success-looking reply and creates nothing
no_read_back: no action returns a stored file or another submission
bad_token: plain message, no definition
revoked_during_fill: submit refused, form keeps the answers on screen
root_route: ?intake= renders IntakeForm with no staff login
```

- [ ] **Step 2:** Run tests. Expected: FAIL.
- [ ] **Step 3:** Implement. `Root.jsx` checks `?intake=` before the portal token, and lazy-loads the form so no staff code enters its chunk. The form reuses the portal form component and `logic/formDefinition.js`. Add the notice text from the spec, marked for the user's check. `IntakeLinks.jsx` sits at the right of All Leads.
- [ ] **Step 4:** Run all test commands. Expected: PASS.
- [ ] **Step 5: Commit.** `Add the open client form and link panel`

### Task 12: Security review of the public surface

**Files:**
- Modify: whichever files the findings touch.

- [ ] **Step 1:** Dispatch a reviewer on `setup-intake`, `019_intake.sql`, storage policies, and the `IntakeForm` chunk's contents. Check for tokens in logs, CORS, oversized bodies, path traversal in filename, and enumeration of clients.
- [ ] **Step 2:** Fix findings, each with a test.
- [ ] **Step 3:** Run all test commands. Expected: PASS.
- [ ] **Step 4: Commit.** `Fix public form review findings`

### Task 13: Phase B release (user approval needed)

- [ ] **Step 1:** Ask the user to approve, naming the new public address and the risk that spam can reach the queue with no captcha.
- [ ] **Step 2:** On approval: back up, apply `019`, set `INTAKE_IP_SALT`, deploy `setup-intake`, merge, push, deploy both Cloudflare targets.
- [ ] **Step 3:** Walk: generate a link, submit in a private window with a test file, confirm the Referred by name in All Leads, revoke, confirm refusal. Mark the test case Lost with Mark as spam, so its files are deleted.

---

## Phase C: Service work

### Task 14: Checklists data

**Files:**
- Create: `migrations/022_checkpoints.sql`, `Database Module/Business Setup Base/scripts/build_checkpoints.py`, `tests/140_checkpoints_test.sql`
- Modify: `rollback/013_019_rollback.sql`, `tests/run-local.sh`. `018` is live after Task 9, so portal view changes go in `022`

**Interfaces:**
- Produces: `build_checkpoints.py` turns the checklist file into the seed section of `022`. `(if ` and `(where ` give Optional.
- Produces: three tables per spec section 8. 45 fee items with `is_service` true, null amount, VAT 5, linked set.
- Produces: `business_setup_checkpoint_set(p_id uuid, p_state text, p_reason text default null) returns void`, `p_state` in `Open, Done, Not applicable`.
- Produces: `business_setup_service_confirm(p_id uuid, p_output_details text default null, p_override_reason text default null) returns void`, wrapping `business_setup_service_complete`.
- Produces: `business_setup_checkpoint_list_save(p jsonb) returns uuid`, needing `setup.fees.manage`.
- Produces: `business_setup_portal_view` service rows gain `items` (label, state) and `progress`.

- [ ] **Step 1: Write the failing test:**

```text
seed_counts: 45 sets, 512 steps, 40 Optional, rerun adds none
copy_on_accept: accepting a quote copies each list once; a later list edit leaves it unchanged
any_order: the last item can be ticked first
perm: non-owner refused; holder of setup.cases.approve allowed
na_reason: Not applicable needs a reason; unticking needs a note; each change in service history
progress: Done / (all - Not applicable)
confirm_blocks: an open Mandatory refuses, naming the item
confirm_optional: an open Optional becomes Not applicable with reason "Not needed", progress 100
confirm_output: still needs output or override reason
no_list: a typed service confirms with simple statuses
portal_no_reasons: labels and progress only
```

- [ ] **Step 2:** Run SQL tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Run the script, and commit its output in `022`.
- [ ] **Step 4:** Run all test commands. Expected: PASS.
- [ ] **Step 5: Commit.** `Add 45 service checklists`

### Task 15: Pipeline and Completion screens

**Files:**
- Create: `components/Pipeline.jsx`, `components/Completion.jsx`, `logic/progress.js`
- Modify: `migrations/022_checkpoints.sql`, `tests/140_checkpoints_test.sql`, `components/FeeMaster.jsx`, `components/BusinessSetup.jsx`, `Accounting Module/components/SetupValidation.jsx`, `Client Login Module/portal/ClientPortal.jsx`, `tests/logic.test.mjs`
- Remove once replaced: `components/Cases.jsx`

**Interfaces:**
- Produces: `progress(items) -> number` in `logic/progress.js`, 0 to 100, with no applicable items returning 0.
- Produces: `business_setup_case_send_to_accounts(p_case uuid) returns void`, needing `setup.cases.approve`, wrapping the existing per-quote send and moving the stage to With Accounts.
- Consumes: existing `business_setup_accounts_review`, which now moves the case to Completed or back to Completion.

- [ ] **Step 1: Write the failing test:**

```text
send_perm: owner without setup.cases.approve refused
send_unpaid: unpaid balance does not block
send_not_ready: open service refused, naming it
accounts_close: Validate moves to Completed
accounts_revert: Revert returns to Completion, services reopen only by admin action
payment_with_accounts: payment still allowed until closed
progress_values: {Done, Done, Open, N/A} gives 67; all N/A gives 0
```

- [ ] **Step 2:** Run tests. Expected: FAIL.
- [ ] **Step 3:** Implement. `FeeMaster.jsx` gains the list editor. `SetupValidation.jsx` keeps its layout and adds the case number. The portal shows items and progress.
- [ ] **Step 4:** Run all test commands. Expected: PASS.
- [ ] **Step 5: Commit.** `Add Pipeline checklists and Completion`

### Task 16: Phase C release (user approval needed)

- [ ] **Step 1:** Ask the user to approve, and to give at least one `ACCOUNTS` role holder so validation can be walked.
- [ ] **Step 2:** On approval: back up, apply `022`, deploy `client-portal`, merge, push, deploy both Cloudflare targets.
- [ ] **Step 3:** Walk: TEST client service list, tick, Not applicable, Confirm, Completion, send, validate. Report what was not walked.

---

## Phase D: Connections

### Task 17: Business Development pick-up and transfer

**Files:**
- Create: `migrations/023_bd_transfer.sql`, `tests/150_bd_transfer_test.sql`
- Modify: `rollback/013_019_rollback.sql`, `tests/run-local.sh`, `components/AllLeads.jsx`, Business Development lead screen

**Interfaces:**
- Produces: `business_setup_bd_pickup(p_lead uuid) returns uuid`, needing `setup.leads.manage`, creating or returning the case with the BD owner kept.
- Produces: `business_setup_bd_lead_list() returns setof jsonb`, with no fees.
- Produces: `business_setup_bd_payment_add(p jsonb)`, gated by `bd_can_edit_lead`.
- Produces: a `bd_mark_lead_won` handover with queue `Business Setup` attaches to the existing case or creates one at Lead, and prefills the quote.

- [ ] **Step 1: Write the failing test:**

```text
pickup: any open lead picks up once; the second caller is told who took it; BD owner unchanged
no_fees: list holds no fee fields
won_attaches: Won after pickup uses the same case
won_new: Won with no pickup creates one case at Lead; a retry creates none
other_queue: another queue creates no case
prefill: accepted services and agreed fees prefill the quote
bd_payment: refused without bd_can_edit_lead; uses one voucher numbering
```

- [ ] **Step 2:** Run SQL tests. Expected: FAIL.
- [ ] **Step 3:** Implement, with the BD rows and Assign to me in the All Leads section, and a Hand over to select on the Won form.
- [ ] **Step 4:** Run all test commands. Expected: PASS.
- [ ] **Step 5: Commit.** `Connect Business Development leads to Business Setup`

### Task 18: Phase D release and close-out (user approval needed)

- [ ] **Step 1:** Ask the user to approve. On approval: back up, apply `023`, merge, push, deploy both Cloudflare targets, walk one BD lead through Won.
- [ ] **Step 2:** Update `Business Setup Module/README.md` and `Database Module/Business Setup Base/README.md` with the flow, tabs and open items in spec section 18.
- [ ] **Step 3: Commit.** `Document the Business Setup client flow`
