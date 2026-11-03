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
    .eq("record_type", recordType).eq("record_id", String(recordId)).eq("link_type", "teams_chat")
    .order("created_at", { ascending: false }));
}

// A repeat of the same chat hits the unique rule (23505). That is not a failure.
export async function saveChatLink({ recordType, recordId, reference, label }) {
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase.from("crm_communication_links").insert({
    record_type: recordType, record_id: String(recordId), link_type: "teams_chat", reference, label, created_by: auth?.user?.id,
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
