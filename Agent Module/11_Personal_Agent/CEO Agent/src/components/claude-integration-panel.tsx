"use client";

import { useState } from "react";

export default function ClaudeIntegrationPanel() {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  async function copyEndpoint() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/api/mcp`);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  return (
    <div className="settings-grid">
      <section aria-labelledby="claude-connect-title" className="settings-card">
        <div className="settings-card-heading">
          <div>
            <p className="eyebrow">CONNECTION</p>
            <h2 id="claude-connect-title">Claude Subscription</h2>
          </div>
          <span className="integration-status">
            <span aria-hidden="true" className="status-dot" />
            Not connected
          </span>
        </div>

        <p className="muted">
          Connect Claude Desktop to the CEO Agent MCP endpoint. Claude
          authentication is not enabled yet, so a Claude login cannot be
          completed from this screen.
        </p>

        <div className="endpoint-box">
          <span className="endpoint-label">MCP server endpoint</span>
          <code>This site&apos;s origin + /api/mcp</code>
          <button className="secondary-button" onClick={copyEndpoint} type="button">
            {copyState === "copied" ? "Copied" : "Copy endpoint"}
          </button>
        </div>
        {copyState === "error" && (
          <p className="notice notice-error" role="alert">
            Could not copy automatically. Select and copy the endpoint above.
          </p>
        )}

        <div className="notice notice-warning" role="status">
          The endpoint currently uses a shared <code>MCP_AUTH_TOKEN</code>,
          not Claude OAuth. Do not enter your Claude password or expose the
          Worker secret in this page or in browser storage.
        </div>

        <button className="primary-button" disabled type="button">
          Claude login unavailable — OAuth required
        </button>
      </section>

      <section aria-labelledby="claude-usage-title" className="settings-card">
        <div className="settings-card-heading">
          <div>
            <p className="eyebrow">USAGE</p>
            <h2 id="claude-usage-title">Subscription usage</h2>
          </div>
          <span className="usage-value">Unavailable</span>
        </div>
        <p className="muted">
          Claude does not provide this app with your subscription quota or
          usage history through the MCP connection. No subscription usage is
          being read or tracked here.
        </p>
        <a
          className="secondary-link"
          href="https://claude.ai"
          rel="noreferrer"
          target="_blank"
        >
          View your Claude account
          <span aria-hidden="true">↗</span>
        </a>
        <div className="usage-note">
          <strong>CRM tool activity</strong>
          <span>Usage reporting is not configured.</span>
        </div>
      </section>

      <section aria-labelledby="claude-setup-title" className="settings-card settings-guide">
        <div>
          <p className="eyebrow">NEXT STEPS</p>
          <h2 id="claude-setup-title">Finish connecting securely</h2>
        </div>
        <ol className="setup-steps">
          <li>
            <span>1</span>
            <div>
              <strong>Enable OAuth for the MCP endpoint</strong>
              <p>
                Claude’s remote connector login needs an OAuth flow. This
                project currently supports only a Worker bearer secret.
              </p>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <strong>Add the endpoint in Claude Desktop</strong>
              <p>
                After OAuth is configured, use the copied endpoint in Claude
                Desktop’s connector settings and complete login there.
              </p>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <strong>Connect real CRM actions</strong>
              <p>
                The three published tools are placeholders and currently
                return “not implemented”; they do not update CRM records or
                run workflows.
              </p>
            </div>
          </li>
        </ol>
      </section>
    </div>
  );
}
