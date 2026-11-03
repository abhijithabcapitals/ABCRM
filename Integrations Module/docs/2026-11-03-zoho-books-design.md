# Zoho Books connection: design

Date: 2026-11-03. Status: awaiting user review. Nothing here is built.

## 1. Purpose

Staff should not retype quotes and invoices into Zoho Books. The CRM creates a draft copy in Zoho, staff check and send it there, and the CRM reads the result back.

The user's rule: **do not change anything in Zoho. Read and write only, specifically restricted.**

Done means:

- A staff member creates a draft estimate or invoice in Zoho from a CRM quote with one button.
- The CRM cannot change or delete anything that already exists in Zoho, even if its code has a bug.
- A client sees an invoice in Client Login only after staff have sent it from Zoho.
- If Zoho is down or not connected, staff can still send work to Accounts.

## 2. Decisions

| Decision | Choice | Source |
|---|---|---|
| Zoho product | Zoho Books, one organisation | Assumed. Confirm in section 13 |
| Scope | Quotes and invoices, read back status | User, 2026-11-03 |
| Access rule | Read plus create drafts. No update, no delete | User, 2026-11-03 |
| Where quotes are generated | In the CRM, using the current templates. Zoho gets a draft copy | User approved the rule that says so, 2026-11-03 |
| Who sends to clients | Staff, from Zoho. The CRM never sends | Same |
| Missing Zoho contact | CRM stops and asks staff to add it in Zoho | Same |

## 3. Access limits

There are three locks. Each works without the others.

**Lock 1: the Zoho token.** It holds only these scopes:

```
ZohoBooks.invoices.READ
ZohoBooks.invoices.CREATE
ZohoBooks.estimates.READ
ZohoBooks.estimates.CREATE
ZohoBooks.contacts.READ
ZohoBooks.settings.READ
```

No `UPDATE`, `DELETE` or `ALL` scope is requested. `settings.READ` is needed to look up items and VAT codes.

This drops `ZohoBooks.customerpayments.READ` from the list shown to the user earlier. The invoice's own status and balance give the CRM what it needs, so the extra scope has no use in this version.

**Lock 2: the Zoho user.** Generate the token while logged in as a limited Zoho user if the plan allows it, so the token can never exceed that user's role.

**Lock 3: the Edge Function allowlist.** The function calls only these, and refuses anything else before a request leaves the server:

| Method | Path | Use |
|---|---|---|
| GET | `/organizations` | Connection test |
| GET | `/contacts`, `/contacts/{id}` | Match a client |
| GET | `/items` | Only if lines turn out to need an item, see section 8 |
| GET | `/settings/taxes` | Find the VAT code |
| GET | `/estimates`, `/estimates/{id}` | Duplicate check, status |
| GET | `/invoices`, `/invoices/{id}` | Duplicate check, status |
| POST | `/estimates` | Create a draft. `send` is always `false` |
| POST | `/invoices` | Create a draft. `send` is always `false` |

The browser never chooses the path. It sends a named action, and the function builds the request itself.

## 4. What the restriction costs

- A wrong draft cannot be fixed or removed from the CRM. Staff correct or delete it in Zoho.
- The CRM cannot mark an estimate as accepted or invoiced in Zoho. The invoice draft quotes the estimate number, and staff update the estimate there.
- The CRM does not create contacts, items or tax codes.
- Zoho assigns the document number. The CRM's number goes in `reference_number`.

## 5. Parts

| Part | Where | Job |
|---|---|---|
| `zoho-books` Edge Function | `Integrations Module/supabase/zoho-books/index.ts` | The only code that talks to Zoho. Holds the allowlist and the token refresh |
| `mapping.ts` | Next to `index.ts` | Pure functions turning a CRM quote into a Zoho request body. Tested without a network |
| Migration | `Database Module/Admin Base/migrations/` | The tables in section 6 |
| `ZohoPanel.jsx` | `Integrations Module/components/` | Button and status, shared by both departments |
| Contact picker | In `ZohoPanel.jsx` | Search Zoho contacts and link one to a client |
| Settings row | `registry.json` | Add `ZOHO_DC`, set status to `in_use`, fill in `usedBy` |

