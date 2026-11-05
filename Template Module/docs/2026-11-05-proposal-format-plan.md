# Business Formation Proposal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Service Documents > Business Setup generates a multi-option Business Formation Proposal under the main BSQ number, keeps Word and PDF, opens the PDF on View, copies both to the client's OneDrive folder from this PC, and mails only the PDF.

**Architecture:** A proposal is an ordinary `hub_documents` quote with its options in `field_values.proposal`, and Option 1 mirrored into `lines`. New pure logic, a new generate service and a new screen sit beside the old form, which stays. Saved authority sets live in a new admin-edited table, seeded from a private file.

**Tech Stack:** React 19, Supabase Postgres and Edge Functions, docxtemplater, JSZip, existing `docxToPdf`, FastAPI Client Module, `node --test`, local PostgreSQL 18 runner, pytest, Deno test.

**Spec:** `Template Module/docs/2026-11-05-proposal-format-design.md`

**Worktree:** `D:\Abhijith Projects\CRM-proposals`, branch `proposal-format`, base `main` at b58a28f. All paths below are relative to it.

## Global Constraints

- `library_template` of a proposal: `AB Capital/Proposal`. `doc_type` `quote`, department `Business Setup`, `vat_mode` `none`, `vat_rate` 0.
- Number: `hub_next_number('Business Setup', 'quote')`. Letter: `hub_next_number('Business Setup', 'letter')`. No new series.
- Right for create, letter and send: `business_setup_require('setup.quotes.manage')`. Authority edits: `hub_is_admin()`.
- Default USD rate `3.6725`. USD is AED / rate rounded to whole dollars. An option's USD total comes from its AED total.
- Options are never added together. No grand total prints or is stored.
- For proposals `storage_path` is the PDF and `word_path` is the Word file. Only the PDF is ever attached to mail.
- OneDrive root: `C:\Users\User\OneDrive - AB Capital Services FZE\CRM AB CAPITAL`. Target: `Business Setup\<Client name - code>\Proposals`, or `<Client name>` with no code.
- Sender mailbox `info@abcapital.ae`.
- **The repo is public.** No prices, bank details or old proposal files are committed. Seeds and source documents stay in `D:\Abhijith Projects\CRM Private`.
- Test client name `TEST CLIENT - DO NOT USE`.
- No live change (SQL, function deploy, merge, deploy, real mail) without the user's approval for that step. Never edit the old form's output.
- Do not run `npm run build` while the dev server runs: it kills it with EBUSY. Clear `node_modules/.vite` after editing `src/jsx`.

## Shared data shape

Every task uses this. Amounts on the record are numbers.

```js
field_values.proposal = {
  usd_rate: 3.6725,
  accepted_option: null,            // 0-based index, set when the letter is made
  options: [{
    authority_key, authority_name, activity, title, description,
    logo_path, timeline_path,       // copied from the set at generate time, may be null
    package_includes: [string], red_notes: [string],
    services: [{ name, remarks, amount, subs: [{ name, amount }] }],
  }],
  shared: {
    addons: [{ name, amount, text }], // amount null when text is used
    documents: [string], payment: [string], scope: [string], notes: [string],
  },
}
```

## Review Focus

1. **Double click on Generate:** the second click takes no second number. Test in Task 4.
2. **Client names with `&`, `/`, `'` or Arabic:** the Word file opens, and the folder and file names are safe. Tests in Tasks 3 and 5.
3. **Option 1 removed, or its authority changed, after shared sections were edited:** staff get a warning, and Option 2 becoming Option 1 re-mirrors `lines` and the totals. Test in Task 2.
4. **Authority set with no logo or timeline, or a deleted image:** the document generates with no broken image. Test in Task 3.
5. **Typed amounts like `1,000`, blank, negative, or a service given both an amount and sub services:** named error before a number is taken. Tests in Tasks 1 and 2.

---

### Task 1: Database

**Files:**
- Create: `Database Module/Template Hub Base/migrations/008_proposals.sql`, `Database Module/Template Hub Base/rollback/008_rollback.sql`, `Database Module/Template Hub Base/tests/050_proposal_test.sql`
- Modify: `Database Module/Template Hub Base/tests/run-local.sh`, `Database Module/Template Hub Base/README.md`
- Add to the commit: `Template Module/docs/2026-11-05-proposal-format-design.md`, this plan

