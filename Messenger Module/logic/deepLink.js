// Builds Microsoft Teams chat deep links and the reference text sent with them.
// Pure functions only. No client data beyond what the caller passes in.

export const MAX_MESSAGE = 800;

const TEAMS_CHAT_URL = "https://teams.microsoft.com/l/chat/0/0";

const RECORD_LABELS = { client: "Client", lead: "Lead", task: "Task" };

function cleanEmails(emails) {
  const seen = new Set();
  const out = [];
  for (const raw of emails || []) {
    const email = String(raw ?? "").trim().toLowerCase();
    if (email && !seen.has(email)) {
      seen.add(email);
      out.push(email);
    }
  }
  return out;
}

export function buildChatLink({ emails, topic, message } = {}) {
  const users = cleanEmails(emails);
  if (users.length === 0) {
    throw new Error("A chat needs at least one person.");
  }

  const params = new URLSearchParams();

  // A topic only applies to group chats.
  if (users.length > 1 && topic && String(topic).trim()) {
    params.set("topicName", String(topic).trim());
  }

  if (message) {
    params.set("message", String(message).slice(0, MAX_MESSAGE));
  }

  // Microsoft's form: spaces as %20 and users separated by literal commas.
  const query = params.toString().replace(/\+/g, "%20");
  return `${TEAMS_CHAT_URL}?users=${users.map(encodeURIComponent).join(",")}${query ? "&" + query : ""}`;
}

export function referenceText({ recordType, id, label }) {
  const name = RECORD_LABELS[recordType];
  if (!name) {
    throw new Error(`Unknown record type: ${recordType}`);
  }
  const text = String(label ?? "").trim();
  return text ? `${name} ${id}: ${text}` : `${name} ${id}`;
}

export function participantsKey(emails) {
  return cleanEmails(emails).sort().join(",");
}
