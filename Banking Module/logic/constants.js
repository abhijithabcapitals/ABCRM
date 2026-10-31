// Fixed vocabularies. These mirror the check constraints in Banking Base/migrations/001.
// Anything commercial (fees, requirements, sources) lives in the database, not here.

export const STEPS = [
  ["Lead Received", "Import client details from the third-party Excel working sheet, or add the lead here."],
  ["Lead Verification & Assignment", "Check duplicates, validate contact details and assign an employee."],
  ["Initial Client Contact", "Call the client, understand requirements and explain the banking service."],
  ["General KYC Collection", "Collect basic company, shareholder and business information."],
  ["Bank Options & Schemes Shared", "Present available banks, account schemes, fees and eligibility conditions."],
  ["Client Bank Selection", "Client selects the preferred bank and account scheme."],
  ["Bank-Specific Document Checklist", "Generate the required document checklist based on the selected bank."],
  ["Document Collection & Verification", "Request, receive, review and verify documents."],
  ["Quotation Generation", "Generate an offer with bank charges, AB Capital fees and supplementary services."],
  ["Payment Collection", "Receive advance or instalment payments and issue receipts."],
  ["Client Offer Acceptance", "Obtain formal acceptance of the quotation."],
  ["Engagement Letter Generation", "Generate and send the engagement letter."],
  ["Signed Agreement Received", "Receive and upload the signed engagement letter."],
  ["Application Preparation", "Prepare the complete application and supporting documents."],
  ["Bank Submission / Appointment", "Submit directly to the bank or arrange a client appointment."],
  ["Bank Follow-up & Processing", "Track bank review, additional requirements and application progress."],
  ["Bank Decision", "Track approval, rejection or return for additional action."],
  ["Account Opened – Completion", "Record account opening confirmation and close the banking case."],
];
export const STAGES = STEPS.map(([name]) => name);

export const LEAD_STATUSES = ["New", "Contacted", "Interested", "Follow-up Required", "Bank Options Shared", "Potential Client", "Quotation Sent", "Negotiation", "Converted", "Lost", "Not Interested", "Unreachable"];
export const PRIORITIES = ["Low", "Medium", "High", "Urgent"];
export const DOC_STATUSES = ["Not Requested", "Requested", "Received", "Under Review", "Verified", "Rejected", "Resubmission Required", "Not Applicable"];
export const APP_STATUSES = ["Not Started", "Document Collection", "Documents Under Review", "Documents Completed", "Application Preparation", "Ready for Submission", "Submitted to Bank", "Bank Review", "Additional Documents Requested", "Resubmission Required", "Appointment Scheduled", "Client Visited Bank", "Approved", "Account Opened", "Rejected", "Returned", "Cancelled", "On Hold"];
export const SUBMISSION_METHODS = ["Direct Bank Submission by AB Capital", "Bank Appointment – Client Visits Bank", "Digital Application", "Other"];
export const CHANNELS = ["Phone Call", "WhatsApp", "Email", "In Person", "Bank Relationship Manager", "Other"];
export const TASK_TYPES = ["Lead Follow-up", "General KYC Collection", "Bank Comparison", "Document Collection", "Document Verification", "Quotation Preparation", "Payment Follow-up", "Engagement Letter", "Application Preparation", "Bank Submission", "Bank Appointment", "Bank Follow-up", "Home Ejari Issuance"];
export const TASK_STATUSES = ["Open", "In Progress", "Completed", "Cancelled"];
export const ROLES = ["ADMIN", "MANAGER", "SALES_EXECUTIVE", "DOCUMENT_EXECUTIVE", "FINANCE", "BANKING_EXECUTIVE", "READ_ONLY"];
export const VERIFICATION = ["Unverified", "Verified", "Expired"];

export const GATE_LABELS = {
  kyc_completed: "General KYC Completed",
  bank_selected: "Bank Selected",
  scheme_selected: "Scheme Selected",
  documents_received: "All Required Documents Received",
  documents_verified: "All Documents Verified",
  quotation_accepted: "Quotation Accepted",
  payment_received: "Required Payment Received",
  letter_signed: "Engagement Letter Signed",
  form_prepared: "Application Form Prepared",
  submitted: "Bank Submission Completed",
};

export const REPORTS = [
  { group: "Sales", items: [["leads_received", "Leads Received"], ["lead_sources", "Lead Sources"], ["conversion_rate", "Conversion Rate"], ["lost_leads", "Lost Leads"], ["employee_performance", "Employee Performance"], ["quotations_issued", "Quotations Issued"], ["quotation_conversion", "Quotation Conversion"]] },
  { group: "Banking", items: [["applications_by_bank", "Applications by Bank"], ["applications_by_scheme", "Applications by Scheme"], ["under_process", "Applications Under Process"], ["accounts_opened", "Accounts Opened / Approved"], ["rejected", "Rejected Applications"], ["returned", "Returned Applications"], ["approval_rate", "Approval Rate"], ["average_processing", "Average Processing Time"]] },
  { group: "Financial", finance: true, items: [["quotation_value", "Total Quotation Value"], ["bank_fees", "Bank Fees"], ["ab_revenue", "AB Capital Revenue"], ["supplementary_revenue", "Supplementary Service Revenue"], ["payments_received", "Payments Received"], ["outstanding", "Outstanding Payments"], ["refunds", "Refunds"]] },
  { group: "Operational", items: [["pending_documents", "Pending Documents"], ["overdue_followups", "Overdue Follow-ups"], ["pending_agreements", "Pending Agreements"], ["pending_appointments", "Pending Bank Appointments"], ["awaiting_bank", "Awaiting Bank Response"], ["cases_by_employee", "Cases Pending by Employee"]] },
];