**Interfaces:**
- Produces, for later tasks:
  - `hub_documents` columns `word_path`, `onedrive_path`, `onedrive_saved_at`, `mail_sent_at`, `mail_sent_by`, `mail_sent_to`
  - table `hub_proposal_authorities`: `authority_key` pk, `name`, `kind` in (`free_zone`,`mainland`), `description`, `logo_path`, `timeline_path`, `table_title`, `services` jsonb, `package_includes` jsonb, `red_notes` jsonb, `addons` jsonb, `documents` jsonb, `payment` jsonb, `scope` jsonb, `notes` jsonb, `active` bool, `updated_at`, `updated_by`
  - `hub_settings` key `proposal_defaults`: `{ "usd_rate": 3.6725, "contact": { "name": "", "phone": "", "email": "", "website": "" } }`, blank in the migration
  - `hub_proposal_create(p jsonb) returns hub_documents`, keys: `client_id, client_name, contact_name, contact_email, contact_phone, proposal`
  - `hub_proposal_attach(p_id uuid, p_pdf text, p_word text) returns hub_documents`
  - `hub_proposal_saved(p_id uuid, p_path text) returns hub_documents`
  - `hub_proposal_letter_create(p jsonb) returns hub_documents`, keys: `quote_id, option, contact_phone, client_address, license_number, vat_trn`
  - `hub_proposal_authority_save(p jsonb)`, `hub_proposal_defaults_save(p jsonb)`
  - `hub_proposal_can_send() returns boolean`

- [ ] **Step 1: Write failing tests in `050_proposal_test.sql`**

Using the helpers in `030_letter_test.sql`, assert:
- `create numbers from main counter`: a proposal between two old `hub_document_create` quotes gets the next `BSQ` serial, no gaps or repeats.
- `create mirrors option 1`: two options with totals 100 and 900 give `total_amount = 100`, `lines` length equal to Option 1's services, `library_template = 'AB Capital/Proposal'`, `vat_mode = 'none'`.
- `service amount = subs`: stored amount is recalculated from subs. `{amount: 5, subs: [{amount: 3}]}` raises `disagrees with its sub services`.
- `rejects`: no options, blank activity, blank authority, negative amount, non-numeric amount, usd_rate 0, bad email, blank contact. Each raises a named message and leaves the counter unchanged.
- `rights`: a user without `setup.quotes.manage` fails on create, letter and attach. A non-admin fails on authority save.
- `letter takes chosen option`: option 1 (0-based) gives letter lines equal to that option's services and total 900, `BSE` number, `parent_id` set, `field_values.accepted_option = 1`. The quote's `field_values.proposal.accepted_option` becomes 1, and its `lines`, `services` and `total_amount` become that option's.
- `letter guard`: `hub_document_create({doc_type:'letter', parent_id:<proposal>})` and `hub_library_letter_create` with that parent both raise `Choose the accepted option`. Letters on non-proposal quotes still work.
- `one letter`: a second letter on the same proposal raises the existing "already has its engagement letter" message.
- `voucher`: the Voucher Register row exists after create.
- Migration runs twice (idempotent), and rollback removes all of it, keeps old quotes, and restores nothing else.

- [ ] **Step 2: Add the files to `run-local.sh` and run**

Run: `bash "Database Module/Template Hub Base/tests/run-local.sh"`
Expected: FAIL, `hub_proposal_create` does not exist.

- [ ] **Step 3: Write `008_proposals.sql` and `008_rollback.sql`**

Functions are `security definer set search_path = public, pg_temp`, with `revoke ... from public, anon` and `grant execute ... to authenticated`, as in `007_work_types.sql`. Letter guard: a `before insert` trigger on `hub_documents`. When `new.doc_type = 'letter'` and the parent's `library_template = 'AB Capital/Proposal'`, it raises unless `new.field_values ? 'accepted_option'`. `hub_proposal_can_send` wraps `business_setup_require`. RLS on the table: select for `authenticated`, no direct writes.

- [ ] **Step 4: Run tests**

Run: `bash "Database Module/Template Hub Base/tests/run-local.sh"`
Expected: exit 0, no failed checks.

