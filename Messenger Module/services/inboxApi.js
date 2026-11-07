// Inbox data service. The factory takes a Supabase client so it runs in node tests; inboxClient.js binds the real one.
// Email is read from the CRM's mail store with the person's own login, so its access rules decide which mailboxes arrive.
import { cleanSearch, windowStart } from "../logic/inbox.js";

const BUCKET = "email-base";
const LINK_SECONDS = 120;
const THREAD_COLUMNS = "id, mailbox_id, subject, participants, last_message_at, message_count, status, needs_reply";
const MESSAGE_COLUMNS = "id, direction, from_address, from_name, to_addresses, cc_addresses, subject, sent_at, body_text, body_html, body_complete, attachment_count";
const LIST_LIMIT = 100;
const CHANNEL_THREAD_COLUMNS = "id, account_id, external_id, contact_name, status, assigned_to, last_preview, last_message_at, last_inbound_at, messenger_inbox_accounts!inner(channel)";
let seq = 0; // one channel name per subscription

function rows(res, sentence) {
  if (res.error) throw new Error(sentence);
  return res.data;
}

export function createInboxApi(client) {
  const mail = (table) => client.schema("email_base").from(table);
  // Connected channels. Row security limits every read to accounts shared with this person.
  const inbox = (table) => client.from(table);
  const fnCall = async (body) => {
    const { data, error } = await client.functions.invoke("messenger-inbox", { body });
    if (error || !data) throw new Error("The Inbox is not available right now.");
    if (data.error) throw new Error(data.error);
    return data;
  };
  const rpc = async (fn, args, sentence) => {
    const res = await client.rpc(fn, args);
    if (res.error) throw new Error(res.error.code === "P0001" || res.error.code === "42501" ? res.error.message : sentence);
    return res.data;
  };
  return {
    async channelAccounts() {
      const { data, error } = await inbox("messenger_inbox_accounts").select("id, channel, label, display_name").order("label");
      return error ? [] : data || []; // before the migration runs, the channels simply show as not connected
    },
    async channelThreads(channel) {
      return rows(await inbox("messenger_inbox_threads").select(CHANNEL_THREAD_COLUMNS).eq("messenger_inbox_accounts.channel", channel).neq("status", "archived").order("last_message_at", { ascending: false }).limit(LIST_LIMIT), "Could not load these conversations. Please try again.") || [];
    },
    async channelMessages(threadId) {
      const data = rows(await inbox("messenger_inbox_messages").select("id, direction, body, status, created_at").eq("thread_id", threadId).order("created_at", { ascending: false }).limit(LIST_LIMIT), "Could not open this conversation. Please try again.") || [];
      return [...data].reverse();
    },
    channelSend: (threadId, body) => fnCall({ action: "send", thread_id: threadId, body }),
    channelStatus: (threadId, status) => rpc("messenger_inbox_set_status", { p_thread: threadId, p_status: status }, "Could not update this conversation. Please try again."),
    channelAssign: (threadId, person) => rpc("messenger_inbox_assign", { p_thread: threadId, p_person: person }, "Could not assign this conversation. Please try again."),
    async channelUnread() {
      const { data, error } = await client.rpc("messenger_inbox_unread");
      return error ? 0 : data || 0;
    },
    subscribeInbox(onChange) {
      const channel = client.channel(`messenger:inbox:${++seq}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "messenger_inbox_messages" }, () => onChange())
        .subscribe();
      return () => { client.removeChannel(channel); };
    },
    adminAccounts: () => rpc("messenger_inbox_admin_list", undefined, "Could not load the connected accounts. Please try again."),
    setAccountPeople: (accountId, people) => rpc("messenger_inbox_set_access", { p_account: accountId, p_people: people }, "Could not save who can see this account. Please try again."),
    connectAccount: ({ channel, label, token, external_id: externalId, app_secret: appSecret }) => fnCall({ action: "connect", channel, label, token, external_id: externalId, app_secret: appSecret }),
    accountInfo: (accountId) => fnCall({ action: "info", account_id: accountId }),
    testAccount: (accountId) => fnCall({ action: "test", account_id: accountId }),
    disconnectAccount: (accountId) => fnCall({ action: "disconnect", account_id: accountId }),
    async staffList() {
      return rows(await client.from("profiles").select("id, full_name").order("full_name"), "Could not load the staff list. Please try again.");
    },
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
    // Earlier emails of a conversation that were moved to SharePoint: headers and links, no body.
    async archivedMessages(threadId) {
      const { data, error } = await mail("archived_messages")
        .select("id, direction, from_address, from_name, subject, sent_at, eml_web_url, attachments")
        .eq("thread_id", threadId).order("sent_at", { ascending: true });
      return error ? [] : data || []; // before migration 010 the table does not exist
    },
    async attachmentLink(path, filename) {
      const { data, error } = await client.storage.from(BUCKET).createSignedUrl(path, LINK_SECONDS, { download: filename || true });
      if (!error && data?.signedUrl) return data.signedUrl;
      // Files of older conversations live only in SharePoint.
      const { data: copy } = await mail("archive_items").select("web_url").eq("storage_path", path).maybeSingle();
      if (/^https:\/\//.test(copy?.web_url || "")) return copy.web_url;
      throw new Error("Could not open this attachment. Please try again.");
    },
  };
}
