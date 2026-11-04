import { useEffect, useRef } from "react";
import { chatTitle } from "../logic/chat.js";
import { notificationText, parseAppLink, readPrefs, shouldNotify } from "../logic/desktop.js";
import { isDesktop, notify, onAppLink, setUnread, takeStartLinks } from "../services/desktop.js";

// Everything the Windows app adds to the page: the tray's unread count, notifications and links from outside. Does nothing in a browser.
export default function useDesktop({ me, unread, chats, channels, status, onMessage, openResult }) {
  const latest = useRef(null);
  useEffect(() => { latest.current = { chats, channels, status, openResult }; });

  useEffect(() => { if (isDesktop()) setUnread(unread); }, [unread]);

  useEffect(() => {
    if (!isDesktop()) return undefined;
    return onMessage((message, change) => {
      const now = latest.current;
      const chat = now.chats.find((r) => r.id === message.conversation_id);
      const channel = now.channels.find((r) => r.conversation_id === message.conversation_id);
      const prefs = readPrefs();
      const focused = document.hasFocus() && document.visibilityState === "visible";
      if (!shouldNotify({ message, change, me, muted: chat?.muted || channel?.muted, focused, status: now.status, prefs })) return;
      const title = chat ? chatTitle(chat) : channel?.channel_name;
      const text = notificationText({ message, title, prefs });
      notify(text.title, text.body);
    });
  }, [me, onMessage]);

  useEffect(() => {
    if (!isDesktop()) return undefined;
    const open = (link) => {
      const target = parseAppLink(link);
      if (target) latest.current.openResult(target);
    };
    takeStartLinks().then((links) => links.forEach(open));
    return onAppLink(open);
  }, []);
}