- [ ] **Step 5: Commit**

```bash
git add "Database Module/Template Hub Base" "Template Module/docs/2026-11-05-proposal-format-design.md" "Template Module/docs/2026-11-05-proposal-format-plan.md"
git commit -m "Add proposal records, authority sets and accepted-option letters"
```

### Task 2: Proposal model

**Files:**
- Create: `Template Module/logic/proposalModel.js`, `Template Module/tests/proposalModel.test.mjs`

**Interfaces:**
- Produces (pure, no imports from React or Supabase):
  - `blankOption(): Option`, `optionFromAuthority(set): Option`, `sharedFromAuthority(set): Shared`
  - `serviceAmount(service): number`, `optionTotal(option): number`, `toUsd(aed, rate): number`
  - `checkProposal(form, proposal): string | null`, the first problem
  - `toPayload(form, proposal, clientId): object`, the argument for `hub_proposal_create`, amounts as numbers
  - `removeOption(proposal, index)`, `needsSharedWarning(index, sharedDirty): boolean`
  - `printRows(option, rate): [{ label, aed, usd, remarks, bold, sub }]`
  - `proposalContext(doc, settings, images): object`, the data for the template, used by Task 3

- [ ] **Step 1: Write failing tests**

- `toUsd(40000, 3.6725) === 10892`, `toUsd(2000, 3.6725) === 545`.
- `optionTotal` of two services, one with subs 300 and 100, and one of 200, is `600`, and the USD total is `toUsd(600, rate)`, not a sum of rounded rows.
- `printRows` gives a bold parent with subtotal 400, then sub rows with `sub: true`, then a plain row. A zero row prints `0`.
- `checkProposal` names the problem for: no options, blank activity, blank amount, `-1`, `abc`, a service with both typed amount and subs, usd_rate 0, bad email. `1,000` is accepted as 1000 by `toPayload`.
- `removeOption(p, 0)` makes Option 2 first. `toPayload` then mirrors nothing itself but sends the new order. `needsSharedWarning(0, true)` is true, `needsSharedWarning(1, true)` is false.
- `proposalContext`: heading flag `show_option_heading` is false with one option and true with two; `has_remarks` is per option; no key holds a sum across options; add-on with `text` prints the text in both AED and USD; add-on with amount prints the amount and `toUsd`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test "Template Module/tests/proposalModel.test.mjs"`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `proposalModel.js`**

Date in `proposalContext` is `dd/mm/yyyy` in Asia/Dubai from `doc.created_at`. Bank fields come from `settings.company.bank`, contact from `settings.proposal_defaults.contact`.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test "Template Module/tests/proposalModel.test.mjs"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "Template Module/logic/proposalModel.js" "Template Module/tests/proposalModel.test.mjs"
git commit -m "Add the proposal calculations and form rules"
```

### Task 3: Word template and render

**Files:**
- Create: `Template Module/scripts/build_proposal_template.py`, `Template Module/templates/AB_Capital_Proposal_Template.docx`, `Template Module/logic/proposalDocx.js`, `Template Module/tests/proposalDocx.test.mjs`

**Interfaces:**
- Consumes: `proposalContext` from Task 2.
- Produces: `renderProposal(templateBuffer, context, images, deps): Promise<Blob>`, with `images = { [token]: { bytes: Uint8Array, type: "png"|"jpeg", width, height } }` and `deps = { PizZip, Docxtemplater }`.

- [ ] **Step 1: Write failing tests**

