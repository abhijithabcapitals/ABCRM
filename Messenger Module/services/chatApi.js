// Chat data service. The factory takes a Supabase client so it runs in node tests; chatClient.js binds the real one.
// Database wording never reaches the thrown sentence.

const PAGE = 50;
const PICK_LIMIT = 20;
const MAIL_WINDOW_DAYS = 15;
let seq = 0; // one channel name per subscription, so two in a window never share a topic

function fail(sentence) {
  throw new Error(sentence);
}

function rows(res, sentence) {
  if (res.error) fail(sentence);
  return res.data;
}

export function createChatApi(client) {
  const call = async (fn, args, sentence) => rows(await client.rpc(fn, args), sentence);

  // One copy of the people the caller may see. The picker fetches it once per opening and filters it as the person types.
  async function clientLookup() {
    return rows(await client.rpc("client_lookup"), "Could not search clients. Please try again.") || [];
  }

  // `clients` is the copy from clientLookup(); a client search filters it without calling the database.
  async function searchRecords(type, query, clients) {
    const q = String(query || "").trim();
    if (type === "client") {
      const needle = q.toLowerCase();
      const fields = ["name", "legal_name", "trade_name", "trn", "license", "email", "phone"];
      // Leads and unlinked banking clients have no ref; a client can appear at two ranks. Keep the first of each ref.
      const seen = new Set();
      return (clients || [])
        .filter((r) => r.ref && (!needle || fields.some((f) => String(r[f] || "").toLowerCase().includes(needle))))
        .filter((r) => !seen.has(r.ref) && seen.add(r.ref))
        .slice(0, PICK_LIMIT)
        .map((r) => ({ ref: r.ref, label: r.name }));
    }
    if (type === "lead") {
      const data = rows(await client.from("bd_leads").select("id, lead_number").is("archived_at", null).ilike("lead_number", `%${q}%`).limit(PICK_LIMIT),
        "Could not search leads. Please try again.");
      return (data || []).map((r) => ({ ref: r.id, label: r.lead_number }));
    }
    if (type === "task") {
      const data = rows(await client.from("tasks").select("id, title").is("deleted_at", null).ilike("title", `%${q}%`).limit(PICK_LIMIT),
        "Could not search tasks. Please try again.");
      return (data || []).map((r) => ({ ref: r.id, label: r.title }));
    }
    return [];
  }

  // onStatus: "up" on SUBSCRIBED, "down" on a drop. onCatchUp: SUBSCRIBED after a drop, window focus, window online.
  function subscribe(onMessage, onCatchUp, onStatus) {
    let stopped = false;
    let dropped = false;
    const catchUp = () => { if (!stopped) onCatchUp?.(); };
    const channel = client
      .channel(`messenger:messages:${++seq}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messenger_messages" },
        (payload) => { if (!stopped) onMessage?.(payload.new); })
      .subscribe((status) => {
        if (stopped) return;
        if (status === "SUBSCRIBED") {
          const recovered = dropped;
          dropped = false;
          onStatus?.("up");
          if (recovered) onCatchUp?.();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          dropped = true;
          onStatus?.("down");
        }
      });
    window.addEventListener("focus", catchUp);
    window.addEventListener("online", catchUp);
    return () => {
      stopped = true;
      window.removeEventListener("focus", catchUp);
      window.removeEventListener("online", catchUp);
      client.removeChannel(channel);
    };
  }

  return {
    chatList: () => call("messenger_chat_list", undefined, "Could not load your chats. Please try again."),
    async messages(conversationId, { before, limit = PAGE } = {}) {
      let q = client.from("messenger_messages").select("*").eq("conversation_id", conversationId);
      if (before) q = q.lt("created_at", before);
      return rows(await q.order("created_at", { ascending: false }).limit(limit), "Could not load messages. Please try again.");
    },
    readState: (conversationId) => call("messenger_read_state", { p_conversation: conversationId }, "Could not check who has read this chat."),
    markRead: (conversationId) => call("messenger_mark_read", { p_conversation: conversationId }, "Could not mark this chat as read."),
    // A repeat of the same message id hits the unique rule (23505). That means it already arrived.
    async send({ id, conversationId, senderId, body, link }) {
      const row = { id, conversation_id: conversationId, sender_id: senderId, body };
      if (link) Object.assign(row, { link_type: link.type, link_ref: link.ref, link_label: link.label });
      const { error } = await client.from("messenger_messages").insert(row);
      if (error && error.code !== "23505") fail("Your message was not sent. Please try again.");
    },
    startDirect: (otherId) => call("messenger_start_direct", { p_other: otherId }, "Could not open this chat. Please try again."),
    createGroup: (title, memberIds) => call("messenger_create_group", { p_title: title, p_members: memberIds }, "Could not create the group. Please try again."),
    addMembers: (conversationId, memberIds) => call("messenger_add_members", { p_conversation: conversationId, p_members: memberIds }, "Could not add these people. Please try again."),
    removeMember: (conversationId, memberId) => call("messenger_remove_member", { p_conversation: conversationId, p_member: memberId }, "Could not remove this person. Please try again."),
    renameGroup: (conversationId, title) => call("messenger_rename_group", { p_conversation: conversationId, p_title: title }, "Could not rename the group. Please try again."),
    leave: (conversationId) => call("messenger_leave", { p_conversation: conversationId }, "Could not leave the group. Please try again."),
    async members(conversationId) {
      const data = rows(await client.from("messenger_members").select("profile_id, role, last_read_at, profiles(full_name)").eq("conversation_id", conversationId),
        "Could not load the members. Please try again.");
      return (data || []).map(({ profiles, ...m }) => ({ ...m, full_name: profiles?.full_name ?? null }));
    },
    async staff() {
      return rows(await client.from("profiles").select("id, full_name").order("full_name"), "Could not load the staff list. Please try again.");
    },
    clientLookup,
    // New conversations in the connected mailboxes, counted as the CEO Agent inbox does. Null when mail cannot be read.
    async mailNewCount() {
      const { data: prefs } = await client.schema("ceo").from("inbox_preferences").select("hidden_mailbox_ids").maybeSingle();
      const hidden = prefs?.hidden_mailbox_ids || [];
      let q = client.schema("email_base").from("threads").select("id", { count: "exact", head: true })
        .contains("tags", ["ceo"]).eq("status", "new")
        .gte("last_message_at", new Date(Date.now() - MAIL_WINDOW_DAYS * 86400000).toISOString());
      if (hidden.length) q = q.not("mailbox_id", "in", `(${hidden.join(",")})`);
      const { count, error } = await q;
      return error ? null : count;
    },
    searchRecords,
    subscribe,
  };
}
