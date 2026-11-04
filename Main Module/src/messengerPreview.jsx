// Dev only: the Messenger page on fake data, with no login and no database calls. See messenger-preview.html.
import { createRoot } from "react-dom/client";
import "./index.css";
import "./App.css";
import chatApi from "@messenger/services/chatClient.js";
import MessengerApp from "@messenger/components/MessengerApp.jsx";
import CallHost from "@messenger/components/CallHost.jsx";
import callRoom from "@messenger/services/callRoom.js";
import inboxApi from "@messenger/services/inboxClient.js";

const state = new URLSearchParams(location.search).get("state");
const me = { id: "me", full_name: "Preview Person", role: new URLSearchParams(location.search).get("role") || "admin" };
const at = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
const LONG = "A very long group name that keeps going to test how the list copes";
const ROWS = [
  { id: "c1", kind: "direct", other_name: "Sample Colleague", other_id: "p1", member_count: 2, last_body: "The draft is ready for review.", last_sender_id: "p1", last_sender_name: "Sample Colleague", last_message_at: at(5), unread: 2 },
  { id: "c2", kind: "group", title: "Banking team", member_count: 4, last_body: "Noted, thanks.", last_sender_id: "me", last_sender_name: me.full_name, last_message_at: at(90), unread: 0 },
  { id: "c3", kind: "group", title: state === "long" ? LONG : "Tax desk", member_count: 3, last_body: state === "long" ? "Long preview text ".repeat(20) : "See you at ten.", last_sender_id: "p2", last_sender_name: "Sample Two", last_message_at: at(4000), unread: state === "long" ? 120 : 0 },
];
const MESSAGES = [{ id: "m1", conversation_id: "c1", sender_id: "p1", sender_name: "Sample Colleague", body: "The draft is ready for review.", created_at: at(5) }];

