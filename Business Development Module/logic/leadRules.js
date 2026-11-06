// Lead rules shared with the Dashboard card. No imports, so node --test can load it.
export const isOpen = (lead) => lead.status === "active";

// An open lead nobody has taken yet sits in the All Leads pool.
export const isUnassigned = (lead) => isOpen(lead) && !lead.current_owner;

// Workflow stages (Database Module/migrations/bd/012_bd_lead_workflow.sql). Converted is reached only by
// recording the client's payment receipt; it is not a stage you can move a lead into by hand.
export const WORKFLOW_STAGES = [
  "Prospect",
  "Contact",
  "Convinced",
  "Received Documents",
  "Done KYC",
  "Quote & Engagement Sent",
];
export const CONVERTED_STAGE = "Converted";
export const QUOTE_STAGE = "Quote & Engagement Sent";

// The departments a converted lead is handed to, and the record each one receives.
export const DEPARTMENTS = [
  { key: "business_banking", label: "Business Banking", record: "Banking lead" },
  { key: "business_setup", label: "Business Setup", record: "Business Setup lead" },
  { key: "accounting", label: "Accounting", record: "Accounting job" },
];
export const departmentLabel = (key) => DEPARTMENTS.find((d) => d.key === key)?.label || key;

const BANKING_SERVICES = new Set(["Bank Account Opening"]);
const SETUP_SERVICES = new Set(["Company Formation", "Company Closure/Liquidation"]);

// Suggested department for a service; the user confirms or changes it when converting.
export function departmentForService(serviceName) {
  if (BANKING_SERVICES.has(serviceName)) return "business_banking";
  if (SETUP_SERVICES.has(serviceName)) return "business_setup";
  return "accounting";
}

// { department: [service names] } for the given services, in DEPARTMENTS order, departments with no service left out.
export function suggestTransfers(serviceNames) {
  const out = {};
  for (const name of serviceNames) {
    const key = departmentForService(name);
    (out[key] ||= []).push(name);
  }
  return Object.fromEntries(DEPARTMENTS.filter((d) => out[d.key]).map((d) => [d.key, out[d.key]]));
}

// The next step button on a lead: which action it runs and its label.
export function nextStep(lead) {
  if (!isOpen(lead)) return null;
  if (!lead.current_owner) return { action: "assign", label: "Assign to me" };
  const index = WORKFLOW_STAGES.indexOf(lead.stage);
  if (lead.stage === QUOTE_STAGE) return { action: "convert", label: "Record receipt & convert" };
  if (lead.stage === "Done KYC") return { action: "quote", label: "Send quote & engagement" };
  if (index < 0) return { action: "stage", stage: WORKFLOW_STAGES[0], label: `Move to ${WORKFLOW_STAGES[0]}` };
  const next = WORKFLOW_STAGES[index + 1];
  return { action: "stage", stage: next, label: `Move to ${next}` };
}
