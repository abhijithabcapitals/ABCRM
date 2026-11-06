# Business Development Module

Source of the CRM's **Business Development** tab: BD dashboard, lead pipeline, lead lists, lead calendar,
follow-up centre, campaigns and sources, proposals, and won-lead onboarding handovers. Lead-generation
platform integrations (starting with Explee) are included here.

| Path | Purpose |
|---|---|
| `components/BusinessDevelopment.jsx` | The page and all its sub-tabs. Takes `profile` |
| `components/BusinessDevelopment.css` | Its styles |
| `logic/businessDevelopmentData.js` | Supabase reads, writes and RPC calls for leads, activities, follow-ups, services and won/lost |
| `components/BdCalendarView.jsx` | **Lead Calendar** page: month view and agenda (shared `@calendar` component) of lead follow-ups plus BD calendar items, with an Overdue list |
| `index.js` | Default export of the page, plus the data functions |

## How it is connected

The Main Module imports this folder directly; there is no copy to keep in sync.

- `Main Module/vite.config.js` maps `@business-development` to this folder, and `@app` to `Main Module/src`
  (the data layer uses `@app/supabase`). React and `@supabase/supabase-js` resolve from the Main Module.
- `Main Module/src/components/BusinessDevelopment.jsx` re-exports this page, so `App.jsx` and the sidebar
  entry are unchanged.
- Database: tables, row-level security and RPCs come from `Database Module/migrations/bd` (design notes in
  `Database Module/docs/BD_*.md`). `Main Module/db/business_development.sql` is retired; do not run it.
- The GitHub Pages build checks out the whole repo, so changes here deploy with the next push to `main`.

## Lead workflow

Database: `Database Module/migrations/bd/012_bd_lead_workflow.sql` (run after the Banking, Business Setup and
Accounting base migrations). Rules shared by the screens: `logic/leadRules.js` (tests: `node --test "Business Development Module/tests/"`).

1. **All Leads** lists every lead from every source in one place, tagged by source: pipeline leads plus platform
   prospects (Explee and later platforms) not yet taken. A lead can be created unassigned ("All Leads pool").
2. **Assign to me** takes an unassigned lead (`bd_assign_lead`); it becomes a **Prospect** owned by that person.
   A prospect from a platform opens the New lead form prefilled, owned by you. Managers and team leaders assign
   or reassign anyone from the lead's owner field.
3. Pipeline: **Prospect → Contact → Convinced → Received Documents → Done KYC**. Each lead shows a next-step button;
   stage rules are enforced by `bd_change_stage`.
4. **Send quote & engagement** (`bd_record_quote_sent`): opens the mail in the user's mail app (quotation and
   engagement letter are attached there), then records the references, recipient and a follow-up, and moves the lead
   to **Quote & Engagement Sent**. The CRM does not send this mail itself.
5. **Record receipt & convert** (`bd_convert_lead`): upload the client's payment receipt (stored in `hub-documents`
   under `Business Development/receipts/<lead id>/`), amount, date and reference; tick the services paid for and their
   agreed fees. Each service is routed to a department (suggested: Bank Account Opening → Business Banking; Company
   Formation / Closure → Business Setup; everything else → Accounting), editable before saving, with a lead owner per
   department. The lead becomes **Converted** and the departments receive:
   - Business Banking: a `banking_leads` row (status New, source "Business Development")
   - Business Setup: a `business_setup_cases` row (stage Lead, linked by `bd_handover_id`)
   - Accounting: one `accounting_jobs` row (To Do) per service, at the agreed fee
   Transfers are kept in `bd_department_transfers` and shown on **Converted & Transfers**.
6. **Lead Generation** filters leads by source and shows source analytics (leads, unassigned, in pipeline, converted,
   win rate, converted value, new leads by month), with the platform inbox (sync, replies) below.

Migration 012 maps leads in the ten retired stages: New Lead / Contact Pending → Prospect; First Contact Attempted /
Contact Established → Contact; Requirement Identified / Qualified → Convinced; Proposal / Quotation Preparation →
Done KYC; Proposal Sent / Negotiation / Verbal Confirmation → Quote & Engagement Sent.

