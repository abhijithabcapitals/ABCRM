# Testing report: Messenger, Phase 1 and 2

Date of run: 2026-11-04, on branch `messenger-module`, from the worktree root. Results below are from this machine only.
**Nothing was run against the live database, the deployed function, Microsoft or the tenant. No feature is reported as working.** A feature counts as working only after `Messenger Module/tests/browser-check.md` passes on the real tenant.

## Automated results

| Command | Result |
|---|---|
| `node --test "Messenger Module/tests/"` | 37 tests, 37 passed, 0 failed (final-review fixes added: link encoding, admin-users tab, lead page label, Remove message, bk-list, App.jsx view and `q.toString()`) |
| `node --test "Integrations Module/tests/"` | 4 tests, 4 passed, 0 failed |
| `deno test --allow-env "Messenger Module/supabase/ms365/"` | 99 passed, 0 failed (auth, Graph client, handlers) |
| `bash "Database Module/Messanger Base/tests/run-local.sh"` | Both migrations twice, both access test files, both rollbacks, all passed (new: login delete keeps chat, token guard, token removed with link and login), on a throwaway local Postgres with a stub for `profiles` and `admin_is()` |
| `npm --prefix "Main Module" run build` | Built. Only the existing chunk-size warning |

What these cover: deep link and message text, staff list, the sentences shown after the Microsoft return (`connectionMessage`, `connectionLine`, `secretExpiryNote`), the static rules (no token words or message-reading scopes in browser code; Settings and Logs inside the lazy module; Logs admin only), sign-in state and PKCE, Graph refresh and 429 handling, every `ms365` action and the callback, and row security on the Messenger tables against the stub.

## Final-review fixes (2026-11-04)
Fixed in the repo only: `messenger` added to `TABS` in `Main Module/db/edge-function-admin-users.ts` (redeploy is a separate live step, NOT RUN); deployment order changed so migration 001 runs before the merge; Teams panel shows a plain sentence when saved chats cannot load; `created_by` now `on delete set null`; lead pages send no prospect name; deep link uses `%20` and literal commas; staff picker and inputs styled by `messenger.css`; Remove reports a refused delete; `view` is saved to `abc_view`; `q.toString()` replaces `q.size`; `entra-setup.md` says GUID only; token removed from Vault when a link or login is deleted; `ms_token_set` refuses an empty token; Chats tab says chats are not saved. No screen was opened in a browser; all browser and live checks stay NOT RUN.

## Not run

| Check | Status |
|---|---|
| `index.ts` routing (GET callback without a JWT, POST with a JWT, 405 and 401 answers) | NOT RUN: no automated test exists; in `browser-check.md` Phase 2 |
| Settings, Logs and Overview screens in a browser (none opened) | NOT RUN |
| Return from Microsoft: banner, address cleanup, back button | NOT RUN |
| Database size limit and its effect on writes | NOT RUN (deployment check A) |
| Live `profiles` update policies | NOT RUN (deployment check B) |
| `ms_token_set` / `ms_token_get` and Vault encryption | NOT RUN (deployment check C) |
| Real `client_master`, `bd_leads`, `tasks` row security and the real `admin_is()` against the stub | NOT RUN (deployment check D) |
| Migrations `001` and `002` on the live database | NOT RUN |
| Deploy of `ms365` with `--no-verify-jwt` | NOT RUN |
| Entra app registration, consent, redirect URI | NOT RUN |
| Admin connect, member connect, wrong tenant, email mismatch, self-accept, sign in again, disconnect, revoke in Entra | NOT RUN |
| No token in browser storage or network responses (live) | NOT RUN |
| Phase 1 steps in `browser-check.md` (Teams desktop, pop-up block, install on Edge and Chrome) | NOT RUN |
| Graph permission names | PARTLY CHECKED against the reference page text; see `entra-setup.md` for what was and was not confirmed |

## Known limits found while writing

- An admin can accept their own review link; the function does not forbid it.
- `TeamsActivity.Send.User` was not found by name on Microsoft's permissions reference (Phase 5 only).
- Screens use the shared Banking components and are checked only through the build, not rendered in a test.
