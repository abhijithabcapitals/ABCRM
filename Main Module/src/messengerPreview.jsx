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
  return Promise.resolve(state === "empty" ? [] : ROWS);
};
chatApi.subscribe = () => () => {};
chatApi.messages = async () => MESSAGES;
chatApi.readState = async () => null;
chatApi.markRead = async () => null;
chatApi.members = async () => [];
chatApi.staff = async () => [{ id: "p1", full_name: "Sample Colleague" }];

createRoot(document.getElementById("root")).render(
  <div className="app-layout">
    <div className="app-body">
      <main className="app-main"><MessengerApp profile={me} /></main>
    </div>
  </div>,
);
