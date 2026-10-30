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
