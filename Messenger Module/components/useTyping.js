import { useCallback, useEffect, useRef, useState } from "react";
import chatApi from "../services/chatClient.js";

const SEND_EVERY_MS = 3000;
const CLEAR_AFTER_MS = 5000; // someone whose signal stops, such as a closed window, drops off by itself

// Who is typing in one chat, and how to tell the others that this person is.
export default function useTyping(cid, me, enabled) {
  const [ids, setIds] = useState([]);
  const channel = useRef(null);
  const timers = useRef(new Map());
  const lastSent = useRef(0);

  const drop = useCallback((id) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur));
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const running = timers.current;
    const live = chatApi.typingChannel(cid, ({ id, typing }) => {
      if (!id || id === me) return;
      if (!typing) { drop(id); return; }
      clearTimeout(running.get(id));
      running.set(id, setTimeout(() => drop(id), CLEAR_AFTER_MS));
      setIds((cur) => (cur.includes(id) ? cur : [...cur, id]));
    });
    channel.current = live;
    return () => {
      live.stop();
      channel.current = null;
      running.forEach((t) => clearTimeout(t));
      running.clear();
      setIds([]);
    };
  }, [cid, me, enabled, drop]);

  // Called on each key press. At most one signal every few seconds goes out.
  const notify = useCallback((typing) => {
    const now = Date.now();
    if (typing) {
      if (now - lastSent.current < SEND_EVERY_MS) return;
      lastSent.current = now;
      channel.current?.send({ id: me, typing: true });
    } else if (lastSent.current) {
      lastSent.current = 0;
      channel.current?.send({ id: me, typing: false });
    }
  }, [me]);

  return { ids, notify, drop };
}