chatApi.chatList = () => {
  if (state === "error") return Promise.reject(new Error("Could not load your chats. Please try again."));
  if (state === "loading") return new Promise(() => {});
  return Promise.resolve(state === "empty" ? [] : ROWS.map((r) => ({ ...r })));
};
// ?desktop=1 pretends to be the Windows app and records what would reach Windows.
if (new URLSearchParams(location.search).has("desktop")) {
  window.__NATIVE_CALLS = [];
  window.__TAURI__ = {
    core: { invoke: async (name, args) => { window.__NATIVE_CALLS.push([name, args]); return name === "autostart_get" ? false : name === "app_version" ? "0.1.0" : name === "start_links" ? [] : null; } },
    event: { listen: async () => () => {} },
  };
}
chatApi.subscribe = (onMessage) => { window.__emitMessage = onMessage; return () => {}; };
const REACTIONS = {};
let ACTIVITY = state === "empty" ? [] : [
  { id: "a1", kind: "mention", actor_name: "Sample Colleague", conversation_id: "c1", message_id: "m1", preview: "Please review this, @Preview Person", read_at: null, created_at: at(5) },
  { id: "a3", kind: "reply", actor_name: "Sample Two", conversation_id: "cc1", message_id: "r1", parent_id: "p1", conversation_kind: "channel", conversation_title: "General", preview: "One note on page two.", read_at: null, created_at: at(50) },
  { id: "a2", kind: "reaction", actor_name: "Sample Two", detail: "👍", conversation_id: "c3", message_id: "m9", preview: "See you at ten.", read_at: at(1), created_at: at(4000) },
];
const FILES = state === "empty" ? [] : [{ id: "f1", conversation_id: "c2", file_name: "Sample plan.pdf", content_type: "application/pdf", size_bytes: 248000, uploader_name: "Sample Two", created_at: at(90) }];
chatApi.send = async () => {};
// The Inbox on fake mail: ?mail=none has no mailbox, ?mail=error fails. Nothing touches the mail store.
const mailMode = new URLSearchParams(location.search).get("mail");
const BOXES = [{ id: "b1", address: "info@sample.test", last_error: null }, { id: "b2", address: "sales@sample.test", last_error: "Timed out" }];
let THREADS = [
  { id: "m1", mailbox_id: "b1", subject: "Licence renewal documents", participants: ["info@sample.test", "Sample Client <client@sample.test>"], last_message_at: at(20), message_count: 2, status: "new" },
  { id: "m2", mailbox_id: "b2", subject: "Quote request", participants: ["sales@sample.test", "buyer@sample.test"], last_message_at: at(300), message_count: 1, status: "read" },
  { id: "m3", mailbox_id: "b1", subject: "Old newsletter", participants: ["news@sample.test"], last_message_at: at(9000), message_count: 1, status: "archived" },
];
const fail = () => { if (mailMode === "error") throw new Error("Could not load your mail. Please try again."); };
inboxApi.mailboxes = async () => { fail(); return mailMode === "none" ? [] : BOXES; };
inboxApi.threads = async ({ mailboxId, archived, query } = {}) => { fail(); return THREADS.filter((t) => (archived ? t.status === "archived" : t.status !== "archived") && (!mailboxId || t.mailbox_id === mailboxId) && (!query || t.subject.toLowerCase().includes(query.trim().toLowerCase()))).map((t) => ({ ...t })); };
// Connected channels on fake data: ?channels=none starts with nothing connected.
let LINKED = new URLSearchParams(location.search).get("channels") === "none" ? [] : [{ id: "acc1", channel: "whatsapp", label: "Sales line", external_id: "pn1", display_name: "Sample Co", last_event_at: at(10), people: ["me"] }, { id: "acc2", channel: "telegram", label: "Support bot", external_id: "42", display_name: "@sample_bot", last_event_at: null, people: ["me"] }];
let LIVE_THREADS = [
  { id: "lt1", account_id: "acc1", external_id: "971500000001", contact_name: "Sample Buyer", status: "new", assigned_to: null, last_preview: "Is the licence ready?", last_message_at: at(10), last_inbound_at: at(10), channel: "whatsapp" },
  { id: "lt2", account_id: "acc1", external_id: "971500000002", contact_name: null, status: "read", assigned_to: null, last_preview: "Thanks", last_message_at: at(4000), last_inbound_at: at(4000), channel: "whatsapp" },
];
const LIVE_MSGS = { lt1: [{ id: "lm1", direction: "in", body: "Is the licence ready?", status: "received", created_at: at(10) }], lt2: [{ id: "lm2", direction: "in", body: "Thanks", status: "received", created_at: at(4000) }] };
inboxApi.channelAccounts = async () => LINKED.map(({ id, channel, label, display_name }) => ({ id, channel, label, display_name }));
inboxApi.channelThreads = async (channel) => LIVE_THREADS.filter((t) => t.channel === channel && t.status !== "archived").map((t) => ({ ...t }));
inboxApi.channelMessages = async (id) => [...(LIVE_MSGS[id] || [])];
inboxApi.channelSend = async (id, body) => { if (body === "fail") throw new Error("The platform did not accept this. Check the details and try again."); (LIVE_MSGS[id] ||= []).push({ id: `o${Date.now()}`, direction: "out", body, status: "sent", created_at: at(0) }); };
inboxApi.channelStatus = async (id, status) => { LIVE_THREADS = LIVE_THREADS.map((t) => (t.id === id ? { ...t, status } : t)); };
inboxApi.channelAssign = async (id, person) => { LIVE_THREADS = LIVE_THREADS.map((t) => (t.id === id ? { ...t, assigned_to: person } : t)); };
inboxApi.channelUnread = async () => LIVE_THREADS.filter((t) => t.status === "new").length;
inboxApi.subscribeInbox = () => () => {};
inboxApi.adminAccounts = async () => LINKED.map((a) => ({ ...a }));
inboxApi.setAccountPeople = async (id, people) => { LINKED = LINKED.map((a) => (a.id === id ? { ...a, people } : a)); };
inboxApi.connectAccount = async ({ channel, label, token }) => { window.__lastToken = token; if (token === "bad") throw new Error("The platform did not accept this. Check the details and try again."); LINKED = [...LINKED, { id: `n${Date.now()}`, channel, label, external_id: "9", display_name: null, last_event_at: null, people: ["me"] }]; return channel === "telegram" ? { account_id: "x" } : { account_id: "x", webhook_url: "https://sample.invalid/functions/v1/messenger-inbox?account=x", verify_token: "sampleverify" }; };
inboxApi.accountInfo = async () => ({ webhook_url: "https://sample.invalid/functions/v1/messenger-inbox?account=acc1", verify_token: "sampleverify" });
inboxApi.testAccount = async () => ({ ok: true });
inboxApi.disconnectAccount = async (id) => { const was = LINKED.find((a) => a.id === id); LINKED = LINKED.filter((a) => a.id !== id); return { ok: true, meta_webhook_left: was?.channel !== "telegram" }; };
inboxApi.staffList = async () => [{ id: "me", full_name: me.full_name }, { id: "p1", full_name: "Sample Colleague" }];
inboxApi.newCount = async () => THREADS.filter((t) => t.status === "new").length;
inboxApi.setStatus = async (id, status) => { THREADS = THREADS.map((t) => (t.id === id ? { ...t, status } : t)); };
inboxApi.messages = async (id) => (id === "m2"
  ? [{ id: "x2", from_address: "buyer@sample.test", to_addresses: ["sales@sample.test"], sent_at: at(300), body_text: "", body_html: '<p id="html-body">Please quote.</p><img src="https://track.invalid/p.gif"><script>parent.__mailScriptRan = true</script>', body_complete: true }]
  : [{ id: "x1", from_name: "Sample Client", from_address: "client@sample.test", to_addresses: ["info@sample.test"], cc_addresses: ["boss@sample.test"], sent_at: at(30), body_text: "Attached are the documents.", body_complete: true, attachment_count: 1 }, { id: "x3", direction: "outbound", from_address: "info@sample.test", to_addresses: ["client@sample.test"], sent_at: at(20), body_text: "Thanks, received.", body_complete: false }]);
