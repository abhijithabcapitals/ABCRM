# Business Banking: user guide

Open **Business Banking** in the CRM sidebar. An administrator gives you a banking role in Settings > Users & Permissions.

## The normal path

In **Leads**, choose **New Lead** or **View Existing Leads**.

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
| 14-15 Application, Submission | Open the application, tick form prepared, submit or book an appointment |
| 16-17 Follow-up, Decision | Update the status as the bank responds |
| 18 Completion | Mark Account Opened only when the bank confirms the account exists |

Overview, Tasks, Follow-ups and Activity History are under **Case records**.

**Existing clients:** on General KYC or step 4 of a case, press **Fill from documents**. Empty fields are ticked for you. A value that differs from the saved one is shown in red and unticked, so you decide. Then press **Save KYC**.

## Importing the Excel history

Go to **Excel Import** and upload the workbook. Monthly Bank Account and Completed Bank are ticked by default.

1. Check the column mapping and preview, then **Stage for review**. Nothing is live yet.
2. **Approve clean rows** approves only high-confidence rows. Open the others with **Decide**: red rows and rows whose colour disagrees with their text always wait for you.
3. **Commit approved** creates the clients, cases and applications. It can be run repeatedly; a row with the same company, bank and month is not created twice.
4. **Payment notes to review**: confirm each transaction read from the note. A missing date or amount stays blank until you have evidence. If there is none, use "Post nothing".

## Masters

Bank Partners, Schemes, Pricing and Document Checklists can all be changed without software changes. Requirements supplied so far are internal notes marked **Unverified**. When someone confirms one with the bank, record the date, source and reviewer and mark it Verified.

Risk rules and internal notes are only considerations for staff. They never reject a client.

## PDFs

Preview / PDF opens the print dialog; choose "Save as PDF". Word downloads a filled copy of the template.
