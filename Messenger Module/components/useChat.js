import { useCallback, useEffect, useRef, useState } from "react";
import chatApi from "../services/chatClient.js";
import { totalUnread } from "../logic/chat.js";

// Holds the chat list and the one live subscription for this window.
// A live message from another person, or in an unknown chat, reloads the list so new chats and unread counts appear.
export default function useChat(profileId) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(true);
  const rowsRef = useRef([]);
  const listeners = useRef(new Set());
  const running = useRef(false);
  const again = useRef(false);
  const alive = useRef(true);

  const apply = useCallback((next) => {
    rowsRef.current = next;
    setRows(next);
  }, []);

  // Never runs twice at once: calls during a run make one more run after it, however many arrive.
  const reload = useCallback(async () => {
    if (running.current) { again.current = true; return; }
    running.current = true;
    try {
      do {
        again.current = false;
        try {
          const next = await chatApi.chatList();
          if (!alive.current) return;
          apply(next || []);
          setError("");
        } catch (e) {
          if (alive.current) setError(e.message || "Could not load your chats. Please try again.");
        }
      } while (again.current && alive.current);
    } finally {
      running.current = false;
    }
  }, [apply]);

  const onMessage = useCallback((fn) => {
    listeners.current.add(fn);
    return () => listeners.current.delete(fn);
  }, []);

  useEffect(() => {
    if (!profileId) return undefined;
    alive.current = true;
    reload();
    const stop = chatApi.subscribe(
      (message) => {
        const mine = rowsRef.current.find((r) => r.id === message.conversation_id);
        if (!mine || message.sender_id !== profileId) reload();
        else {
          // My own message in a known chat: move it to the top with the new preview, no reload needed.
          const patched = { ...mine, last_body: message.body, last_link_label: message.link_label || null, last_sender_id: message.sender_id, last_message_at: message.created_at };
          apply([patched, ...rowsRef.current.filter((r) => r.id !== mine.id)]);
        }
        listeners.current.forEach((fn) => fn(message));
      },
      reload,
      (status) => setConnected(status === "up"),
    );
    return () => {
      alive.current = false;
      stop();
    };
  }, [profileId, reload, apply]);

  return { rows, total: error ? 0 : totalUnread(rows), error, connected, reload, onMessage };
}
