// Inbox data service. The factory takes a Supabase client so it runs in node tests; inboxClient.js binds the real one.
// Email is read from the CRM's mail store with the person's own login, so its access rules decide which mailboxes arrive.
import { cleanSearch, windowStart } from "../logic/inbox.js";

const BUCKET = "email-base";
const LINK_SECONDS = 120;
const THREAD_COLUMNS = "id, mailbox_id, subject, participants, last_message_at, message_count, status, needs_reply";
const MESSAGE_COLUMNS = "id, direction, from_address, from_name, to_addresses, cc_addresses, subject, sent_at, body_text, body_html, body_complete, attachment_count";
const LIST_LIMIT = 100;

function rows(res, sentence) {
  if (res.error) throw new Error(sentence);
  return res.data;
}

export function createInboxApi(client) {
  const mail = (table) => client.schema("email_base").from(table);
  return {
    async mailboxes() {
      return rows(await mail("mailboxes").select("id, address, status, last_synced_at, last_error").order("address"), "Could not load your mailboxes. Please try again.") || [];
    },
    async threads({ mailboxId, archived = false, query = "" } = {}) {
      let q = mail("threads").select(THREAD_COLUMNS).gte("last_message_at", windowStart());
      q = archived ? q.eq("status", "archived") : q.neq("status", "archived");
      if (mailboxId) q = q.eq("mailbox_id", mailboxId);
      const text = cleanSearch(query);
      if (text) q = q.ilike("subject", `%${text}%`);
      return rows(await q.order("last_message_at", { ascending: false }).limit(LIST_LIMIT), "Could not load your mail. Please try again.") || [];
    },
    async newCount() {
      const { count, error } = await mail("threads").select("id", { count: "exact", head: true }).eq("status", "new").gte("last_message_at", windowStart());
      return error ? 0 : count || 0;
    },
    async messages(threadId) {
      return rows(await mail("messages").select(MESSAGE_COLUMNS).eq("thread_id", threadId).order("sent_at", { ascending: true }), "Could not open this conversation. Please try again.") || [];
    },
    async attachments(messageIds) {
      if (!messageIds.length) return [];
      return rows(await mail("attachments").select("id, message_id, filename, size_bytes, storage_path").in("message_id", messageIds).order("position"), "Could not list the attachments.") || [];
    },
    async setStatus(threadId, status) {
      rows(await mail("threads").update({ status }).eq("id", threadId), "Could not update this conversation. Please try again.");
    },
    async attachmentLink(path, filename) {
      const { data, error } = await client.storage.from(BUCKET).createSignedUrl(path, LINK_SECONDS, { download: filename || true });
      if (error || !data?.signedUrl) throw new Error("Could not open this attachment. Please try again.");
      return data.signedUrl;
    },
  };
}
