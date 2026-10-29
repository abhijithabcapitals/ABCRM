import { supabase } from "./supabase";

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

export const BD_SERVICES = [
  "Accounting",
  "Bookkeeping",
  "VAT Registration",
  "VAT Return Filing",
  "Corporate Tax Registration",
  "Corporate Tax Return Filing",
  "Tax Advisory",
  "Audit",
  "ESR / Other Compliance",
  "E-Invoicing Services",
  "Company Formation / Corporate Services",
  "Other",
];

export async function fetchBusinessDevelopmentLeads() {
  return supabase
    .from("bd_leads")
    .select("*, bd_lead_services(*), bd_lead_activities(*), bd_lead_followups(*), bd_onboarding_handoffs(*)")
    .order("created_at", { ascending: false })
    .limit(500);
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
  return supabase.from("bd_lead_services").insert(service).select().single();
}

export async function updateBusinessDevelopmentService(serviceId, service) {
  return supabase.from("bd_lead_services").update(service).eq("id", serviceId).select().single();
}

export async function updateBusinessDevelopmentStage(leadId, stage) {
  return supabase
    .from("bd_leads")
    .update({ stage })
    .eq("id", leadId)
    .select()
    .single();
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
