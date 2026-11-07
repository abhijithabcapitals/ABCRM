// The client's replies to shared proposals, as one line of activity per proposal. Pure, so it is tested.
// A reply row (hub_proposal_replies, Template Hub 014) comes from the Client Portal or a CRM user; a decision row (business_setup_acceptances)
// is the formal Accept or Reject. Both are read from the proposal itself; nothing here keeps a copy.

const optionName = (options, i) => {
  const o = (options || [])[i];
  return o ? `Option ${i + 1} (${o.authority_name || o.authority_key || "authority"})` : `Option ${Number(i) + 1}`;
};

// One sentence for one entry of the activity line.
export function replyLabel(entry, options) {
  if (!entry) return "";
  if (entry.decision) return entry.decision === "Accepted" ? "Accepted" : "Declined";
  switch (entry.kind) {
    case "option": return `Chose ${optionName(options, entry.option_index)}`;
    case "accepted": return `Accepted ${optionName(options, entry.option_index)}`;
    case "declined": return "Declined";
    case "comment": return "Comment";
    default: return String(entry.kind || "");
  }
}

export const replyTone = (entry) => {
  if (!entry) return undefined;
  if (entry.decision) return entry.decision === "Accepted" ? "good" : "bad";
  return entry.kind === "accepted" ? "good" : entry.kind === "declined" ? "bad" : entry.kind === "option" ? "warn" : undefined;
};

// Who recorded an entry: the client in the portal, or a CRM user (a signed copy staff confirmed is a decision with source Staff).
export const replyBy = (entry) => (entry?.source === "Portal" ? "Client, in the portal" : "Recorded in the CRM");

// The proposal's activity line, oldest first: its replies and its formal decisions together.
export function replyHistory(docId, replies, decisions) {
  const mine = (replies || []).filter((r) => r.quote_id === docId).map((r) => ({ ...r, at: r.created_at }));
  const formal = (decisions || []).filter((a) => a.document_id === docId).map((a) => ({ id: a.id, decision: a.decision, comment: a.note || null, source: a.source, at: a.created_at }));
  return [...mine, ...formal].sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

// The reply to show: a formal decision wins over anything said before it; otherwise the latest reply. A comment after a choice keeps the choice
// in view, so latest is the last non-comment entry and comment the last comment.
export function replyState(doc, history) {
  const h = history || [];
  const decision = [...h].reverse().find((e) => e.decision) || null;
  const latest = decision || [...h].reverse().find((e) => !e.decision && e.kind !== "comment") || null;
  const comment = [...h].reverse().find((e) => e.comment) || null;
  const chosen = doc?.field_values?.proposal?.accepted_option;
  return { latest, comment, chosen: chosen === null || chosen === undefined ? null : Number(chosen), count: h.length };
}

// How a proposal reached the client or lead: by mail, through the portal (it has a client), both, or not yet.
export function sharedVia(doc) {
  const ways = [];
  if (doc?.mail_sent_at) ways.push("mail");
  if (doc?.client_id && ["issued", "accepted", "rejected"].includes(doc.status)) ways.push("portal");
  return ways;
}

// One row per option of every shared proposal, newest proposal first, options in order.
export function sharedOptionRows(proposals) {
  return (proposals || []).filter((d) => sharedVia(d).length > 0).flatMap((d) => {
    const options = d.field_values?.proposal?.options || [];
    return options.map((o, i) => ({ key: `${d.id}-${i}`, id: `${d.id}-${i}`, doc: d, index: i, option: o, first: i === 0, count: options.length }));
  });
}

// The choices the Record reply dialog offers: an option (several), accepted, declined, or a comment. An accepted or chosen option needs one.
export function replyProblem(kind, option, comment, optionCount) {
  if (!["option", "accepted", "declined", "comment"].includes(kind)) return "Choose the reply.";
  if ((kind === "option" || (kind === "accepted" && optionCount > 1)) && (option === "" || option === null || option === undefined)) return "Choose the option.";
  if (kind === "comment" && !String(comment || "").trim()) return "Write the comment.";
  if (String(comment || "").trim().length > 1000) return "Keep the comment to 1000 characters.";
  return null;
}
