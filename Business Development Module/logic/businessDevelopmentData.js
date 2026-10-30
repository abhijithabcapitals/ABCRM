import { supabase } from "@app/supabase";

// Backend: Database Module/migrations/bd (001 schema, 002 seed, 003 UI functions).
// Every write goes through a bd_* database function; the lists below mirror the seed names.

export const BD_STAGES = [
  "New Lead",
  "Contact Pending",
  "First Contact Attempted",
  "Contact Established",
  "Requirement Identified",
  "Qualified",
  "Proposal / Quotation Preparation",
  "Proposal Sent",
  "Follow-up / Negotiation",
  "Verbal Confirmation",
];

export const BD_SOURCES = [
  "Cold Call",
  "WhatsApp",
  "Meta Ads",
  "Google Ads",
  "Instagram",
  "Direct",
  "Campaign",
  "Third Party",
  "Employee Referral",
  "Client Referral",
  "Website",
  "LinkedIn",
  "Email",
  "Networking / Event",
  "Walk-in",
  "Other",
];

// bd_service_catalog: the Client Module "Services Provided" options, plus E-Invoicing Services
export const BD_SERVICES = [
  "Bookkeeping",
  "Accounting",
  "VAT Registration",
  "VAT Return Filing",
  "Corporate Tax Registration",
  "Corporate Tax Return",
  "Corporate Tax Advisory",
  "Tax Planning",
  "Financial Statements",
  "Audit",
  "Review",
  "Internal Audit",
  "Payroll",
  "WPS",
  "Management Accounts",
  "Budgeting",
  "Cash Flow Reporting",
  "ESR/Related Compliance",
  "UBO Compliance",
  "AML/KYC Compliance",
  "Accounting Software Setup",
  "ERP Support",
  "Company Formation",
  "Company Closure/Liquidation",
  "VAT Deregistration",
  "Tax Deregistration",
  "Other Advisory",
  "E-Invoicing Services",
];

// Leads with their services, discussions, follow-ups and handover, already in the shape the screens use
export async function fetchBusinessDevelopmentLeads() {
  return supabase.rpc("bd_ui_leads", { p_limit: 500 });
}

export async function fetchBusinessDevelopmentProfiles() {
  return supabase.from("profiles").select("id, full_name, email").order("full_name");
}

export async function createBusinessDevelopmentLead(lead, activity, followup) {
  return supabase.rpc("bd_create_lead", {
    p_lead: lead,
    p_activity: activity,
    p_followup: followup,
  });
}

export async function createBusinessDevelopmentActivity(activity) {
  return supabase.rpc("bd_log_activity", { p_activity: activity });
}

export async function createBusinessDevelopmentFollowup(followup) {
  return supabase.rpc("bd_create_followup", { p_followup: followup });
}

export async function completeBusinessDevelopmentFollowup(followupId, completion) {
  return supabase.rpc("bd_complete_followup", {
    p_followup_id: followupId,
    p_completion: completion,
  });
}

export async function createBusinessDevelopmentService(service) {
  return supabase.rpc("bd_save_service", { p_service: service });
}

export async function updateBusinessDevelopmentService(serviceId, service) {
  return supabase.rpc("bd_save_service", { p_service: { ...service, id: serviceId } });
}

export async function updateBusinessDevelopmentStage(leadId, stage) {
  return supabase.rpc("bd_change_stage", { p_lead_id: leadId, p_stage: stage });
}

export async function markBusinessDevelopmentLeadWon(leadId, handover) {
  return supabase.rpc("bd_mark_lead_won", {
    p_lead_id: leadId,
    p_handover: handover,
  });
}

export async function markBusinessDevelopmentLeadLost(leadId, reason, notes) {
  return supabase.rpc("bd_mark_lead_lost", {
    p_lead_id: leadId,
    p_reason: reason,
    p_notes: notes,
  });
}
