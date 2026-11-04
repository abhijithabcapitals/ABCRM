# Business Setup Restructure: Brief

Date: 2026-11-04. Status: the user accepted the recommendations in section 9. The design is now in `2026-11-04-business-setup-restructure-design.md`, which corrects this brief where they differ.

This restates the user's request as a structured brief. Once the decisions in section 9 are settled, it becomes the design spec. That spec would replace the flow in `2026-11-03-business-setup-module-design.md`.

## 1. Goal

Run every Business Setup client through one visible pipeline, from lead to Accounts. Each person can see what is waiting, who owns it, how far each service has progressed, and how much the client still owes.

## 2. How the request was read

The request was dictated, so some words were read as follows. Please correct any that are wrong.

| Words in the request | Read as |
|---|---|
| "code", "code generation" | Quote, quote generation |
| "recipe poster" | Receipt voucher |
| "the client will issue a receipt voucher" | The team issues the voucher when the client pays |

## 3. The pipeline

| # | Stage | Who | What happens | Moves on when |
|---|---|---|---|---|
| 1 | Lead | Team, Business Development | Team enters its own lead, or Business Development transfers one. It appears in the Leads tab | A team member takes it or is assigned it |
| 2 | Contact | Lead owner | Team contacts the lead and shares the link for details and documents | Client submits |
| 3 | Review | Team | Team reviews the documents and completes all fields | Review is complete |
| 4 | Services and scope | Team | Team selects services, such as company registration, renewal or visa, and the scope of work | At least one service is selected |
| 5 | Quote | Team | Team prices each service, adds 5% VAT and generates the quote | Quote is issued |
| 6 | Client signs | Client | Client receives the quote and login details, then downloads, signs and uploads the quote | Signed quote is uploaded |
| 7 | Payment | Team | Team records full or part payment against the quote amount and issues a receipt voucher. This can happen before or after the quote is issued | Payment is recorded |
| 8 | Engagement letter | Team | Team sends the letter after payment is received | Letter is sent |
| 9 | Invoice | Team | Team issues the invoice through Zoho | Invoice is recorded |
| 10 | Assignment | Manager or team | Manager assigns the client, or a team member takes them | Case has an owner |
| 11 | Service work | Case owner | Owner updates the checkpoints of each service | All checkpoints are done |
| 12 | Accounts | Team, then Accounts | Team sends the completed service to the accounting department | Accounts closes it |

Stages 5 to 9 are the documentation work and get their own tab.

## 4. Rules

**Ownership**
- Any team member can take a lead from the Leads tab.
- Reassigning to another team member needs approval from the division manager.

**Pricing**
- The employee enters a fee for each service.
- If the database holds an amount for that service, it shows as a grey placeholder inside the cell.
- If the database holds no amount, the cell is blank and the employee types the fee.
- VAT of 5% is added on top of the entered price.

**Payments**
- A receipt voucher is issued whenever payment is received.
- Each payment is recorded as full or part against the quote amount.
- The engagement letter follows payment.

**Checkpoints**
- Each service has its own checkpoints. The lists will be supplied during development.
- Company registration: Document collection, Registration pending for approval, Approval, Issue of the license, Completed.
- The user updates checkpoints per client, which shows progress per case and per service.

## 5. Dashboard

Each figure opens the list behind it. The definitions are proposed and need confirming.

| Requested figure | Proposed definition |
|---|---|
| Processes pending | Services not yet Completed or Cancelled |
| Receivables from clients | Signed quote totals including VAT, less net payments |
| Cases completed | Cases with every service Completed or Cancelled |
| Cases in the pipeline | Open cases, split by stage in section 3 |
| Forms to review | Client forms that are Submitted or In review |
| Cases pending after KYC | KYC is complete, but the next step has not been taken and no quote is issued |

A **case** means one client engagement, covering one signed quote and its services.

## 6. Proposed tabs

**Dashboard · Leads · Review · Documentation · Cases · Clients · Services & Fees · Tasks · Settings**

| Tab | Holds | Compared with today |
|---|---|---|
| Leads | New, unassigned and in-contact leads, pick-up and reassignment | New |
| Review | Submitted forms and documents | Replaces Onboarding |
| Documentation | Quote, signed copy, voucher, letter and invoice, per case, plus the document register | New, absorbs Documents |
| Cases | Assigned cases with per-service checkpoint progress | New |
| Clients | Client records and workspace | Kept |
| Services & Fees | Service list, stored amounts and, later, checkpoint lists | Kept and extended |
| Settings | Roles, numbering and settings, plus Import | Import moves here |

## 7. What changes in the current build