## Lead Generation tab (platform integrations)

| Path | Purpose |
|---|---|
| `components/LeadGenerationView.jsx` | **Lead Generation** sub-tab: platform connection cards, sync, prospect review queue |
| `supabase/bd-lead-sources/index.ts` | Edge Function `bd-lead-sources` (platform sync, mailbox conversations, reply drafting and confirmed send) |
| `Database Module/migrations/bd/005_bd_lead_platforms.sql` | `bd_platform_connections`, `bd_platform_prospects`, the `EXPLEE` lead source |
| `Database Module/migrations/bd/007_bd_reply_drafts.sql` | Legacy draft table, migrated into Email Base |
| `Database Module/Email Base/migrations/004_business_development_drafts.sql` | Persistent Business Development drafts in the shared Email Base |
| `Database Module/migrations/bd/008_bd_reply_send_confirmation.sql` | One-time, short-lived human confirmation codes for sending |
| `Database Module/migrations/bd/009_bd_reply_queue_status.sql` | Dedicated drafted and replied queue tabs |

Flow: **Sync now** pulls prospects into `bd_platform_prospects` (status `new`). A person reviews them and
clicks **Add to pipeline**, which opens the normal New lead form prefilled (source Explee, campaign,
contact details, why the lead is hot). Saving goes through `bd_create_lead`, so duplicate checks, ownership and
follow-up rules apply, and the prospect is marked `added` with the new lead's id. **Dismiss** hides a prospect;
**Restore** brings it back. Nothing is created in the pipeline automatically.

### Explee

- API: `https://api.explee.com/public/api/v1`, header `X-API-Key`. Docs: https://api.explee.com/public/api/docs
- Secret: `EXPLEE_API_KEY` (Supabase → Edge Functions → Secrets). Never in the browser or Git.
- Project: `settings.project_id` on the `explee` connection (preset to 38083, the id in the app URL
  `explee.com/app-auto-gtm/p/38083`). BD managers can change it on the card.
- Sync pulls **hot leads** (`GET /autogtm/hot-leads`, incremental from the newest `became_hot_at`) and,
  when ticked, **everyone the campaigns emailed** (`GET /autogtm/campaigns/{id}/leads`, up to 1,000 per
  campaign; needs an Explee plan with lead export). Hot leads overwrite their row's details; contacted rows never
  overwrite existing ones.
- Only BD managers can update the connection row, so a sync run by a sales executive still imports prospects but
  does not record the sync time; the next sync re-reads the same window (imports are idempotent).
- Explee charges nothing for reading these lists, but every API call needs a positive credit balance.

### Email conversations and replies

- **Read more** opens the full Explee conversation in a left-side mailbox pane with a Gmail-style reply composer.
- Personal drafts are stored in `email_base.bd_reply_drafts`, alongside the shared CRM Email Base. Saving a reply moves its prospect from **To review** to **Drafted replies**; reopening the conversation loads the saved text. **Discard draft** marks the saved reply as discarded and moves the prospect back to **To review**. After sending, it appears under **Replied**. Saving or redrafting never sends a message.
- **Redraft with AI** opens an overlay. Only after the user presses its redraft button are the saved reply and recent conversation sent to OpenRouter. Configure `OPENROUTER_API_KEY` as a secret on the CRM Supabase `bd-lead-sources` Edge Function; optionally set `OPENROUTER_MODEL`.
- **Send** first saves the current reply, then opens a confirmation popup showing the recipient and a six-digit code. The user must enter that code and explicitly press **Send reply**. The server verifies the single-use code, which expires after five minutes and allows at most five incorrect attempts, before calling Explee. Sending is never triggered by opening a conversation, writing, saving, or redrafting.
- **Read more** on a conversation with no saved draft asks Explee for its reply, as pressing Reply in Explee does, and shows it in the composer with the chosen signature replacing Explee's sign-off. It is not saved or sent until the user does so.
- **Sync now** copies Explee's own suggested replies (up to 10 per sync) for `need_reply` conversations into **Drafted replies**, for prospects still in To review. The source is Explee's web-app route `POST explee.com/api/app-auto-gtm/segments/{campaign}/outreach/auto-reply/{person}`, which is not in its public API. If it rejects the key, the sync still succeeds and shows the error.
- Explee replies are plain text. The chosen signature's logo is uploaded to Explee and sent as an attached image; it cannot appear inside the signature. The confirmation code covers the logo, and if the upload fails nothing is sent. Only logos in the `email-signatures` bucket are sent.
- Apply BD migrations `005_bd_lead_platforms.sql` and `007_bd_reply_drafts.sql`, then Email Base migration `004_business_development_drafts.sql`, then BD migrations `008_bd_reply_send_confirmation.sql` and `009_bd_reply_queue_status.sql`, before deploying the updated `bd-lead-sources` function. Migration 004 moves any existing drafts from the legacy public draft table into Email Base.

