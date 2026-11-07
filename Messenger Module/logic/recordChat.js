// A CRM record's group chat in Messenger: its name, the key that finds it again, and the open flow.
// The flow takes its services as arguments, so node tests can run it with fakes.

export const OPEN_CHAT_EVENT = "messenger:open-chat";
const PREFIX = "messenger:";
const MAX_TITLE = 80; // messenger_create_group allows 1 to 80 characters

const RECORD_LABELS = { client: "Client", lead: "Lead", task: "Task" };

// "Lead LD-2026-000005 · Al Noor Trading", cut to the length a group name may have.
export function groupTitle({ recordType, id, label }) {
  const name = RECORD_LABELS[recordType];
  if (!name) throw new Error(`Unknown record type: ${recordType}`);
  const extra = String(label ?? "").trim();
  const text = extra ? `${name} ${id} · ${extra}` : `${name} ${id}`;
  return text.length > MAX_TITLE ? `${text.slice(0, MAX_TITLE - 1)}…` : text;
}

// The same people in any order give the same key.
export function memberKey(ids) {
  return [...new Set((ids || []).map((x) => String(x ?? "").trim()).filter(Boolean))].sort().join(",");
}

export function linkReference(conversationId, ids) {
  return `${PREFIX}${conversationId}:${memberKey(ids)}`;
}

// Null for anything that is not a Messenger group link, such as an old Teams link.
export function parseReference(reference) {
  const text = String(reference ?? "");
  if (!text.startsWith(PREFIX)) return null;
  const rest = text.slice(PREFIX.length);
  const cut = rest.indexOf(":");
  if (cut <= 0) return null;
  return { conversationId: rest.slice(0, cut), key: rest.slice(cut + 1) };
}

// The saved links that point at Messenger groups, with their conversation id.
export function messengerLinks(links) {
  return (links || []).flatMap((l) => {
    const parsed = parseReference(l.reference);
    return parsed ? [{ ...l, ...parsed }] : [];
  });
}

// How a saved chat stands for this person, from their chat list: open, archived, or gone (deleted, or they are not in it).
export function savedChatState(link, chats) {
  const row = (chats || []).find((c) => c.id === link.conversationId);
  if (!row) return "gone";
  return row.archived ? "archived" : "open";
}

// Asks the Messenger dock to show a chat.
export function requestOpenChat(conversationId, target = globalThis) {
  target.dispatchEvent?.(new CustomEvent(OPEN_CHAT_EVENT, { detail: { conversationId } }));
}

/**
 * Finds this record's group with exactly these people, or makes one, then posts the message.
 * deps: { chat: { createGroup, members, send, setArchived }, links: { list, save }, newId }
 * A reused group that the person archived comes back out of the archive.
 * Returns { conversationId, created }.
 */
export async function openRecordGroup(deps, { me, memberIds, title, label, message, defaultMessage, link }) {
  if (!me) throw new Error("Sign in first.");
  const others = [...new Set((memberIds || []).filter((x) => x && x !== me))];
  if (others.length === 0) throw new Error("Choose at least one person.");
  const key = memberKey([me, ...others]);

  let conversationId = null;
  for (const saved of messengerLinks(await deps.links.list())) {
    if (saved.key !== key) continue;
    // Someone may have left the group since it was saved. Only reuse it if I am still in it.
    const people = await deps.chat.members(saved.conversationId).catch(() => []);
    if ((people || []).some((p) => p.profile_id === me)) { conversationId = saved.conversationId; break; }
  }

  const created = !conversationId;
  if (!created) await deps.chat.setArchived(conversationId, false);
  if (created) {
    conversationId = await deps.chat.createGroup(title, others);
    await deps.links.save({ reference: linkReference(conversationId, [me, ...others]), label });
  }

  const body = String(message ?? "").trim();
  // A new group starts with the message. An old one only gets it when the person wrote something new.
  if (body && (created || body !== String(defaultMessage ?? "").trim())) {
    await deps.chat.send({ id: deps.newId(), conversationId, senderId: me, body, link });
  }
  return { conversationId, created };
}
