# CEO Intelligence Agent

Private, standalone executive capture and memory workspace. This project uses
its own Supabase project and the `ceo` PostgreSQL schema. It does not share the
CRM database for its private memory. Its `ceo-agent` function can securely read
the CRM Email Base for exactly `info@abcapital.ae` and `bharat@ardentaxit.tax`;
other mailboxes are not exposed to the agent.

## What is built

- Next.js 16, React, and TypeScript responsive app shell.
- Invite-only Supabase password sign-in and TOTP MFA enrollment/challenge.
- Text capture saved directly to PostgreSQL with an idempotency key.
- Per-user row-level security and a private audio bucket with no client access
  policies until retention and cleanup are configured.
- Versioned migration for captures, canonical records, people, organizations,
  CRM references, tasks, decisions/history, meetings, projects/milestones,
  ideas, risks, documents, relationships, reminders/delivery attempts,
  agent registry/permissions, approvals, audit, processing jobs, sync state,
  and an outbox.
- PostgreSQL full-text indexes for captures and canonical record titles and
  summaries.
- Email search and conversation tools backed by the CRM Email Base allowlist;
  email bodies remain in the CRM database and are not copied into this agent's
  database. The agent can only read the two configured addresses.

## Status

| Area | Status |
|---|---|
| Text capture and capture history | Implemented; requires a configured Supabase project |
| Authentication | Password sign-in scaffolded; invite-only user provisioning is manual |
| MFA | TOTP enrollment and challenge implemented; enforcement follows each profile's `require_mfa` setting |
| Database | Initial `ceo` schema migration created; not yet applied to a project |
| Private audio storage | Private bucket created by migration; intentionally no access policies yet |
| Voice transcription/upload | Pending provider, approved retention period, and durable cleanup worker |
| Extraction, entity resolution, retrieval answers | Pending; no model calls are made |
| CRM, OneDrive, notifications, worker, approvals, agent API | Pending configuration and implementation |
| Backup/recovery and production security validation | Pending |

This is a working starter, not a production-ready agent. It never claims that
an AI extraction, transcription, CRM update, reminder, or external action ran.

## Local setup

1. Install Node.js 20.9 or later and npm.
2. In this directory, install dependencies and start the local Supabase stack:

   ```powershell
   npm install
   npx supabase start
   npx supabase db reset
   ```

3. Copy `.env.example` to `.env.local`. Set the local Supabase URL and
   **publishable** key printed by `supabase start`:

   ```text
   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<local publishable key>
   ```

4. Create an owner account in the local Supabase Auth dashboard or CLI, then
   add that user's profile using the SQL in [CONFIGURATION.md](./CONFIGURATION.md).
5. Start the app:

   ```powershell
   npm run dev
   ```

Then open `http://localhost:3000`. New public sign-ups are disabled.

## Commands

```powershell
npm run dev
npm run lint
npm run typecheck
npm run build
npm run test:db
```

## Deploy (Cloudflare Workers)

Deployed with the OpenNext Cloudflare adapter as the `ceo-intelligence-agent`
Worker: https://ceo-intelligence-agent.ceo-intelligence-agent.workers.dev

1. Put the two `NEXT_PUBLIC_*` values in `.env.production.local` (git-ignored).
   They are inlined into the bundle at build time.
2. `npx wrangler login` once, then `npm run deploy`.

Session refresh lives in `middleware.ts` (edge) because OpenNext does not yet
support the Node.js `proxy.ts` that Next 16 introduced.

See [CONFIGURATION.md](./CONFIGURATION.md) for the ordered, one-by-one setup
path for a separate hosted Supabase project, MFA, deployment, and later
integrations, including the narrowly scoped CRM Email Base connection.
