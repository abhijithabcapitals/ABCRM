# Business Banking: user guide

Open **Business Banking** in the CRM sidebar. An administrator gives you a banking role in Settings > Users & Permissions.

## The normal path

1. **Leads**: add a lead, log calls under its history, set a follow-up date.
2. **Convert to client**: the CRM lists existing clients with that name or licence. Reuse one if it is the same company. One client can have many cases.
3. **General KYC**: save what you have; partial is fine. Answer the "facts" section, because the checklist depends on it.
4. **Bank Selection**: add banks and schemes to compare, mark them presented, record the client's response, then **Select this bank**. This builds the document checklist. Changing bank later needs a reason, and the old selection stays on record.
5. **Documents**: upload against each line. A new file is only "Received"; a Document Executive opens it and marks it Verified. Lines marked To Confirm depend on a KYC fact not yet answered.
6. **Quotation**: New quotation starts with the bank fee and the default AED 2,000 service fee. Add Home Ejari only if the client wants it. Changing a default needs a reason, and a large cut goes to a manager. Save, Issue, Send, then Accept or Reject. To change an issued quotation, use Revise.
7. **Payments**: record each payment separately; a receipt is created for each. Fix a mistake with Reverse. Never re-enter over it.
8. **Agreement**: Generate letter after acceptance, download or print it, then Record signature with the signed scan attached.
9. **Application**: Open application, tick form prepared, and move the status along. Submission is refused until documents, payment and signature are in place. An authorised user can override with a written justification.
10. **Status**: Approved and Account Opened are separate steps. Mark Account Opened only when the bank confirms the account exists.

The stage tracker at the top of a case can be clicked to move forward or back. Moving back needs remarks.

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
