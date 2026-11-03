# Knowledge Module

The CRM's staff **Knowledge** tab: search prices, plans, procedures and client answers, and copy only Shareable content to clients.
Data lives in `Database Module/Knowledge Base` (`knowledge_*` tables, the `knowledge_banking_prices()` function and the `v_knowledge_search` view). Design and plan: `docs/`.

## Layout

| Folder | Holds |
|---|---|
| `components/` | `KnowledgeModule` (shell, search, tabs), `PricingView`, `ServicesView`, `EntriesView`, `ResultCard`, `CopyButton`, `SafeHtml`, and the admin screens `EditForm` and `NeedsReview` |
| `logic/` | Pure rules: copy text, status and expiry, search escaping and grouping |
| `services/knowledgeApi.js` | The only file that talks to Supabase |
| `tests/` | `node --test "Knowledge Module/tests/"` |

## Rules the screens follow

- Copy is offered only on Shareable items (`canCopy`). A Draft item needs the confirm tick, and the tick resets after each successful copy. A failed clipboard write shows an error, never "Copied".
- Copied text never carries `basis`, `confidence`, `payee`, status or the Draft label. Internal lines in a group are left out.
- `basis`, `confidence` and `payee` show to admins only, in `NeedsReview` and `EditForm`.
- Service catalogue rows are read only: no prices and no copy button.
- HTML bodies go through `SafeHtml` (DOMPurify). The `dompurify` dependency is added to `Main Module` with the CRM wiring.
- Dates use Dubai time (`dubaiToday` from `@hr/logic/attendance.js`).
