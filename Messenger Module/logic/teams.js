// Rules for teams and channels. Pure functions only, no imports.

// One row per channel comes from the database; the screen wants teams holding channels.
export function groupTeams(rows) {
  const teams = new Map();
  for (const r of rows || []) {
    if (!teams.has(r.team_id)) teams.set(r.team_id, { id: r.team_id, name: r.team_name, description: r.description, role: r.team_role, channels: [], unread: 0 });
    const team = teams.get(r.team_id);
    team.channels.push(r);
    if (!r.muted) team.unread += r.unread || 0;
  }
  return [...teams.values()];
}

export const teamsUnread = (rows) => (rows || []).reduce((sum, r) => sum + (r.muted ? 0 : r.unread || 0), 0);

export function checkName(name, what = "name") {
  const text = (name || "").trim();
  if (!text) return `Enter a ${what}.`;
  if (text.length > 80) return `A ${what} can be at most 80 characters.`;
  return null;
}

// What the chat screen needs to show a channel.
export const channelRow = (r, teamName) => ({ id: r.conversation_id, kind: "channel", title: r.channel_name, member_count: r.member_count, muted: r.muted, team_name: teamName, visibility: r.visibility });

export const findChannel = (rows, conversationId) => (rows || []).find((r) => r.conversation_id === conversationId) || null;

// How a post's reply count changes for a live event: one more for a new reply, one fewer when a reply is deleted.
export function replyChange(message, change) {
  if (!message.parent_id) return 0;
  if (!change) return 1;
  return message.deleted_at ? -1 : 0;
}

export function replyLabel(count) {
  if (!(count > 0)) return "Reply in thread";
  return count === 1 ? "1 reply" : `${count} replies`;
}
