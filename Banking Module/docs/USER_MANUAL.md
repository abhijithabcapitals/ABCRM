# Business Banking: user guide

Open **Business Banking** in the CRM sidebar. An administrator gives you a banking role in Settings > Users & Permissions.

## The normal path

**Leads** has four tabs. **New Leads** have no owner: press **Pick Up** and the lead moves to **In Pipeline** under your name. It moves to **Converted** when a bank is selected and a payment received, and goes back if that payment is reversed. **Lost** holds lost, not interested and unreachable leads. **+ New Lead** and **Import from Excel** are at the top right. A lead you add yourself starts In Pipeline.

**New Lead**
1. Upload all the documents you have. Press **Read documents and continue**. This needs the Client Module running on this PC (`Client Module\\Start-ClientModule.cmd`); without it, you type the details and the files are still saved.
2. Green fields were read from documents, so check them. Amber fields are missing, so fill them. **Show only what is missing** is on by default.
3. **Save and select bank** opens the case at the bank and plan page.

**Inside a case**, the 18 steps run along the top. Do the page for the current step and press **Complete step and continue**. If something is missing, the message lists it. An authorised user can continue by exception with a written justification. Any step can be opened to look at; **Return case to this step** moves a case back, with remarks.

| Step | What you do there |
|---|---|
| 1-3 Lead, Verification, Contact | Review the lead, link Client Master, assign an employee, log the call |
| 4 General KYC | Finish the company, partner and business details |
| 5-6 Bank Options, Selection | See every bank's plans and charges, then **Select this plan**. The document list is built and you go to step 7 |
| 7-8 Checklist, Collection | Files uploaded earlier are already linked. Upload the rest. A Document Executive marks each Verified; uploading never verifies |
| 9 Quotation | Starts with the bank fee and default AED 2,000 service fee. Add Home Ejari only if wanted |
| 10 Payment | Record each payment separately; a receipt is created. Fix mistakes with Reverse |
| 11 Acceptance | Accept the issued quotation |
| 12-13 Agreement | Generate the letter, then record the signature with the signed scan |
| 14 Bank Follow-up | Press **Submitted to bank**. Then record each **Reply from bank** and any **Resubmitted**, and finish with **Rejected** or **Account opened**. A payment and the signed letter are needed before the first submission |
| 15 Completion | Check the summary, press **Fill** on anything missing, enter the account details, then **Mark complete and send to Accounts** |

Overview, Tasks, Follow-ups and Activity History are under **Case records**.

**Existing leads and clients:** open the lead in **Leads**, the client in **Banking Clients**, or step 4 of a case, press **Fill from documents**. Empty fields are ticked for you. A value that differs from the saved one is shown in red and unticked, so you decide. Then press **Save KYC**.

## Leads and Banking Clients

Every lead holds its KYC: open it in **Leads**. Once a bank is selected and a payment received, it also appears in **Banking Clients**, with its KYC and other details. Clients imported from Excel appear there once a bank is recorded, because their payments are still being reviewed.

## Reassigning a lead

In **In Pipeline**, press **Reassign** and choose the employee. The lead stays with you until they press **Accept** at the top of their Leads page; then they are tagged on the lead and its open cases.

## Handing over to Accounts

After **Account opened**, go to step 15. Account number, IBAN, account name and opening date are required; they are saved on the client and shown under **Banking Clients > Other Details > Bank accounts**. Press **Mark complete and send to Accounts**. The case leaves your lists and nobody can change it. Accounts reviews it on the **Accounting** page: **Revert** returns it to you with remarks; **Validate and close** closes it. Closed cases appear greyed in a collapsed **Closed** section under the table.

## Tasks

**New task** starts with the client: pick an existing one, press **+ Add Client**, or tick **Others** and enter a title. Then fill Employee, Task, Priority, Date, Remarks and Status. Inside a case, the client is already known.

## Reports

Reports are on the **Dashboard**, under the **Reports** view, with filters and export to Excel or PDF.

## Documentation

The **Documentation** tab holds Quotations, Payments and Agreements. **+ New Document** asks for the type and the client's case, then opens that case at the right step.

Under **Payments**, **+ Record Payment & Issue Voucher** does the same for a payment. Recording the payment issues its fee receipt voucher, which is listed there with **Print / PDF**. **Payment Ledger** shows every payment, refund, reversal and adjustment.

## Importing the Excel history

Only the AB Capital template is accepted. In **Leads**, press **Import from Excel**, download it, fill it in, and upload it. Any other Excel is refused. A file with a problem in any row must be fixed and uploaded again; nothing from it is saved.

1. Check the preview, then **Stage for review**. Nothing is live yet.
2. **Approve clean rows** approves only high-confidence rows. Open the others with **Decide**. Rows from the old working sheet whose colour disagrees with their text wait for you here.
3. **Commit approved** creates the clients, cases and applications. It can be run repeatedly; a row with the same company, bank and month is not created twice.
4. **Payment notes to review**: confirm each transaction read from the note. A missing date or amount stays blank until you have evidence. If there is none, use "Post nothing".

## Masters

Logos come from each bank's website. To use a better logo, paste its address in the bank's **Bank logo URL**. Open **Banking Partners** and click a bank to manage its details and RMs, plans, pricing, document list and internal notes in one place. Standard lists are under **Standard document lists**. All of it changes without software changes. Requirements supplied so far are internal notes marked **Unverified**. When someone confirms one with the bank, record the date, source and reviewer and mark it Verified.

Risk rules and internal notes are only considerations for staff. They never reject a client.

## PDFs

Preview / PDF opens the print dialog; choose "Save as PDF". Word downloads a filled copy of the template.
