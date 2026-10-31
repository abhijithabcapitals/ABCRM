// Fixed vocabularies. These mirror the check constraints in Banking Base/migrations/001.
// Anything commercial (fees, requirements, sources) lives in the database, not here.

export const STAGES = [
  "Lead Received",
  "Initial Contact and Discussion",
  "General KYC Collection",
  "Bank Options and Scheme Presentation",
  "Client Bank Selection",
  "Bank-Specific Document Checklist",
  "Document Collection and Verification",
  "Quotation Generation",
  "Payment Collection",
  "Client Acceptance",
  "Engagement Letter Generation",
  "Client Signature and Agreement",
  "Application Preparation",
  "Bank Submission / Appointment",
  "Bank Review and Follow-up",
  "Approved / Rejected / Returned",
  "Completed Application",
];

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