inboxApi.attachments = async () => [{ id: "f1", message_id: "x1", filename: "licence.pdf", size_bytes: 52000, storage_path: "p" }];
inboxApi.attachmentLink = async () => { throw new Error("Could not open this attachment. Please try again."); };
const nothing = new Proxy(function () {}, { get: (_t, name) => (name === "then" ? (ok) => ok({ data: [], error: null }) : () => nothing) });
inboxApi.composerClient = { auth: { getSession: async () => ({ data: { session: null } }) }, functions: { invoke: async () => ({ data: { error: "This is the preview, so nothing can be sent." }, error: null }) }, storage: nothing, from: () => nothing, schema: () => nothing };
// Calls on fake data: ?call=incoming rings once, and the room is a stand-in, so no media or server is involved.
let RINGING = new URLSearchParams(location.search).get("call") === "incoming" ? [{ id: "in1", conversation_id: "c1", media: "video", caller_name: "Sample Colleague", conversation_kind: "direct", started_at: at(0) }] : [];
const callEvents = [];
chatApi.subscribeCalls = (fn) => { callEvents.push(fn); window.__emitCall = (row) => callEvents.forEach((f) => f(row)); return () => {}; };
chatApi.callsRinging = async () => RINGING;
chatApi.startCall = async (id, media) => { if (id === "c3") throw new Error("There is nobody else in this chat to call"); return [{ call_id: `out-${media}`, joined_existing: false }]; };
chatApi.answerCall = async () => { RINGING = []; };
chatApi.declineCall = async () => { RINGING = []; };
chatApi.leaveCall = async (id) => { (window.__callsLeft ||= []).push(id); };
chatApi.callRingTimeout = async () => {};
chatApi.callToken = async () => { if (new URLSearchParams(location.search).get("call") === "unset") throw new Error("Calls are not set up yet."); return { url: "wss://fake", token: "fake" }; };
chatApi.callHistory = async () => (state === "empty" ? [] : [
  { id: "h1", conversation_id: "c1", conversation_kind: "direct", other_name: "Sample Colleague", media: "audio", status: "missed", started_by_me: false, my_state: "missed", started_at: at(30) },
  { id: "h2", conversation_id: "c2", conversation_kind: "group", conversation_title: "Banking team", media: "video", status: "ended", started_by_me: true, my_state: "left", started_at: at(200), answered_at: at(200), ended_at: at(190) },
]);
callRoom.connect = async ({ media, onChange }) => {
  const s = { status: "connected", others: 1, mic: true, camera: media === "video", sharing: false };
  const tiles = () => [
    ...(s.sharing ? [{ id: "me:screen", name: me.full_name, local: true, screen: true, attach: null }] : []),
    { id: "me:camera", name: me.full_name, local: true, muted: !s.mic, attach: null },
    { id: "p1:camera", name: "Sample Colleague", speaking: true, attach: null },
  ];
  const emit = () => onChange({ ...s, tiles: tiles() });
  emit();
  const set = (key) => async (on) => { s[key] = on; emit(); };
  return { setMic: set("mic"), setCamera: set("camera"), setSharing: set("sharing"), devices: async (k) => [{ deviceId: "d1", label: `Sample ${k}` }], setDevice: async () => {}, leave: async () => {} };
};
let TEAM_ROWS = state === "empty" ? [] : [
  { team_id: "t1", team_name: state === "long" ? LONG : "Tax desk", description: "Returns and filings", team_role: "owner", channel_id: "ch1", channel_name: "General", visibility: "standard", is_general: true, conversation_id: "cc1", member_count: 3, unread: 3, muted: false },
  { team_id: "t1", team_name: state === "long" ? LONG : "Tax desk", description: "Returns and filings", team_role: "owner", channel_id: "ch2", channel_name: "Partners only", visibility: "private", is_general: false, conversation_id: "cc2", member_count: 2, unread: 0, muted: false },
  { team_id: "t2", team_name: "Banking", description: null, team_role: "member", channel_id: "ch3", channel_name: "General", visibility: "standard", is_general: true, conversation_id: "cc3", member_count: 5, unread: 0, muted: true },
];
const POSTS = { cc1: [{ id: "p1", conversation_id: "cc1", sender_id: "p1", body: "Q4 filing plan is ready for comment.", created_at: at(60), reply_count: 2 }, { id: "p2", conversation_id: "cc1", sender_id: "me", body: "Thanks all.", created_at: at(30), reply_count: 0 }] };
const REPLIES = { p1: [{ id: "r2", conversation_id: "cc1", parent_id: "p1", sender_id: "me", body: "Looks right to me.", created_at: at(40) }, { id: "r1", conversation_id: "cc1", parent_id: "p1", sender_id: "p2", body: "One note on page two.", created_at: at(50) }] };
chatApi.teamList = async () => { if (state === "error") throw new Error("Could not load your teams. Please try again."); if (state === "loading") return new Promise(() => {}); return TEAM_ROWS.map((r) => ({ ...r })); };
chatApi.channelPosts = async (id, opts = {}) => (opts.before ? [] : [...(POSTS[id] || [])].reverse());
chatApi.threadReplies = async (id, opts = {}) => (opts.before ? [] : REPLIES[id] || []);
chatApi.message = async (id) => POSTS.cc1.find((m) => m.id === id) || null;
chatApi.teamPeople = async () => [{ profile_id: "me", full_name: me.full_name, role: "owner" }, { profile_id: "p1", full_name: "Sample Colleague", role: "member" }];
chatApi.createTeam = async (name) => {
  if (name === "Taken") throw new Error("A name must be 1 to 80 characters");
  TEAM_ROWS = [...TEAM_ROWS, { team_id: name, team_name: name, description: null, team_role: "owner", channel_id: `g-${name}`, channel_name: "General", visibility: "standard", is_general: true, conversation_id: `g-${name}`, member_count: 1, unread: 0, muted: false }];
};
chatApi.updateTeam = async () => {};
chatApi.deleteTeam = async (id) => { TEAM_ROWS = TEAM_ROWS.filter((r) => r.team_id !== id); };
chatApi.leaveTeam = chatApi.deleteTeam;
chatApi.addTeamMembers = async () => {};
chatApi.removeTeamMember = async () => {};
chatApi.setTeamRole = async () => { throw new Error("A team needs at least one owner"); };
chatApi.createChannel = async (team, name, visibility) => {
  const base = TEAM_ROWS.find((r) => r.team_id === team);
  TEAM_ROWS = [...TEAM_ROWS, { ...base, channel_id: `x-${name}`, channel_name: name, visibility, is_general: false, conversation_id: `x-${name}`, unread: 0 }];
};
chatApi.renameChannel = async (id, name) => { TEAM_ROWS = TEAM_ROWS.map((r) => (r.channel_id === id ? { ...r, channel_name: name } : r)); };
chatApi.deleteChannel = async (id) => { TEAM_ROWS = TEAM_ROWS.filter((r) => r.channel_id !== id); };
chatApi.leaveChannel = chatApi.deleteChannel;
chatApi.addChannelMembers = async () => {};
chatApi.removeChannelMember = async () => {};
chatApi.editMessage = async () => {};
chatApi.deleteMessage = async () => {};
chatApi.toggleReaction = async (id, emoji) => {
  const who = REACTIONS[emoji] || [];
  REACTIONS[emoji] = who.includes(me.id) ? who.filter((x) => x !== me.id) : [...who, me.id];
  if (!REACTIONS[emoji].length) delete REACTIONS[emoji];
  return { ...REACTIONS };
};
chatApi.setChatFlags = async (id, change) => { Object.assign(ROWS.find((r) => r.id === id), change); };
chatApi.search = async (q) => (q.toLowerCase().startsWith("draft") ? [{ message_id: "m1", conversation_id: "c1", body: MESSAGES[0].body, sender_name: "Sample Colleague", created_at: at(5) }] : []);
chatApi.activity = async () => { if (state === "error") throw new Error("Could not load your activity. Please try again."); return ACTIVITY; };
chatApi.activityRead = async (id) => { ACTIVITY = ACTIVITY.map((a) => (!id || a.id === id ? { ...a, read_at: at(0) } : a)); };
chatApi.files = async () => { if (state === "error") throw new Error("Could not load your files. Please try again."); return FILES; };
let MY_STATUS = "available";
chatApi.beat = async (s) => { if (s) MY_STATUS = s; };
chatApi.presence = async () => [{ profile_id: "me", status: MY_STATUS, last_seen_at: at(0) }, { profile_id: "p1", status: "busy", last_seen_at: at(1) }];
chatApi.sendFile = async () => { throw new Error("File sharing is not set up yet."); };
chatApi.messages = async () => MESSAGES;
chatApi.readState = async () => null;
chatApi.markRead = async () => null;
chatApi.members = async () => [{ profile_id: "me", full_name: me.full_name }, { profile_id: "p1", full_name: "Sample Colleague" }, { profile_id: "p2", full_name: "Sample Two" }];
chatApi.staff = async () => [{ id: "p1", full_name: "Sample Colleague" }];

createRoot(document.getElementById("root")).render(
  <div className="app-layout">
    <CallHost profile={me} />
    <div className="app-body">
      <main className="app-main"><MessengerApp profile={me} /></main>
    </div>
  </div>,
);