The current module is live, but holds test data only. On 2026-11-04 it had 1 client, 1 service, 1 payment, 4 quotes, no imported rows and no Setup staff roles. Restructuring now puts no real records at risk.

| Area | Today | Needed |
|---|---|---|
| Leads | None. Business Development writes a handover when a lead is Won, but nothing reads it | Leads table, and read that handover. Banking's pick-up and reassignment approval can be the pattern |
| Starting point | Staff issue a login, which creates the form | Starts from a lead, with the link shared at Contact |
| Fee entry | Stored amount fills in as a real value | Grey placeholder. Stored amount must be allowed to be empty, as all 24 items now hold figures |
| VAT | Staff choose Inclusive, Exclusive or None. Default is Inclusive | 5% added on top |
| Signed quote | Quote is accepted by staff | Client uploads the signed copy |
| Payment | Belongs to an issued quote | Must also work when money arrives before the quote exists |
| Engagement letter | Allowed after the quote is accepted | Allowed only after payment |
| Invoice | Placeholder panel saying Zoho is not connected | A real step in Documentation |
| Manager role | A `MANAGER` role exists, but no staff hold Setup roles | Approval permission, and named holders |
| Progress | Six simple statuses per service | Checkpoints per service type |
| Accounts | One handover per quote | See decision 7 |

**Reused as they are:** Client Master, KYC, the client portal, quote templates and numbering, the payment ledger and receipts, the Accounts review, and the audit log.

## 8. Suggested build order

Each phase gets its own plan and can be released alone.

1. **Pipeline:** cases and stages, Leads tab, ownership and approval, new tabs and dashboard.
2. **Documentation:** service selection, price placeholders, VAT, signed quote upload, payment before quote, letter rule, and invoice recording.
3. **Service work:** checkpoints, progress in the staff and client views, and the Accounts handover.
4. **Connections:** Business Development transfer and Zoho drafts. Zoho needs its Part B built and a working token.

The old CRM import should wait until phase 1 is done, so that imported clients land in the new stages.

## 9. Decisions needed

| # | Decision | Why it matters | Recommendation |
|---|---|---|---|
| 1 | What is the link at stage 2? A login, or a separate link without a login? | The request shares a link first, and login details later with the quote. A separate link is a new public upload route. The 2026-11-03 design removed such a link and chose logins | Issue the login at stage 2 and send it again with the quote. It is already built, and can be revoked if the lead is lost |
| 2 | Who records payments: Business Development, Business Setup, or both? | The request says Business Development records them, but this may be a dictation slip | Both, with the same ledger and voucher numbering |
| 3 | When a person takes a lead, are they also the case owner? | The request describes assignment at the lead stage and again after documentation | One owner from pick-up. At stage 10, the owner confirms or the manager reassigns |
| 4 | Is the grey amount used automatically if the employee types nothing? | A placeholder is normally not a value. Auto-use could also send out prices that are still drafts | No. The employee must enter a figure, with one click to copy the grey amount |
| 5 | Does 5% VAT apply to every line, including government fees passed on to the client? | The treatment of pass-through fees can differ from service fees, and this affects every quote total. Finance should confirm | Allow VAT to be set per fee item, with 5% as the default |
| 6 | Does a part payment allow the engagement letter and the start of work? | The request says the letter follows payment, without saying how much. Today any payment allows work to start | Any payment above zero, with a manager override for no payment |
| 7 | Is the Accounts handover per service or per quote? | The request says "once the service is done". Today it is per quote, because payments belong to a quote. Per service means a redesign of the locks | Per service, showing the quote's payment position in the Accounts review |
| 8 | Who is the division manager, and who are the team members? | Needed for approvals, and no one holds a Setup role today | User supplies the names |

## 10. Defaults unless told otherwise

- Leads can be marked Lost with a reason. A lost lead's login is revoked.
- A returning client starts a new case at stage 4 if their KYC is still current.
- Checkpoints go in order. Moving back needs a note, and all changes are kept in history.
- "Waiting on client" and "Waiting on government" stay as hold flags beside the checkpoints.
- A service with no checkpoint list yet keeps the simple statuses.
- Completing a service still needs an output file, unless overridden with a reason.
- Clients see the checkpoint name and progress in their login, but never internal notes.
- Quotes and logins can be emailed or copied from a template by staff.
- Until Zoho Part B exists, staff record the invoice number and file by hand. Later, the CRM only creates drafts, under the existing Zoho access rule.
- The stored fee amounts stay as they are, but they are draft figures that the department has not agreed. They should be agreed before staff rely on the placeholders.
