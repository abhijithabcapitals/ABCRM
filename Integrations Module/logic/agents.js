// Rules and help text for Settings > Agents. Kept apart from the screen so they can be tested on their own.

export const MODELS = {
  anthropic: [
    { id: "claude-haiku-5-5", note: "Fastest and cheapest. Good for simple questions." },
    { id: "claude-sonnet-5-5", note: "Balanced. A good default for most agents." },
    { id: "claude-opus-5-5", note: "Strong and more expensive. Good for hard work and code." },
    { id: "claude-fable-5-1", note: "Most capable and most expensive." },
  ],
  openrouter: [{ id: "deepseek/deepseek-v4.1-flash", note: "The low-cost model most agents use today." }],
};

export const RUNTIME = {
  not_connected: { label: "Not connected", bg: "#f3f4f6", color: "#4b5563", note: "These settings are saved, but this agent does not run yet. It needs the agent gateway and its own tools." },
  own_code: { label: "Runs on its own code", bg: "#e0f2fe", color: "#075985", note: "This agent already runs on its own code, which does not read these settings yet. Changes here do not affect it today." },
  gateway: { label: "Connected", bg: "#dcfce7", color: "#15803d", note: "This agent runs in the chat through Bruno and uses these settings." },
};

// Facts about one agent that the runtime note above does not cover.
export const AGENT_NOTES = {
  "AGT-00-ORCHESTRATOR": "Bruno sends each question to at most two sub agents and returns their reply word for word. Instructions and Extra content here become its routing rules. People need no tick for Bruno itself. Knowledge and Database access are not used.",
  "AGT-14-CRM": "Sub agents ask this agent for data. It reads what the person asking may see, and a sub agent gets only the tables in that sub agent's Database access. The Database access list here is not used.",
  "AGT-05-BIZDEV": "These settings apply in the Bruno chat. The Agent panel inside Business Development still runs on its own code.",
  "AGT-13-EMAIL": "These settings apply in the Bruno chat. Background mail summaries still run on their own code.",
};

export const CREDIT_STEP = 5;

export const HELP = {
  enabled: "Turn on to let this agent run once it is connected. Keep it off while you are still setting it up.",
  name: "The name staff see for this agent, for example Tax Assistant.",
  role: "One or two sentences on what this agent is for. It helps people, and the agent, understand its job.",
  instructions: "What the agent must do and how it should behave. Write it as you would brief a new employee. Do not put passwords or keys here, because this text is not encrypted.",
  knowledge: "Tick the Knowledge tab categories this agent may use. Add or edit the articles themselves in the Knowledge tab.",
  extra_content: "Extra facts only this agent needs, such as a policy or price list. Paste plain text. Do not paste passwords or keys.",
  tables: "The tables this agent may ask the CRM Agent about. None: cannot see the table. Read: can look. Sub agents only read today, so Read & change works the same as Read. The person asking must also have access to the data. Tables holding passwords or tokens are never listed.",
  provider: "The company that supplies the AI. Agents in the Bruno chat use OpenRouter, which offers many models, Claude included. Your Team plan's monthly API credits apply only to a key from your linked Claude Console organization.",
  model: "Which AI model answers. Pick from the list or type a model name. Better models cost more per message.",
  api_key: "Optional. Get a key at platform.claude.com under API keys, or at openrouter.ai under Keys. Leave empty to use the shared key in Settings > Integrations. Once saved, nobody can read it back; you can only replace or remove it.",
  budget: "The most this agent may spend in a month, in US dollars. Leave empty for no agent cap; each person's credit still applies.",
  users: "Only people ticked here can use this agent. Everyone else cannot see or call it. Admins must tick themselves too.",
  approval: "Actions this agent must not take alone, one per line. A person must approve each one first.",
  notes: "Your own notes. The agent does not read them.",
  credit: "The most this person may spend across all agents in a month, in US dollars. Zero means they cannot run paid calls. Use the buttons to increase or decrease it, or type a new amount.",
};

export const agentKeyName = (id) => `AGENT_KEY_${id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;

export function groupAgents(agents) {
  const groups = new Map();
  for (const a of [...agents].sort((x, y) => x.sort_order - y.sort_order)) {
    if (!groups.has(a.group_name)) groups.set(a.group_name, []);
    groups.get(a.group_name).push(a);
  }
  return [...groups].map(([name, items]) => ({ name, items }));
}

const money = (n) => Math.round(Number(n) * 100) / 100;

export const stepCredit = (current, delta) => Math.max(0, money((Number(current) || 0) + delta));

export const creditLeft = (credit, used) => money((Number(credit) || 0) - (Number(used) || 0));

export const tableKey = (schema, table) => `${schema}.${table}`;

// Turns the screen's { "schema.table": "read" } into the rows the save function takes. None is simply left out.
export function tablesPayload(levels, tables) {
  return tables
    .map((t) => ({ schema_name: t.schema_name, table_name: t.table_name, level: levels[tableKey(t.schema_name, t.table_name)] }))
    .filter((t) => t.level === "read" || t.level === "write");
}

export function draftError(d) {
  if (!d.name?.trim()) return "Enter a name.";
  if (!d.model?.trim()) return "Choose a model.";
  if (d.runtime === "gateway" && d.provider !== "openrouter") return "Agents in the Bruno chat run on OpenRouter. Choose OpenRouter.";
  const budget = String(d.monthly_budget_usd ?? "").trim();
  if (budget && !(Number(budget) >= 0)) return "The monthly budget must be a number, zero or more.";
  return "";
}
