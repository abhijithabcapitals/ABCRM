import { useState } from "react";

const MCP_ENDPOINT = "https://crm-agent.ceo-intelligence-agent.workers.dev/mcp";

const boxStyle = { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "14px 16px", marginBottom: 16 };
const mutedStyle = { fontSize: 12.5, color: "#6b7280", margin: "6px 0 0" };

// Settings > Agents: how Claude Desktop connects to the CRM Agent. The token is a
// Worker secret and is never shown or stored here.
export default function ClaudeConnectionPanel() {
  const [copied, setCopied] = useState("");

  async function copyEndpoint() {
    try {
      await navigator.clipboard.writeText(MCP_ENDPOINT);
      setCopied("Copied");
    } catch {
      setCopied("Could not copy. Select the address and copy it.");
    }
  }

  return (
    <section style={boxStyle}>
      <div style={{ fontWeight: 600, fontSize: 14 }}>CRM Agent: Claude connection (MCP)</div>
      <p style={mutedStyle}>
        Claude Desktop connects to the CRM Agent at this address. Access uses a shared token, not a Claude
        login, so a connector that requires OAuth cannot sign in yet.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 10 }}>
        <code style={{ fontSize: 12.5, overflowWrap: "anywhere" }}>{MCP_ENDPOINT}</code>
        <button type="button" onClick={copyEndpoint}>Copy address</button>
        {copied && <span role="status" style={{ fontSize: 12.5, color: "#6b7280" }}>{copied}</span>}
      </div>
      <p style={mutedStyle}>
        The three tools (get_crm_lead_status, update_crm_lead, trigger_agent_workflow) are placeholders. They
        return "not implemented" and do not read or change CRM records. Claude subscription usage and tool
        activity are not tracked here.
      </p>
    </section>
  );
}
