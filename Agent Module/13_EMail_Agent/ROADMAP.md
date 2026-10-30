# Email Agent Roadmap

## Phase 0: Specification
- [x] Mission, boundaries and approval list in CLAUDE.md
- [x] Owned tables (`email_agent` schema) and owner-scoped writes defined
- [ ] Add row to permission matrix (`..\00_Shared_Standards\PERMISSIONS.md`)

## Phase 1: Build
- [x] Migration: schema, queue functions, Vault secret, RLS, cron job
- [x] Edge Function `email-agent`: filter, .ics parsing, classification, calendar, notifications, follow-ups, digest
- [x] Unit tests for pure logic (`logic_test.ts`)
- [x] CRM page (Review, Activity, Digests, Rules, Settings) wired into Main Module
- [x] Email skills installed from skills.sh

## Phase 2: Deploy (test with real mail, review on)
- [ ] Apply `001_email_agent.sql` to the CRM project
- [ ] Deploy `email-agent`
- [ ] First week: set `auto_calendar = false` and review every suggestion
- [ ] Run TEST_PLAN.md cases on real mail and record results
- [ ] Add VIP rules (FTA, MoF, key clients)

## Phase 3: Tune
- [ ] Adjust `min_confidence` from review outcomes (applied vs dismissed)
- [ ] Notification click opens the Email Agent page / thread (Notifications.jsx handles `link_scope.module`)
- [ ] Reminder delivery worker for `ceo.reminders` (in-app reminders are stored, not yet pushed)

## Phase 4: Handoffs
- [ ] FTA / MoF deadlines → Tax Agent filing calendar
- [ ] Client issues → Support Agent tickets
- [ ] Phishing-suspect messages → Security Agent
