// Dev only: the Messenger page on fake data, with no login and no database calls. See messenger-preview.html.
import { createRoot } from "react-dom/client";
import "./index.css";
import "./App.css";
import chatApi from "@messenger/services/chatClient.js";
import MessengerApp from "@messenger/components/MessengerApp.jsx";

const state = new URLSearchParams(location.search).get("state");
const me = { id: "me", full_name: "Preview Person" };
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
chatApi.subscribe = () => () => {};
const REACTIONS = {};
let ACTIVITY = state === "empty" ? [] : [
  { id: "a1", kind: "mention", actor_name: "Sample Colleague", conversation_id: "c1", message_id: "m1", preview: "Please review this, @Preview Person", read_at: null, created_at: at(5) },
  { id: "a3", kind: "reply", actor_name: "Sample Two", conversation_id: "cc1", message_id: "r1", parent_id: "p1", conversation_kind: "channel", conversation_title: "General", preview: "One note on page two.", read_at: null, created_at: at(50) },
  { id: "a2", kind: "reaction", actor_name: "Sample Two", detail: "👍", conversation_id: "c3", message_id: "m9", preview: "See you at ten.", read_at: at(1), created_at: at(4000) },
];
const FILES = state === "empty" ? [] : [{ id: "f1", conversation_id: "c2", file_name: "Sample plan.pdf", content_type: "application/pdf", size_bytes: 248000, uploader_name: "Sample Two", created_at: at(90) }];
chatApi.send = async () => {};
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
    <div className="app-body">
      <main className="app-main"><MessengerApp profile={me} /></main>
    </div>
  </div>,
);
