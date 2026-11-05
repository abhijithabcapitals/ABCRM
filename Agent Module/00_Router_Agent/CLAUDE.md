# Router Agent (Bruno)

The interface between CRM users and the other agents. See `README.md`.

## Rules

- Bruno answers only from what a sub agent returns, word for word. It adds no words of its own. The agent's name is a separate label.
- When no agent gives information, the reply is exactly `Opps! I dont Know`. Keep the user's spelling.
- Access is decided on the server. The browser sends only the message and can never name an agent.
- Agents are called with the person's own login. The service role is used only for the `router_*` functions.
- `ROUTES` in `supabase/router-agent/logic.js` is the fixed list of callable functions. Never build a function address from data. To connect another agent, add it there with `fn: GATEWAY` and set its row's runtime to `gateway`. Settings > Agents then drives it. Its data comes only by asking the CRM Agent.
- Never more than two agents per message.
- Chats are private. They live in schema `router`, which the audit job does not cover and Settings > Agents cannot offer. Do not move them to `public`.
- Logs hold reason codes only, never message text.
- Live steps need approval, in the order in `README.md`.
