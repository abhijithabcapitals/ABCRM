import { useEffect, useState } from "react";
import { cleanAgentName, DEFAULT_NAME, NAME_CHANGED } from "../logic/agentName.js";

// The Profile page's rename field for the person's agent.
export default function AgentNameField({ supabase }) {
  const [name, setName] = useState("");
  const [saved, setSaved] = useState(DEFAULT_NAME);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    supabase.rpc("router_my_agent_name").then(({ data }) => {
      if (live && data) {
        setName(data);
        setSaved(data);
      }
    });
    return () => {
      live = false;
    };
  }, [supabase]);

  async function save(e) {
    e.preventDefault();
    const clean = cleanAgentName(name);
    if (!clean) {
      setMessage("Enter a name of 1 to 30 characters.");
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.rpc("router_set_agent_name", { p_name: clean });
    setSaving(false);
    if (error) {
      setMessage("Could not save the name. Try again.");
      return;
    }
    setName(data);
    setSaved(data);
    setMessage("Saved.");
    window.dispatchEvent(new CustomEvent(NAME_CHANGED, { detail: data }));
  }

  return (
    <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 20, marginBottom: 16 }}>
      <h2 style={{ margin: 0, fontSize: 16 }}>My agent</h2>
      <p style={{ margin: "4px 0 12px", fontSize: 12.5, color: "#6b7280" }}>
        The name of your chat agent in the corner of the CRM. Only you see this name.
      </p>
      <form onSubmit={save} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          aria-label="Agent name"
          value={name}
          placeholder={DEFAULT_NAME}
          onChange={(e) => { setName(e.target.value); setMessage(""); }}
          style={{ padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: 6, minWidth: 220 }}
        />
        <button type="submit" className="btn btn-primary" disabled={saving || name.trim() === saved}>Save</button>
        {message && <span role="status" style={{ fontSize: 12.5, color: "#6b7280" }}>{message}</span>}
      </form>
    </section>
  );
}
