# Knowledge browser check

Date: 2026-11-03. Build: branch `knowledge-module` at `edcf22d`, run from the local dev server.

## Test target

A local fake Supabase on `127.0.0.1` with invented rows. No Supabase project was contacted. The browser's only other host was Google Fonts.

**Not covered here:** real login and real database rules. The fake backend imitates the access rules and the approval trigger, so its results prove the screens only. The real rules are covered by `Database Module/Knowledge Base/tests/run-local.sh`, and real login by the deployed check in rollout.

## Results

| Action | Expected | Result |
|---|---|---|
| Member with tab searches `a%b` and `100,` | Literal match, no error | Pass, "No results" with no error |
| Member with tab searches a normal word | Matching rows | Pass |
| Member searches an Internal item | Not found | Pass |
| Member views Pricing | Draft warning; no Internal line, `basis` or `confidence` | Pass |
| Copy a Draft line | Tick needed; no "Draft" in text; ends with VAT sentence; tick resets | Pass |
| Copy a mixed group | Internal line left out | Pass |
| Past `valid_until` | Warning and "Out of date" badge; today's date still valid | Pass |
| Article with table | Copied rows stay readable | Pass |
| Article with script and `onerror` | Removed on display, nothing runs | Pass |
| Banking read fails | "Banking prices could not load"; other prices still show | Pass |
| Search fails | Error shown, not "no results" | Pass |
| Admin views a group with only Internal lines | Draft and Internal badges, Draft warning, no copy button | Pass |
| Admin approves a line in Needs review | Approved, count falls by one, `basis` and payee shown | Pass |
| Admin edits the amount on that line | Back to Draft, form closes | Pass |
| Member without the tab | Redirected away, tab not in sidebar | Pass, lands on HR |
| Page width 375px | No sideways page scroll | Pass for scroll, see below |

Console errors were only those expected from the fake backend: the injected 500 responses and the missing realtime socket.

## Found

- **On-screen amounts:** `1250.50` shows as `AED 1,250.5` in the price table. Copied text correctly says `AED 1,250.50`.
- **Phone width:** the page doesn't scroll sideways, but the CRM's fixed sidebar takes most of a 375px screen and leaves the tab cramped. This comes from `Main Module` and affects every tab, so it isn't specific to Knowledge.