`ZohoPanel` replaces `ZohoInvoicePanel` in `Business Setup Module/components/workspace/Quotes.jsx` and `Banking Module/components/BankProcess.jsx`. It never disables Send to Accounts.

## 6. Data

Both tables have row level security. Only the Edge Function writes to them. Both get the audit trail trigger from `Admin Base/migrations/003_audit_trail.sql` if that table is live.

**`zoho_contact_links`**

| Column | Notes |
|---|---|
| `client_id` | Primary key. References `client_master` |
| `zoho_contact_id`, `zoho_contact_name` | Chosen by staff |
| `linked_by`, `linked_at` | Who confirmed the match |

**`zoho_documents`**

| Column | Notes |
|---|---|
| `id` | Primary key |
| `department` | `Business Setup` or `Banking` |
| `source_table`, `source_id` | `hub_documents` or `banking_quotations`, and the row |
| `kind` | `estimate` or `invoice` |
| `reference` | The CRM quote number, sent as `reference_number` |
| `state` | `creating`, `created`, `failed`, `unknown`, or `gone` |
| `crm_total` | The CRM total at creation, for the total check |
| `zoho_id`, `zoho_number` | Set after creation |
| `zoho_status`, `total`, `balance`, `last_read_at` | From read-back |
| `error` | Plain-language message. Never a token |
| `created_by`, `created_at` | Who pressed the button |

A unique index on `(source_table, source_id, kind)` allows one Zoho draft per quote and kind. A revised quote is a new row in `hub_documents`, so it gets its own draft, and the panel warns that the earlier draft still exists in Zoho.

`business_setup_invoices` already feeds Client Login. A row is added there only once Zoho reports an invoice as sent, unpaid, partially paid, overdue or paid. Any other status stays hidden, which keeps drafts away from clients. If an invoice is later voided or removed in Zoho, the row is removed. A Banking invoice gets a row with `quote_id` empty.

If Zoho says a document no longer exists, its row becomes `gone` and staff can create a new draft.

`file_path` stays empty in this version, so clients see the number, date and amount with no PDF.

## 7. Flows

**Connect (once).** An admin saves the credentials in Settings, then presses Test. The function calls `GET /organizations` and confirms the saved organisation is in the reply.

**Link a client (once per client).**
1. The panel shows that this client has no Zoho contact.
2. Staff search Zoho by name, and compare the TRN where Zoho returns one.
3. Staff pick one, and the link is saved. Nothing is matched automatically, because a wrong contact would put an invoice under the wrong company.
4. If nothing matches, the panel says to add the contact in Zoho and search again.

A Banking client with no `client_master_id` cannot be linked. The panel says so. A Zoho contact whose currency is not AED cannot be linked either, because CRM amounts are in AED.

**Create a draft.**
1. The function checks the user's permission, the client link and the unique index.
2. It writes the `zoho_documents` row as `creating`.
3. It searches Zoho for that `reference_number`, so a repeat can never make a second copy.
4. It sends the POST with `send=false`.
5. It saves the Zoho ID and number and sets `created`.
6. The panel shows the number and an Open in Zoho link.

**Read back.** The panel reads status and balance when it opens and when staff press Refresh, at most once per 15 minutes per document unless Refresh is pressed. There is no background job in this version, so a sent invoice reaches Client Login after staff next open the panel.

## 8. Mapping

| Zoho field | Business Setup (`hub_documents`) | Banking (`banking_quotations`) |
|---|---|---|
| `customer_id` | Link for `client_id` | Link for `banking_clients.client_master_id` |
| `reference_number` | `document_number` | `quotation_number` |
| `date` | Today, Asia/Dubai | Today, Asia/Dubai |
| Line items | Each entry in `lines`: `service_name` or `description`, and `amount` | One line each for bank fee, service fee and supplementary totals, less `discount_total` |
| VAT | `vat_mode`, `vat_rate` | `vat_mode`, `vat_rate` |

