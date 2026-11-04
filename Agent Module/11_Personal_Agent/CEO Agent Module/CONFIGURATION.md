# Configuration and integration sequence

The code is staged for configuration one decision at a time. Keep this
Supabase project separate from the CRM project. The only configured CRM data
access is a read-only Edge Function integration to the two approved mailboxes
in CRM Email Base; mail is not copied into this agent's database.

## Before connecting real data

1. **Approve project location and data handling.** Choose the Supabase region
   only after reviewing UAE residency, contractual, and client-confidentiality
   requirements. Do not choose a region by assumption.
2. **Create separate environments.** Create development first; create
   production only after the security, retention, recovery, and deployment
   decisions are approved.
3. **Configure Auth.** Keep public sign-up disabled, provision the owner by
   invitation, set allowed redirect URLs, and enable TOTP MFA. Set the
   project's minimum Auth assurance level to `aal2` before production.
4. **Apply the database migration.** Run it against local Supabase first. Review
   `supabase/migrations/202610290001_initial_ceo_schema.sql`, then link the
   dedicated hosted project and apply it with `npx supabase db push`.
5. **Provision the owner profile.** Create the Auth user in the Supabase
   dashboard. Copy that Auth user's UUID and run this in the SQL editor:

   ```sql
   insert into ceo.profiles (user_id, display_name, role, timezone, require_mfa)
   values ('<AUTH_USER_UUID>', '<DISPLAY_NAME>', 'owner', 'Asia/Dubai', true);
   ```

   The profile table has no browser insert/update grant. Provision additional
   users only through an administrator-controlled process.
6. **Set application environment.** Copy `.env.example` to `.env.local` for
   local development. For deployment, configure the same two variables in the
   hosting provider's secret/environment settings:

   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

   The publishable key is intended for the browser and is constrained by RLS.
   Never add a Supabase secret/service-role key to `NEXT_PUBLIC_*`, a browser
   bundle, source control, prompts, or logs.
7. **Connect the shared Email Base.** First apply the CRM migrations in order:
   `Database Module/Email Base/migrations/001_email_base.sql`,
   `002_full_message_history.sql`, and `003_body_search.sql`. Expose the
   `email_base` schema through the CRM Supabase Data API. Then set these secrets
   on the standalone Agent project's `ceo-agent` Edge Function:

   - `EMAIL_BASE_SUPABASE_URL`: the CRM Supabase project URL
   - `EMAIL_BASE_SUPABASE_SERVICE_ROLE_KEY`: the CRM project's service-role
     key, stored only as an Edge Function secret

   The function's server-side allowlist is fixed to `info@abcapital.ae` and
   `bharat@ardentaxit.tax`; it does not search or return any other mailbox.
   Email tools are restricted to the provisioned `owner` profile.
   The service-role key is never sent to the browser or the model. The email
   content returned by the tools is provided to OpenRouter for the CEO's
   requested analysis, so confirm that this processing is approved for the
   mailbox data. The separate `ceo-mail-sync` function in the CRM project
   remains responsible for importing mail and must also be deployed there.
8. **Verify security before real captures.** Run the database tests, verify
   cross-user denial, confirm that anonymous users have no `ceo` table grants,
   verify the private bucket is inaccessible, and test MFA enrollment and
   sign-in. Enable backups/PITR and perform a restore test before production.

## Configuration still required before voice upload

The `ceo-captures` bucket is private. The migration deliberately creates **no
Storage access policies**, so the browser cannot upload or read audio. Browser
recording is local to the current page; it is not persisted. Before enabling
uploads, decide and document the audio retention period, then implement a
durable cleanup worker, least-privilege Storage policies tied to authenticated
ownership, and deletion/audit tests. Do not just add an upload policy.

## Later integrations (not enabled)

Configure these only after the core project and security model are approved:

1. Durable worker/queue for transcription, extraction, retries, and cleanup.
2. Speech providers, structured output validation, and prompt-injection tests.
3. CRM adapter after documenting the existing CRM's supported API, canonical
   IDs, allowed reads/writes, and conflict/approval behavior.
4. OneDrive using an approved Microsoft Graph app and least-privilege site
   permissions.
5. Durable reminder scheduling and a real delivery provider.
6. Specialist-agent registry/API, rate limits, approval checks, and audit trail.
7. Versioned authenticated APIs and OpenAPI contracts for features as they are
   implemented.

Future agent access must go through a trusted, authenticated server/worker
which checks the registry and narrowly scoped permissions. Agent rows default
to disabled. Never expose a service-role credential to the model or browser;
the email Edge Function holds it server-side and only issues fixed queries
against the two-mailbox allowlist.

## Validation checklist

- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm run test:db` against local Supabase
- Test unauthenticated, owner, and different-user access separately
- Confirm TOTP is required for profiles with `require_mfa = true`
- Confirm no audio object policy exists before retention/worker setup
- Confirm there are no CRM writes, OneDrive, or notification side effects;
  verify email reads stay within the two-mailbox allowlist
