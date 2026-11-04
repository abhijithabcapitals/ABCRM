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
  { id: "a2", kind: "reaction", actor_name: "Sample Two", detail: "👍", conversation_id: "c3", message_id: "m9", preview: "See you at ten.", read_at: at(1), created_at: at(4000) },
];
const FILES = state === "empty" ? [] : [{ id: "f1", conversation_id: "c2", file_name: "Sample plan.pdf", content_type: "application/pdf", size_bytes: 248000, uploader_name: "Sample Two", created_at: at(90) }];
chatApi.send = async () => {};
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