- **Totals must match.** The function compares Zoho's returned total to the CRM total. On a difference it marks the row and warns staff, since it cannot edit the draft.
- **VAT.** `inclusive` and `exclusive` map to Zoho's tax-inclusive flag. `none` sends no tax code. An admin picks the 5% VAT code once in Settings, from `GET /settings/taxes`, and it is saved as `ZOHO_VAT_TAX_ID`. How to treat bank fees that carry no VAT is an accounting question, listed in section 13.
- **Items.** Lines go across as free text at first. Before the build, confirm in Zoho's API docs and on a test draft that lines without an `item_id` are accepted and post to the right income account. If not, the admin maps services to Zoho items using `GET /items`.
- **Field names.** Check the tax-inclusive flag and line item field names against Zoho's estimate and invoice docs when writing `mapping.ts`.

## 9. Who can press what

| Action | Permission |
|---|---|
| Save credentials, Test, pick VAT code | CRM admin, as in Settings today |
| Link a contact, create an estimate, Business Setup | `setup.quotes.manage` |
| Create an invoice, Business Setup | `setup.services.manage` |
| Link a contact, create either, Banking | `cases.manage` |
| See status | Anyone who can open the quote |

The function checks these on the server using the caller's login.

## 10. Failures

| Case | Behaviour |
|---|---|
| Zoho not connected | Panel shows the current notice. Send to Accounts still works |
| Refresh token revoked or rejected | "Zoho access has stopped. An admin must reconnect." Logged |
| Validation error from Zoho | Row goes to `failed` with Zoho's message. Staff can retry |
| Timeout after the POST | Row goes to `unknown`. Retry searches by `reference_number` first and adopts a match, so nothing is doubled |
| 429 rate limit | "Zoho is busy, try again shortly." No automatic retry. Limits are 100 requests a minute per organisation, and a daily cap by plan (2,000 on Standard) |
| Token or secret in an error | Scrubbed before logging or saving |

## 11. Credentials

Saved in Settings > Integrations, in Vault, read with `requireSecret`: `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_BOOKS_ORG_ID`, and a new `ZOHO_DC`.

`ZOHO_DC` is the data centre domain, such as `ae` or `com`. Zoho runs separate servers, so a `books.zoho.ae` login uses `accounts.zoho.ae` and `www.zohoapis.ae`. Access tokens last an hour. The function caches one in memory and refreshes it when needed, and never stores or returns it.

## 12. Testing

- **Unit:** `mapping.ts` for each VAT mode, discounts, and totals. The allowlist refuses any PUT, DELETE, unknown path, or `send=true`.
- **Token check:** with the real token, try one harmless `PUT` on a test draft and expect Zoho to refuse it. This proves Lock 1. It needs the user's approval, since it targets their live organisation.
- **Read-only test:** contacts, taxes and items on the real organisation. Changes nothing.
- **Write test:** one estimate and one invoice for one client the user names. Confirm both arrive as unsent drafts. The user checks them in Zoho and removes them.
- **Client Login:** a draft shows nothing to the client. After it is sent and refreshed, it appears.

## 13. Open questions

These need the user. Defaults apply unless changed.

| Question | Default |
|---|---|
| Is it Zoho Books, and on which domain? | Zoho Books. Domain read from the login address |
| One Zoho organisation or several for AB Capital companies? | One. More would need a department-to-organisation setting |
| Should invoices be raised at completion or on acceptance? | At completion, where the panel sits today |
| VAT on Banking bank fees | Accounts decides. Default is the quotation's `vat_mode` on all lines |
| Do Accounts agree to review drafts in Zoho? | Yes |

## 14. Order and dependencies

1. Connection: function, allowlist, tables, Test button, contact link. Can ship from `main` now.
2. Banking and Business Setup drafts. Both need branch `business-setup-module` merged first: `ZohoInvoicePanel` in both departments and `business_setup_invoices` all live on that branch.
3. Read-back and Client Login.

Going live needs separate approval at each step.

## 15. Not in this version

Changing or deleting anything in Zoho, sending from the CRM, creating contacts or items, payment records and reconciliation, credit notes, PDF copies, background sync, webhooks, Zoho CRM, Mail or Sign, and importing past Zoho records.