### Adding another platform

Add a `bd_platform_connections` row and a provider branch in `bd-lead-sources` that maps the platform's
records to `bd_platform_prospects` columns, keep the key in an Edge Function secret, and add a card to
`LeadGenerationView`.

## Lead Calendar

The **Lead Calendar** page shows a month view with an agenda for the next 30 days (UAE time). It combines:

- **Follow-ups** of open leads (from `bd_ui_leads`). Clicking one opens the lead; overdue ones can be completed from
  the Overdue list.
- **Calendar items** in `public.bd_calendar_items` (`Database Module/migrations/bd/010_bd_calendar_items.sql`):
  deadlines, meetings (with an end time), tasks, conversion targets and reminders. Each can be linked to a lead,
  assigned to a person, timed or all-day, and marked done or cancelled. **＋ New calendar item** adds one; clicking
  an item edits it. Open items past their date appear under **Overdue** with a **Done** button. **Only mine** limits
  the view to items assigned to or created by you and follow-ups of your leads.

Row-level security: anyone with a BD role sees general items and items of leads they can see. Super admins, BD
managers, team leaders, sales executives and marketing executives create items; managers and team leaders change any
item, executives change the items they created or are assigned and delete the ones they created.

## BD Agent (right-side panel)

The **BD Agent** panel sits to the right of every Business Development page (closed, it leaves a "BD Agent" tab on
the right edge). It advises and drafts only: it never writes to the CRM, sends messages or makes commercial commitments.
With a lead open, the agent reads that lead (record, services, discussions, open follow-ups) through `bd_ui_leads`
with the user's own access, plus its recent emails from Email Base (`email_base.messages`, matched by the lead's address
and business domain). Questions about leads in general ("rank my leads", "who is hot") get the open pipeline (80 rows), the
Lead Generation queue (60 newest prospects) and each one's latest inbound email date. Email Base row-level security applies:
a person sees mail only from mailboxes they own. The top of the panel holds a mini calendar of follow-ups and BD calendar items.

| Path | Purpose |
|---|---|
| `components/BdAgentPanel.jsx` | The panel: quick prompts, skill picker (automatic by default), chat, copyable drafts |
| `supabase/bd-agent/index.ts` | Edge Function `bd-agent` (`skills`, `chat`). Needs a BD role (`bd_current_role()`); OpenRouter via `OPENROUTER_API_KEY`, optional `OPENROUTER_MODEL` |
| `supabase/bd-agent/skills.ts` | Generated bundle of the agent spec and the 64 skills in `Agent Module/05_Business_Development_Agent/.claude/skills` |
| `scripts/build-bd-agent-skills.mjs` | Regenerates `skills.ts`; run after `npx skills update` in the agent folder |

Deploy (Git Bash, from `Database Module/tools`, linked to `pnnakrhfzyxudjaghoxx`):

```bash
node "../../Business Development Module/scripts/build-bd-agent-skills.mjs" && mkdir -p supabase/functions/bd-agent && cp "../../Business Development Module/supabase/bd-agent/"{index.ts,skills.ts} supabase/functions/bd-agent/ && npx --no-install supabase functions deploy bd-agent --project-ref pnnakrhfzyxudjaghoxx
```
