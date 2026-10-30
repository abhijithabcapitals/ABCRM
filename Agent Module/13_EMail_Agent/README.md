# Email Agent

Goes through every new email in CRM Email Base (`Database Module/Email Base`) and, for the owner of
each mailbox, creates CRM notifications, calendar entries, follow-up alerts and a daily digest. It
never sends, moves, deletes or flags mail.

| Path | Purpose |
|---|---|
| `supabase/migrations/001_email_agent.sql` | `email_agent` schema, queue functions, Vault secret, RLS, 10-minute cron job |
| `supabase/email-agent/index.ts` | Edge Function `email-agent`: the run, plus `apply` and `status` for the panel |
| `supabase/email-agent/logic.ts` | Pure helpers: body cleaning, rules, model-output validation, calendar decisions, .ics parser |
| `supabase/email-agent/logic_test.ts` | `deno test` cases for `logic.ts` |
| `components/EmailAgentPanel.jsx` | CRM page: Review, Activity, Digests, Rules, Settings |
| `index.js` | Default export of the page (Main Module alias `@email-agent`) |
| `.claude/skills/` | Email skills installed from skills.sh (see CLAUDE.md) |
| `CLAUDE.md`, `ROADMAP.md`, `TEST_PLAN.md` | Agent specification, status, test cases |

## What one run does

Scheduled every 10 minutes (minute 2, 12, 22 …, after the 5-minute mail sync). Up to 30 messages
per run, 4 in parallel, within 110 seconds.

1. **Queue.** `email_agent.pending_messages()` returns inbound messages received after
   `settings.process_since` that are not yet processed. The same Message-ID in several folders is
   processed once. A failing message is retried up to 3 times.
2. **Filter (no AI).** Skips mail sent by the mailbox itself, `ignore` rules, the mailbox's
   `excluded_senders`, and bulk mail (List-Unsubscribe, Precedence: bulk, Auto-Submitted) unless it
   mentions deadlines, payments, meetings, tax, FTA and similar words.
3. **Invites (no AI).** `.ics` attachments are read from Storage and parsed exactly, including
   Outlook's Windows time-zone names. Cancellations become notices.
4. **Classify and extract.** One model call per message (OpenRouter, default
   `deepseek/deepseek-v4.1-flash`, no prompt retention) returns priority, category, action needed,
   phishing risk and items. Every item must quote the email; unsupported items are capped at 50%.
5. **Decide.** An item goes to the calendar when it is a meeting / deadline / payment / task /
   reminder / document request, dated in the future, at or above `min_confidence` (0.75), not from
   a suspected phishing email, and not blocked by a `no_calendar` rule. Otherwise it waits in
   **Review**. Past-dated items are recorded as notices.
6. **Calendar.** Meetings → `ceo.meetings`; deadlines, payments, tasks, document requests →
   `ceo.tasks` plus a reminder the day before; reminders → `ceo.reminders`. They appear in the CEO
   Agent calendar and dashboard. The same item mentioned again later in the thread is not added twice.
7. **Notify.** One `public.notifications` row (type `email_agent`) per message that is urgent/high
   (configurable), from a VIP, matched by `always_notify`, added anything, left suggestions, or looks
   like phishing. The CRM bell shows it in real time.
8. **Tag.** Email Base threads get `phishing-suspect` / `action-required` tags and are marked
   important when urgent or VIP.
9. **Follow-ups.** Conversations whose last message was ours, unanswered for `follow_up_days` (3),
   raise one alert each.
10. **Digest.** Once a day after `digest_hour` (08:00 Dubai): last 24 hours, open suggestions, next
    24 hours of meetings, overdue and due-soon tasks, urgent threads awaiting a reply.

Each run is logged in `email_agent.runs` with counts and errors.

## The page (CRM › Email Agent, admins)

- **Review**: suggestions waiting for a decision. Edit the title or date, then **Add to calendar**,
  or **Dismiss**.
- **Activity**: everything the agent raised, with confidence, source and quoted evidence.
- **Digests**: the last 14 daily digests.
- **Rules**: by sender address, domain or subject text → VIP, always notify, never calendar, ignore.
  Suggested first rules: domain `tax.gov.ae` → VIP, domain `mof.gov.ae` → VIP.
- **Settings**: on/off, automatic calendar, confidence threshold, follow-up days, digest hour,
  priorities that notify.
- **Run now** runs the agent immediately.

The page reads with the signed-in user's session; RLS limits it to the user's own rows. Applying a
suggestion and running go through the Edge Function, which checks that the caller owns a mailbox
and, when `ceo.profiles.require_mfa` is true, has an authenticator-verified (`aal2`) session — sign
in on the CEO Agent tab first.

## Deploy

Not applied yet. From Git Bash, in `Agent Module/11_Personal_Agent/CEO Agent` (linked to the CRM
project `pnnakrhfzyxudjaghoxx`):

```bash
npx --no-install supabase db query --linked --project-ref pnnakrhfzyxudjaghoxx -f "../../13_EMail_Agent/supabase/migrations/001_email_agent.sql"
```

```bash
mkdir -p supabase/functions/email-agent && cp ../../13_EMail_Agent/supabase/email-agent/{index.ts,logic.ts} supabase/functions/email-agent/ && npx --no-install supabase functions deploy email-agent --project-ref pnnakrhfzyxudjaghoxx --no-verify-jwt
```

Secrets: `OPENROUTER_API_KEY` (already set for `ceo-mail-sync`); optional `EMAIL_AGENT_MODEL`.
The migration adds `email_agent` to the Data API's exposed schemas while keeping the existing ones.
The Main Module picks up the page from `@email-agent` on its next build.

## Tests

```bash
deno test "D:/Abhijith Projects/CRM/Agent Module/13_EMail_Agent/supabase/email-agent/logic_test.ts"
```

## Data and privacy

Email text is sent to the OpenRouter model provider for classification (same provider policy as the
mail summaries: `data_collection: deny`). Nothing leaves the CRM otherwise. Bulk mail without action
words, ignored senders and excluded senders are never sent to the model.
