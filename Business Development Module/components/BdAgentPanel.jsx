import { useEffect, useRef, useState } from "react";
import { callBdAgent } from "../logic/businessDevelopmentData";
import BdMiniCalendar from "./BdMiniCalendar";

// Right-side BD Agent panel. Advice and drafts only: nothing here writes to the CRM or sends a message.
const LEAD_PROMPTS = [
  ["Triage this lead", "lead-triage", "Triage this lead: ICP fit, priority, and the recommended next action."],
  ["Draft follow-up", "draft-outreach", "Draft my next follow-up email to this lead based on the latest discussion."],
  ["Prepare call", "call-prep", "Prepare me for the next call with this lead: goals, discovery questions, risks."],
  ["Handle objection", "handle-objection", "The lead says our fee is too high. How should I respond?"],
];
const GENERAL_PROMPTS = [
  ["Pipeline review", "pipeline-review", "What should I focus on in my pipeline this week, and how do I prioritise follow-ups?"],
  ["Cold email", "cold-email", "Write a short cold email to a UAE SME owner about Corporate Tax registration and compliance support."],
  ["Lead magnet ideas", "lead-magnets", "Suggest lead magnets that would attract UAE businesses needing VAT and Corporate Tax help."],
  ["Define our ICP", "sales-icp-definition", "Help me define our ideal customer profile for accounting and tax advisory services in the UAE."],
];

function renderText(text) {
  // Fenced blocks become copyable drafts; everything else keeps its line breaks.
  return text.split(/```[a-z]*\n?/i).map((part, index) => (index % 2
    ? <pre key={index} className="bd-agent-draft"><button type="button" onClick={() => navigator.clipboard?.writeText(part.trim())}>Copy</button>{part.trim()}</pre>
    : <span key={index}>{part.replace(/\*\*(.+?)\*\*/g, "$1")}</span>));
}

export default function BdAgentPanel({ lead, page, onClose, followups, onOpenLead, onOpenCalendar }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [skill, setSkill] = useState("");
  const [skills, setSkills] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef(null);
  const leadId = lead?.id || null;

  useEffect(() => {
    callBdAgent("skills").then(({ data }) => setSkills(data?.skills || []));
  }, []);
  useEffect(() => { setMessages([]); setError(""); }, [leadId]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages, busy]);

  async function ask(text, chosenSkill = skill) {
    const question = text.trim();
    if (!question || busy) return;
    const next = [...messages, { role: "user", content: question }];
    setMessages(next);
    setInput("");
    setError("");
    setBusy(true);
    const { data, error: callError } = await callBdAgent("chat", {
      messages: next.map(({ role, content }) => ({ role, content })),
      lead_id: leadId, skill: chosenSkill || undefined, page,
    });
    setBusy(false);
    if (callError) { setError(callError.message); return; }
    setMessages([...next, { role: "assistant", content: data.reply, skill: data.skill }]);
  }

  const prompts = lead ? LEAD_PROMPTS : GENERAL_PROMPTS;
  return (
    <aside className="bd-agent" aria-label="Business Development Agent">
      <header className="bd-agent-head">
        <div>
          <strong>BD Agent</strong>
          <small>{lead ? `${lead.lead_id} · ${lead.name}` : page}</small>
        </div>
        <div className="bd-agent-head-actions">
          {messages.length > 0 && <button type="button" onClick={() => { setMessages([]); setError(""); }} title="New conversation">New</button>}
          <button type="button" onClick={onClose} aria-label="Close BD Agent">×</button>
        </div>
      </header>

      <BdMiniCalendar followups={followups} onOpenLead={onOpenLead} onOpenCalendar={onOpenCalendar} />

      <div className="bd-agent-body">
        {messages.length === 0 && (
          <div className="bd-agent-intro">
            <p>{lead ? "Ask about this lead. The agent reads its record, discussions and follow-ups." : "Ask about lead generation, outreach, replies, proposals or your pipeline. Open a lead to get advice on it."}</p>
            <div className="bd-agent-chips">
              {prompts.map(([label, name, text]) => <button key={label} type="button" onClick={() => ask(text, name)}>{label}</button>)}
            </div>
          </div>
        )}
        {messages.map((message, index) => (
          <div key={index} className={`bd-agent-msg bd-agent-${message.role}`}>
            {message.skill && <span className="bd-agent-skill">{message.skill}</span>}
            <div className="bd-agent-text">{message.role === "assistant" ? renderText(message.content) : message.content}</div>
          </div>
        ))}
        {busy && <div className="bd-agent-msg bd-agent-assistant"><span className="bd-spinner" /> Thinking…</div>}
        {error && <div className="bd-alert bd-alert-error" role="alert"><span>{error}</span></div>}
        <div ref={endRef} />
      </div>

      <form className="bd-agent-input" onSubmit={(event) => { event.preventDefault(); ask(input); }}>
        <select aria-label="Skill" value={skill} onChange={(event) => setSkill(event.target.value)}>
          <option value="">Skill: automatic</option>
          {skills.map((item) => <option key={item.name} value={item.name} title={item.description}>{item.name}</option>)}
        </select>
        <textarea
          aria-label="Message the BD Agent"
          rows={3}
          value={input}
          placeholder="Ask the BD Agent…"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); ask(input); } }}
        />
        <div className="bd-agent-send">
          <small>Drafts only. You review and send.</small>
          <button type="submit" className="bd-button bd-button-primary" disabled={busy || !input.trim()}>Send</button>
        </div>
      </form>
    </aside>
  );
}
