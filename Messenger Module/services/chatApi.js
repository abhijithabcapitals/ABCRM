// Chat data service. The factory takes a Supabase client so it runs in node tests; chatClient.js binds the real one.
// Database wording never reaches the thrown sentence.

const PAGE = 50;
const PICK_LIMIT = 20;
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

  // The function answers with its own sentence when a request is refused, so that sentence is safe to show.
  async function fileCall(body) {
    const { data, error } = await client.functions.invoke("messenger-files", { body });
    if (error || !data) fail("File sharing is not available right now.");
    if (data.error) fail(data.error);
    return data;
  }

  // The team functions raise their own plain sentences (P0001, 42501). Any other database wording stays hidden.
  async function teamCall(fn, args, sentence) {
    const res = await client.rpc(fn, args);
    if (res.error) fail(res.error.code === "P0001" || res.error.code === "42501" ? res.error.message : sentence);
    return res.data;
  }

  async function callCall(body) {
    const { data, error } = await client.functions.invoke("messenger-calls", { body });
    if (error || !data) fail("Calls are not available right now.");
    if (data.error) fail(data.error);
    return data;
  }

  // Tells the screen about any change to a call this person is in. Row security limits what arrives.
  function subscribeCalls(onChange) {
    const channel = client.channel(`messenger:calls:${++seq}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messenger_calls" }, (payload) => { if (payload.new?.id) onChange(payload.new); })
      .subscribe();
    return () => { client.removeChannel(channel); };
  }

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
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messenger_messages" },
        (payload) => { if (!stopped) onMessage?.(payload.new, "update"); })
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
    async send({ id, conversationId, senderId, body, link, parentId, mentionIds }) {
      const row = { id, conversation_id: conversationId, sender_id: senderId, body };
      if (parentId) row.parent_id = parentId;
      if (mentionIds?.length) row.mention_ids = mentionIds;
      if (link) Object.assign(row, { link_type: link.type, link_ref: link.ref, link_label: link.label });
      const { error } = await client.from("messenger_messages").insert(row);
      if (error && error.code !== "23505") fail("Your message was not sent. Please try again.");
    },
    editMessage: (id, body) => call("messenger_edit_message", { p_message: id, p_body: body }, "Could not save your change. Please try again."),
    deleteMessage: (id) => call("messenger_delete_message", { p_message: id }, "Could not delete this message. Please try again."),
    toggleReaction: (id, emoji) => call("messenger_toggle_reaction", { p_message: id, p_emoji: emoji }, "Could not add your reaction. Please try again."),
    setChatFlags: (conversationId, { muted = null, pinned = null }) => call("messenger_set_chat_flags", { p_conversation: conversationId, p_muted: muted, p_pinned: pinned }, "Could not change this chat. Please try again."),
    search: (query) => call("messenger_search", { p_query: query }, "Could not search your messages. Please try again."),
    activity: () => call("messenger_activity_list", undefined, "Could not load your activity. Please try again."),
    activityRead: (id = null) => call("messenger_activity_read", { p_id: id }, "Could not mark this as read. Please try again."),
    files: () => call("messenger_files", undefined, "Could not load your files. Please try again."),
    presence: () => call("messenger_presence_list", undefined, "Could not load who is available."),
    beat: (status = null) => call("messenger_presence_beat", { p_status: status }, "Could not update your status. Please try again."),
    // Asks the function for a short-lived upload link, stores the file, then the function checks its real size and sends the message.
    async sendFile({ id, conversationId, file, parentId }) {
      const start = await fileCall({ action: "upload_start", conversation_id: conversationId, name: file.name, size: file.size });
      const put = await fetch(start.url, { method: "PUT", body: file, headers: { "Content-Type": file.type || "application/octet-stream" } }).catch(() => null);
      if (!put?.ok) fail("Your file was not uploaded. Please try again.");
      await fileCall({ action: "send_file", message_id: id, conversation_id: conversationId, key: start.key, name: file.name, type: file.type, parent_id: parentId || null });
    },
    fileLink: async (attachmentId) => (await fileCall({ action: "download", attachment_id: attachmentId })).url,
    channelPosts: (conversationId, { before, limit = PAGE } = {}) => call("messenger_channel_posts", { p_conversation: conversationId, p_before: before ?? null, p_limit: limit }, "Could not load the posts. Please try again."),
    async threadReplies(parentId, { before, limit = PAGE } = {}) {
      let q = client.from("messenger_messages").select("*").eq("parent_id", parentId);
      if (before) q = q.lt("created_at", before);
      return rows(await q.order("created_at", { ascending: false }).limit(limit), "Could not load the replies. Please try again.");
    },
    async message(id) {
      return rows(await client.from("messenger_messages").select("*").eq("id", id).maybeSingle(), "Could not open this thread. Please try again.");
    },
    teamList: () => call("messenger_team_list", undefined, "Could not load your teams. Please try again."),
    teamPeople: (teamId) => teamCall("messenger_team_people", { p_team: teamId }, "Could not load the team's people. Please try again."),
    createTeam: (name, description, memberIds) => teamCall("messenger_create_team", { p_name: name, p_description: description, p_members: memberIds }, "Could not create the team. Please try again."),
    updateTeam: (teamId, name, description) => teamCall("messenger_update_team", { p_team: teamId, p_name: name, p_description: description }, "Could not save the team. Please try again."),
    deleteTeam: (teamId) => teamCall("messenger_delete_team", { p_team: teamId }, "Could not delete the team. Please try again."),
    addTeamMembers: (teamId, memberIds) => teamCall("messenger_add_team_members", { p_team: teamId, p_members: memberIds }, "Could not add these people. Please try again."),
    removeTeamMember: (teamId, memberId) => teamCall("messenger_remove_team_member", { p_team: teamId, p_member: memberId }, "Could not remove this person. Please try again."),
    leaveTeam: (teamId) => teamCall("messenger_leave_team", { p_team: teamId }, "Could not leave the team. Please try again."),
    setTeamRole: (teamId, memberId, role) => teamCall("messenger_set_team_role", { p_team: teamId, p_member: memberId, p_role: role }, "Could not change this role. Please try again."),
    createChannel: (teamId, name, visibility, memberIds) => teamCall("messenger_create_channel", { p_team: teamId, p_name: name, p_visibility: visibility, p_members: memberIds }, "Could not create the channel. Please try again."),
    renameChannel: (channelId, name) => teamCall("messenger_rename_channel", { p_channel: channelId, p_name: name }, "Could not rename the channel. Please try again."),
    deleteChannel: (channelId) => teamCall("messenger_delete_channel", { p_channel: channelId }, "Could not delete the channel. Please try again."),
    addChannelMembers: (channelId, memberIds) => teamCall("messenger_add_channel_members", { p_channel: channelId, p_members: memberIds }, "Could not add these people. Please try again."),
    removeChannelMember: (channelId, memberId) => teamCall("messenger_remove_channel_member", { p_channel: channelId, p_member: memberId }, "Could not remove this person. Please try again."),
    leaveChannel: (channelId) => teamCall("messenger_leave_channel", { p_channel: channelId }, "Could not leave the channel. Please try again."),
    startCall: (conversationId, media) => teamCall("messenger_start_call", { p_conversation: conversationId, p_media: media }, "Could not start the call. Please try again."),
    answerCall: (callId) => teamCall("messenger_answer_call", { p_call: callId }, "Could not join the call. Please try again."),
    declineCall: (callId) => call("messenger_decline_call", { p_call: callId }, "Could not decline the call."),
    leaveCall: (callId) => call("messenger_leave_call", { p_call: callId }, "Could not leave the call."),
    callRingTimeout: (callId) => call("messenger_ring_timeout", { p_call: callId }, "Could not end the ringing."),
    callsRinging: () => call("messenger_calls_ringing", undefined, "Could not check for calls."),
    callHistory: () => call("messenger_call_history", undefined, "Could not load your calls. Please try again."),
    callToken: (callId) => callCall({ action: "token", call_id: callId }),
    subscribeCalls,
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
    searchRecords,
    subscribe,
  };
}
