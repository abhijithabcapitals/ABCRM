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
  "Explee",
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

// Lead Calendar items (Database Module/migrations/bd/010_bd_calendar_items.sql); row-level security decides visibility.
const CALENDAR_ITEM_COLUMNS = "id, title, kind, starts_at, ends_at, all_day, lead_id, assigned_to, notes, status, completed_at, created_by";

export async function fetchBdCalendarItems(from, to) {
  return supabase.from("bd_calendar_items").select(CALENDAR_ITEM_COLUMNS)
    .gte("starts_at", from).lt("starts_at", to).neq("status", "cancelled").order("starts_at").limit(2000);
}

export async function fetchOverdueBdCalendarItems() {
  return supabase.from("bd_calendar_items").select(CALENDAR_ITEM_COLUMNS)
    .eq("status", "open").lt("starts_at", new Date().toISOString()).order("starts_at").limit(100);
}

export async function saveBdCalendarItem(item, id = null) {
  const query = id
    ? supabase.from("bd_calendar_items").update(item).eq("id", id)
    : supabase.from("bd_calendar_items").insert(item);
  return query.select(CALENDAR_ITEM_COLUMNS).single();
}

export async function deleteBdCalendarItem(id) {
  return supabase.from("bd_calendar_items").delete().eq("id", id);
}

// Lead-generation platforms (bd-lead-sources Edge Function; prospects staged in bd_platform_prospects)
export async function callLeadSources(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke("bd-lead-sources", { body: { action, provider: "explee", ...payload } });
  if (error) {
    let message = error.message;
    try { message = (await error.context?.json())?.error || message; } catch { /* keep message */ }
    if (/unknown action/i.test(message)) {
      message = `The deployed bd-lead-sources function does not support "${action}" yet. Deploy the latest Business Development Edge Function in Supabase, then try again.`;
    }
    return { data: null, error: { message } };
  }
  if (data?.error) {
    const message = /unknown action/i.test(data.error)
      ? `The deployed bd-lead-sources function does not support "${action}" yet. Deploy the latest Business Development Edge Function in Supabase, then try again.`
      : data.error;
    return { data: null, error: { message } };
  }
  return { data, error: null };
}

export async function fetchPlatformProspectCounts() {
  return supabase.from("bd_platform_prospects").select("provider, status").limit(20000);
}

export async function fetchPlatformProspects(status = "new", provider = null) {
  let query = supabase.from("bd_platform_prospects")
    .select("id, provider, kind, external_id, campaign_name, name, email, phone, job_title, company_name, company_domain, linkedin_url, country, why_hot, note, became_hot_at, replied, status, lead_id, fetched_at")
    .order("became_hot_at", { ascending: false, nullsFirst: false })
    .order("fetched_at", { ascending: false })
    .limit(500);
  if (status !== "all") query = query.eq("status", status);
  if (provider) query = query.eq("provider", provider);
  return query;
}

export async function fetchLatestPlatformReplyDraft(prospectId) {
  return supabase.schema("email_base").from("bd_reply_drafts")
    .select("id, body_text, status")
    .eq("prospect_id", prospectId)
    .in("status", ["draft", "failed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
}

export async function savePlatformReplyDraft(prospectId, draftId, bodyText) {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) return { data: null, error: userError };
  if (!userData.user) return { data: null, error: { message: "Sign in before saving a reply draft." } };

  const drafts = supabase.schema("email_base").from("bd_reply_drafts");
  const result = draftId
    ? await drafts.update({ body_text: bodyText, drafted_by: "person", status: "draft", updated_by: userData.user.id })
      .eq("id", draftId).eq("prospect_id", prospectId).in("status", ["draft", "failed"]).select("*").maybeSingle()
    : await drafts.insert({
      prospect_id: prospectId, provider: "explee", body_text: bodyText, drafted_by: "person", created_by: userData.user.id,
    }).select("*").single();

  if (result.error) return { data: null, error: result.error };
  if (!result.data) return { data: null, error: { message: "Draft not found or it can no longer be edited." } };

  const { error: prospectError } = await supabase.from("bd_platform_prospects")
    .update({ status: "drafted", handled_by: userData.user.id, handled_at: new Date().toISOString() })
    .eq("id", prospectId);
  return {
    data: { draft: result.data, warning: prospectError ? `Draft saved, but could not move the prospect to Drafted replies: ${prospectError.message}` : null },
    error: null,
  };
}

// Every signature in the organization (Profile > Mail; shared by Main Module/db/email_signatures_shared.sql).
// The user's own come first; another person's are labelled with their name, and only the
// user's own default is treated as the default.
export async function fetchEmailSignatures() {
  const [{ data: sessionData }, result] = await Promise.all([
    supabase.auth.getSession(),
    supabase.from("email_signatures")
      .select("id, user_id, name, body_text, logo_url, is_default, owner:profiles(full_name, email)")
      .order("created_at"),
  ]);
  if (result.error) return { data: null, error: result.error };
  return { data: shapeSharedSignatures(result.data || [], sessionData?.session?.user?.id), error: null };
}

export function shapeSharedSignatures(rows, userId) {
  return rows
    .map((s) => {
      const mine = s.user_id === userId;
      const owner = s.owner?.full_name || s.owner?.email || "a colleague";
      return { ...s, mine, is_default: mine && s.is_default, label: mine ? s.name : `${s.name} (shared by ${owner})` };
    })
    .sort((a, b) => Number(b.mine) - Number(a.mine));
}

export async function discardPlatformReplyDraft(prospectId) {
  const { error: draftError } = await supabase.schema("email_base").from("bd_reply_drafts")
    .update({ status: "discarded" })
    .eq("prospect_id", prospectId).in("status", ["draft", "failed"]);
  if (draftError) return { error: draftError };
  return supabase.from("bd_platform_prospects")
    .update({ status: "new", handled_at: null, handled_by: null })
    .eq("id", prospectId).eq("status", "drafted");
}

export async function updatePlatformProspect(id, patch) {
  return supabase.from("bd_platform_prospects").update(patch).eq("id", id);
}
