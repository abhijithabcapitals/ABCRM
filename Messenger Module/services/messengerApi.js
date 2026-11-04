import { supabase } from "@app/supabase";

function check({ data, error }) {
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return data;
}

export async function listStaff() {
  return check(await supabase.from("profiles").select("id, full_name, email").order("full_name"));
}

export async function listLinks(recordType, recordId) {
  return check(await supabase.from("crm_communication_links").select("*")
    .eq("record_type", recordType).eq("record_id", String(recordId)).eq("link_type", "chat")
    .order("created_at", { ascending: false }));
}

// A repeat of the same chat hits the unique rule (23505). That is not a failure.
export async function saveChatLink({ recordType, recordId, reference, label }) {
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase.from("crm_communication_links").insert({
    record_type: recordType, record_id: String(recordId), link_type: "chat", reference, label, created_by: auth?.user?.id,
  });
  if (error && error.code !== "23505") throw new Error(error.message);
}

export async function deleteLink(id) {
  check(await supabase.from("crm_communication_links").delete().eq("id", id));
}

export async function currentUserId() {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id || null;
}

// The person's own saved chats, newest first.
export async function listMyChats(limit = 20) {
  const me = await currentUserId();
  if (!me) return [];
  return check(await supabase.from("crm_communication_links").select("*")
    .eq("link_type", "chat").eq("created_by", me)
    .order("created_at", { ascending: false }).limit(limit));
}

// ---------------------------------------------------------------- Microsoft connection (Edge Function ms365)

// The function answers { error } with status 400 for a message meant for the person.
export async function callMs365(action, body = {}) {
  const { data, error } = await supabase.functions.invoke("ms365", { body: { action, ...body } });
  if (error) {
    let message = "Could not reach the Microsoft service. Try again.";
    try { message = (await error.context.json()).error || message; } catch { /* keep the general sentence */ }
    throw new Error(message);
  }
  return data;
}

export const connectionStatus = () => callMs365("connection_status");
export const connectStart = () => callMs365("connect_start");
export const disconnectMicrosoft = () => callMs365("disconnect");
export const testConnection = () => callMs365("admin_test");
export const reviewLink = (profileId, decision, upn) => callMs365("user_links_review", { profile_id: profileId, decision, upn });
export const saveSecretExpiry = (date) => callMs365("secret_expiry_set", { date });

// Admin only by row security: the 100 newest entries, optionally narrowed.
export async function listSyncLog({ action, status } = {}) {
  let q = supabase.from("microsoft_sync_log").select("id, action, status, error_code, actor, detail, created_at")
    .order("created_at", { ascending: false }).limit(100);
  if (action) q = q.eq("action", action);
  if (status) q = q.eq("status", status);
  return check(await q);
}
