import { useEffect, useState } from "react";

// The Clients page shows the local Client Module (Client Master interview + Document Module
// uploads) inside the CRM. The module runs on this PC only; start it with
// "Client Module\Start-ClientModule.cmd". Override the address with VITE_CLIENT_MODULE_URL.
const CLIENT_MODULE_URL = (import.meta.env.VITE_CLIENT_MODULE_URL || "http://127.0.0.1:8792").replace(/\/$/, "");

// "online" = the Client Module answered; "other" = something else holds the address;
// "offline" = nothing is listening.
async function probeClientModule() {
  try {
    const res = await fetch(`${CLIENT_MODULE_URL}/api/health`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    const body = await res.json();
    return body?.app === "client-module" ? "online" : "other";
  } catch {
    // Unreachable, or another app on the port that doesn't allow this origin.
    try {
      await fetch(`${CLIENT_MODULE_URL}/`, { mode: "no-cors", cache: "no-store", signal: AbortSignal.timeout(5000) });
      return "other";
    } catch {
      return "offline";
    }
  }
}

// page/title/subtitle let other Client Module pages (e.g. Tax Compliance at /tax) reuse this frame.
export default function Clients({ profile, page = "/", title = "Clients", subtitle = "Client Master" }) {
  const [status, setStatus] = useState("checking"); // checking | online | offline | other
  const [frameKey, setFrameKey] = useState(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (profile?.role !== "admin") return;
    let cancelled = false;
    probeClientModule().then((s) => {
      if (!cancelled) setStatus(s);
    });
    return () => {
      cancelled = true;
    };
  }, [profile?.role, attempt]);

  function retry() {
    setStatus("checking");
    setAttempt((a) => a + 1);
  }

  if (profile?.role !== "admin") {
    return (
      <div style={{ padding: 32, color: "#b42318" }}>
        Client records are restricted to CRM administrators.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 20px",
          borderBottom: "1px solid #e5e7eb",
          background: "#fff",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700, color: "#1a1a1a" }}>{title}</div>
        <div style={{ fontSize: 12.5, color: "#6b7280" }}>
          {subtitle} · runs locally at {CLIENT_MODULE_URL}
        </div>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => (status === "online" ? setFrameKey((k) => k + 1) : retry())}
          disabled={status === "checking"}
          style={toolbarButton(status === "checking")}
        >
          {status === "online" ? "Reload" : "Retry"}
        </button>
        <a href={`${CLIENT_MODULE_URL}${page}`} target="_blank" rel="noreferrer" style={toolbarButton(false)}>
          Open in new tab
        </a>
      </div>

      {status === "online" ? (
        <iframe
          key={frameKey}
          title={title}
          src={`${CLIENT_MODULE_URL}${page}`}
          style={{ flex: 1, width: "100%", border: 0, background: "#f4f6f8" }}
        />
      ) : (
        <div style={{ padding: 28, maxWidth: 720 }}>
          {status === "checking" ? (
            <div style={{ fontSize: 13, color: "#6b7280" }}>Connecting to the Client Module…</div>
          ) : (
            <div
              role="alert"
              style={{
                padding: 16,
                border: "1px solid #f1b8b5",
                borderRadius: 8,
                background: "#fff5f4",
                color: "#9b1c16",
                fontSize: 13,
                lineHeight: 1.55,
              }}
            >
              {status === "other" ? (
                <>
                  Another application is using {CLIENT_MODULE_URL}, or the Client Module there does not
                  allow this CRM address. Stop the other application, or check{" "}
                  <code>embedOrigins</code> in <code>Client Module\config.json</code>.
                </>
              ) : (
                <>
                  The Client Module is not running. Start it on this PC by double-clicking{" "}
                  <code>D:\Abhijith Projects\CRM\Client Module\Start-ClientModule.cmd</code>, then press
                  Retry.
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function toolbarButton(busy) {
  return {
    border: "1px solid #d1d5db",
    borderRadius: 7,
    padding: "6px 12px",
    background: "#fff",
    color: "#374151",
    fontSize: 13,
    textDecoration: "none",
    cursor: busy ? "wait" : "pointer",
  };
}