Using the real template, and JSZip to read the output:
- `renders one option`: `document.xml` has the activity and total, and no `{` tags are left.
- `two options`: option headings present, a page break before Option 2, shared sections appear once.
- `escapes`: an activity of `Events & "Co" <A/B>` produces valid XML, parsed with a strict parser (`DOMParser` from `@xmldom/xmldom` if already a dependency, else a tag-balance check).
- `no image`: `logo_path` null gives no `w:drawing` for it and no dangling relationship.
- `image`: a 1x1 PNG adds `word/media/`, a relationship and the png content type, and the drawing keeps the aspect ratio.
- `no secrets in template`: the template's XML has no match for `/AE\d{10,}/` or `/\b\d{10,}\b/` and no `word/media` beyond the header logos.
- `remarks column`: option with no remarks uses the 3-column table.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test "Template Module/tests/proposalDocx.test.mjs"`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `build_proposal_template.py` and build the template**

`python "Template Module/scripts/build_proposal_template.py" "<path to Proposal-Business Formation-RAKEZ- Business Coaching.docx>"`. The source path is an argument, never committed. It keeps the header, footer, page border, styles and header logos, replaces the whole body with tags and stops if the source has no header images. Colours come from the IFZA PDF: table title bar red, alternate rows pale red, red italic notes. Service rows loop across two `w:tr` under `{#rows}`, one for `{#bold}` and one for `{^bold}`. Two tables per option under `{#has_remarks}` and `{^has_remarks}`. Images and page breaks are raw tags: `{@logo_xml}`, `{@timeline_xml}`, `{@page_break}`.

- [ ] **Step 4: Implement `renderProposal` in `proposalDocx.js`**

Render with docxtemplater `{ paragraphLoop: true, linebreaks: true, nullGetter: () => "" }`, then add media, relationships and content types with the zip step. Body of the raw image XML is built here.

- [ ] **Step 5: Run to verify it passes**

Run: `node --test "Template Module/tests/proposalDocx.test.mjs"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "Template Module/scripts/build_proposal_template.py" "Template Module/templates/AB_Capital_Proposal_Template.docx" "Template Module/logic/proposalDocx.js" "Template Module/tests/proposalDocx.test.mjs"
git commit -m "Add the proposal Word template and its render step"
```

### Task 4: Generate, Retry, View and OneDrive client calls

**Files:**
- Create: `Template Module/services/proposalGenerate.js`, `Template Module/services/proposalApi.js`, `Template Module/tests/proposalGenerate.test.mjs`

**Interfaces:**
- Consumes: Tasks 1, 2 and 3.
- Produces:
  - `generateProposal(input, deps): Promise<{ doc, wordBlob, pdfBlob, onedrive: string|null } | { error } | { doc, error }>`
  - `retryProposal(doc, deps)`, same return; `saveToOneDrive(doc, deps): Promise<string|null>`
  - `deps = { checkFirst, create, loadTemplate, loadImages, render, toPdf, upload(doc, blob, ext), attach, saveLocal(doc, wordBlob, pdfBlob), markSaved, createMail }`
  - `proposalApi.js`: `loadAuthorities()`, `saveAuthority(p)`, `saveDefaults(p)`, `createProposal(p)`, `attachProposal(id, pdf, word)`, `markProposalSaved(id, path)`, `createProposalLetter(p)`, `saveProposalFolder(doc, wordBlob, pdfBlob)`, `sendProposal(id, resend)`, `openWord(path)`. PDF upload uses `contentType: "application/pdf"`, so the signed link opens in the browser through the existing `openStored`.

- [ ] **Step 1: Write failing tests with fake deps**

- `order`: calls go check, trial render, create, render, toPdf, upload pdf, upload docx, attach, saveLocal, markSaved, createMail.
- `bad template takes no number`: a failed trial render never calls `create`.
- `check fails`: `create` not called, returns `{ error }`.
- `pdf fails after number`: returns `{ doc, error }`, `attach` not called, `retryProposal(doc)` rebuilds from `doc.field_values.proposal` and takes no new number.
- `client module off`: `saveLocal` returns null, the result succeeds with `onedrive: null`, `markSaved` not called.
- `double click`: two concurrent `generateProposal` calls on one guard object make one `create` call.
- `mail draft`: `createMail` text has the Ref and each option's authority and total, and no sum across options.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test "Template Module/tests/proposalGenerate.test.mjs"`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement both files**

Paths: `Business Setup/<doc.id>/<uuid>.pdf` and `.docx`. File names through the existing `fileNameFor`, with `.pdf` swapped in for the PDF. `toPdf` is `docxToPdf` from `Template Module/ardentax/logic/docxToPdf.js`, imported dynamically.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test "Template Module/tests/proposalGenerate.test.mjs"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "Template Module/services/proposalGenerate.js" "Template Module/services/proposalApi.js" "Template Module/tests/proposalGenerate.test.mjs"
git commit -m "Add proposal generation, retry and file calls"
```

### Task 5: Client Module OneDrive route

**Files:**
- Modify: `Client Module/clientmodule/api.py` (route beside `/api/clients-folder`, and the CORS path list at line 142), `Client Module/clientmodule/config.py`, `Client Module/config.json` (only add `proposalRoot`, leave the rest as on `main`)
- Test: `Client Module/tests/test_module.py`

**Interfaces:**
- Produces: `POST /api/proposal-folder`, form fields `word`, `pdf` (files), `client`, `client_id`, returns `{ "path": "<folder>", "word": "<file>", "pdf": "<file>" }`. Unknown config returns 503.

- [ ] **Step 1: Write failing tests, with a temp `proposalRoot`**

- `test_proposal_folder_saves_both`: files land in `<root>/Business Setup/Acme - CL000001/Proposals/`.
- `test_proposal_folder_no_code`: folder `Acme` when `client_id` is blank.
- `test_proposal_folder_no_overwrite`: a repeat gets ` (2)`.
- `test_proposal_folder_cleans_names`: client `A/B: ..\..\x` stays inside the root; file names too.
- `test_proposal_folder_types`: `word` must be `.docx` and `pdf` must be `.pdf`, else 400, nothing written.
- `test_proposal_folder_size`: over 25 MB gives 400.
- `test_proposal_folder_cors`: an allowed origin gets the CORS header and a refused origin does not.

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest "Client Module/tests/test_module.py" -k proposal_folder -v`
Expected: FAIL, 404.

- [ ] **Step 3: Implement the route and config**

`Settings.proposal_root: Path | None`. Reuse the name cleaning in `save_client_document`. Move it to a shared helper only if both routes then use it.

- [ ] **Step 4: Run to verify it passes**

Run: `python -m pytest "Client Module/tests/test_module.py" -v`
Expected: PASS, including older tests.

- [ ] **Step 5: Commit**

```bash
git add "Client Module/clientmodule" "Client Module/tests/test_module.py" "Client Module/config.json"
git commit -m "Save proposals into the client's OneDrive folder from this PC"
```

### Task 6: Mail function

**Files:**
- Create: `Agent Module/11_Personal_Agent/CEO Agent Module/supabase/proposal-mail-send/index.ts`, `rules.ts`, `rules_test.ts` in that folder

**Interfaces:**
- Consumes: `buildMail` from `../ardentax-mail-send/mime.ts`, `SmtpClient`, `ImapClient`, the password lookup pattern from `ardentax-mail-send/index.ts`.
- Produces: `POST { document_id, resend? }` returns `{ ok: true, sent_at, warnings }` or `{ error }`. Exported `attachmentsFor(doc): string[]`, `refusal(doc, { resend }): string | null`.

- [ ] **Step 1: Write failing tests in `rules_test.ts`**

- `attachmentsFor` returns only `doc.storage_path`, even when `word_path` is set.
- `refusal`: not a proposal; no `storage_path`; no draft subject; storage path not under `Business Setup/<id>/`; bad address; already sent without `resend`. Each gives a named refusal. Sent with `resend` passes.

- [ ] **Step 2: Run to verify it fails**

Run: `deno test "Agent Module/11_Personal_Agent/CEO Agent Module/supabase/proposal-mail-send/rules_test.ts"`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Caller's JWT must pass `hub_proposal_can_send`. Subject and body come from the child `mail` row. The sent mark is written with the service role only after SMTP accepts. Sender `info@abcapital.ae`, password secret from the existing `MAIL_PASSWORD_<ADDRESS>` naming. Logs carry no mail text, recipients or passwords.

- [ ] **Step 4: Run to verify it passes**

Run: the same `deno test`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "Agent Module/11_Personal_Agent/CEO Agent Module/supabase/proposal-mail-send"
git commit -m "Add the proposal mail function, PDF only"
```

### Task 7: Proposal screen

**Files:**
- Create: `Template Module/components/ProposalDesk.jsx`, `Template Module/components/ProposalOption.jsx`, `Template Module/components/ProposalDocuments.jsx`
- Modify: `Template Module/components/ServiceDesk.jsx` (the switch only)

**Interfaces:**
- Consumes: Tasks 2 and 4, existing `ClientPicker`, `flagMissing`, `Panel`, `Button`, `DataTable`, `FormModal`.
- Produces: `<ProposalDesk profile={profile} />`, shown by `ServiceDesk` when department is Business Setup and the switch is on Proposal, the default. Business Setup's own tab uses `department="Business Setup"`, so it gets the switch too.

- [ ] **Step 1: Build `ProposalOption.jsx`**

Fields as the spec's form tables. Sub services add and remove under a service, amount read-only when subs exist. Rows move up and down. Shows AED and USD totals and the set's last-updated date.

- [ ] **Step 2: Build `ProposalDesk.jsx`**

Client panel with only name, contact, email, phone. Options with + Add option. Shared sections with the refill warning from `needsSharedWarning`. Generate button disabled while busy. Blocks with a named message when the set list is empty or the rate is missing.

- [ ] **Step 3: Build `ProposalDocuments.jsx`**

Proposal rows from `listDocuments`: Ref, client, "AED x (Option 1 of n)", date. Actions: **View** (`openStored(storage_path)`), **Word** (`openWord(word_path)`), **OneDrive** state (Saved or Not in OneDrive with Save now), **Mail** (draft panel with Send, showing the recipient in a confirmation, then Resend), **Engagement Letter** (dialog: option radio with totals, the missing letter details, then `createProposalLetter`, then the existing letter render and file flow), Retry when `storage_path` is null. Old-format rows stay in the old list only.

- [ ] **Step 4: Add the switch in `ServiceDesk.jsx`**

Proposal / Old Quotation tabs under the department tabs, for Business Setup only. Old Quotation renders today's form untouched.

- [ ] **Step 5: Verify on the dev server**

Start the `crm` preview from `.claude/launch.json`, adding it if missing. Using `TEST CLIENT - DO NOT USE` and the fake or local path where possible, check the form behaviours: add and remove options and sub services, totals, warnings, field flags. Expected: no console errors. Old Quotation still generates as before.

- [ ] **Step 6: Run all module tests**

Run: `node --test "Template Module/tests/"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add "Template Module/components"
git commit -m "Add the proposal form beside the old quotation form"
```

### Task 8: Authority sets in Settings, and the private seed

**Files:**
- Create: `Template Module/components/ProposalAuthorities.jsx`
- Modify: `Template Module/components/HubNumbering.jsx` (mount it beside `LibrarySettings`, Hub admins only)
- Create outside the repo: `D:\Abhijith Projects\CRM Private\proposal_authorities_seed.sql`, with extracted images in `D:\Abhijith Projects\CRM Private\proposal-assets\`

**Interfaces:**
- Consumes: `loadAuthorities`, `saveAuthority`, `saveDefaults` from Task 4.

- [ ] **Step 1: Build `ProposalAuthorities.jsx`**

List, edit and archive sets. Edit rows, notes and lists. Upload logo and timeline to `hub-documents` under `proposal-assets/`. Also edits USD rate and contact.

- [ ] **Step 2: Write the private seed**

Five sets from the old proposals: IFZA, RAKEZ, SHAMS, DET, Abu Dhabi Mainland. Extract logos and timelines from the Word files; IFZA from its PDF. Group fee rows into services and sub services only where the old rows are plainly a breakup, for example a visa's govt fee and service fee. Abu Dhabi's title is corrected from "Dubai Mainland (DET)". USD is not stored.

- [ ] **Step 3: Check the seed on the local runner**

Run the seed after `008_proposals.sql` on the throwaway cluster. Expected: 5 rows, and each set's service total equals the AED total on its old proposal, read from the private source files, not written here.

- [ ] **Step 4: Confirm nothing private is staged**

Run: `git status --short`
Expected: no seed, asset or old proposal file listed.

- [ ] **Step 5: Commit**

```bash
git add "Template Module/components/ProposalAuthorities.jsx" "Template Module/components/HubNumbering.jsx"
git commit -m "Let admins edit the saved authority sets"
```

### Task 9: Keep other readers correct

**Files:**
- Modify: `Template Module/services/hubApi.js` (`listLibraryDocuments`, `listLetterableQuotes`), `Business Setup Module/components/workspace/Quotes.jsx`, `Integrations Module/supabase/zoho-books/handlers.ts`
- Test: `Template Module/tests/proposalReaders.test.mjs`, `Integrations Module/supabase/zoho-books/handlers.test.ts`

**Interfaces:**
- Produces: `isProposal(doc): boolean`, `isUndecidedProposal(doc): boolean` in `proposalModel.js`.

- [ ] **Step 1: Write failing tests**

- `listLibraryDocuments` and `listLetterableQuotes` leave out `AB Capital/Proposal`, and still return rows whose `library_template` is null where they did before. Filter in JS, so `.neq` does not drop nulls.
- Zoho handler test `refuses undecided proposal`: creating an estimate from a `hub_documents` row with two options and `accepted_option` null gives the error `Choose the accepted option first`. A single-option proposal, a decided proposal and an old quote still create.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test "Template Module/tests/proposalReaders.test.mjs"` and `deno test "Integrations Module/supabase/zoho-books/handlers.test.ts"`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `Quotes.jsx`, for a proposal: hide **Create engagement** and show "Create the letter from Service Documents". Hide `ZohoPanel` while undecided. **Stop and tell the user before this step's `handlers.ts` change:** the spec requires notice when the Zoho flow changes, and it needs a function redeploy.

- [ ] **Step 4: Check the client login**

Run: `git grep -n "word_path" -- "Client Login Module" "Database Module/Client Login Base"` and read how `client_portal_gallery_path` finds generated documents.
Expected: no `word_path`, and any proposal reached through `storage_path` gets a `.pdf` name and type. Fix and test if the name assumes `.docx`.

- [ ] **Step 5: Run tests**

Run the Step 2 commands, then `node --test "Template Module/tests/"`.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "Template Module" "Business Setup Module/components/workspace/Quotes.jsx" "Integrations Module/supabase/zoho-books"
git commit -m "Keep library lists, case quotes and Zoho correct for proposals"
```

### Task 10: Output check

**Files:**
- Modify only what this check shows is wrong in Tasks 3 and 7.

- [ ] **Step 1: Rebuild the 5 old proposals locally**

On the dev server against a non-live path, or through a small test script in the scratchpad using `renderProposal` and `docxToPdf`. Generate each of the 5, then a 2-option, a 3-option and a sub-services quote.

- [ ] **Step 2: Compare by eye with the originals**

Check the Word file and the PDF page by page: logos, border, table colours, indents, notes, timeline, page breaks, a long table across pages. Expected: same kind of document, with differences listed.

- [ ] **Step 3: Report PDF quality**

If `docxToPdf` does not reproduce the tables acceptably, stop and tell the user. Otherwise send the user samples, with test data only, through `SendUserFile`, and wait for their approval of the look.

- [ ] **Step 4: Commit any fixes**

```bash
git add "Template Module"
git commit -m "Match the proposal output to the old proposals"
```

### Task 11: Release (each step needs the user's yes)

- [ ] **Step 1:** Whole-branch review, then merge current `main` into the branch and rerun all tests from Tasks 1 to 9.
- [ ] **Step 2:** Apply `008_proposals.sql` live, read back the columns, table and functions, and save the rollback's location in the report.
- [ ] **Step 3:** Load the private seed live and upload images. Check 5 rows. Set the proposal contact and USD rate in Settings.
- [ ] **Step 4:** Deploy `proposal-mail-send` with JWT on, and redeploy `zoho-books`. Check the mailbox secret exists, by name only.
- [ ] **Step 5:** Merge to `main` and push.
- [ ] **Step 6:** In `Main Module`, run `npm run deploy:cloudflare`, then confirm `abcrm` and `crm-abcapital` serve the new build.
- [ ] **Step 7:** Client Module: the user chooses between moving `D:\Abhijith Projects\CRM` to `main` (first discarding its uncommitted `Client Module/config.json`, which only matches `main`) or running the module from another folder. Restart it and check `/api/proposal-folder` writes to the real OneDrive folder with a test file, then remove that file only.
- [ ] **Step 8:** Signed-in live run with `TEST CLIENT - DO NOT USE`: generate 2 options, View opens the PDF, Word downloads, files in OneDrive, Voucher Register row, letter on Option 2. Record the numbers used, because they take real serials.
- [ ] **Step 9:** One real test mail to an address the user names. Check only the PDF is attached and the sent mark is set.
- [ ] **Step 10:** Update the memory notes: status, numbers used, and what is still open.
