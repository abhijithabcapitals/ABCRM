import { useState } from "react";

// Financial Dashboard block inside the Zoho Books card: test the read-only login, and (for now) run a one-off
// check that shows the shape of the Zoho data as text to copy. It never shows an amount, a name or a credential.
async function invoke(supabase, body) {
  const { data: out, error: fnError } = await supabase.functions.invoke("zoho-finance", { body });
  if (fnError) {
    let message = fnError.message;
    try { message = (await fnError.context?.json())?.error || message; } catch { /* keep message */ }
    throw new Error(message);
  }
  if (out?.error) throw new Error(out.error);
  return out;
}

export default function ZohoFinanceConnection({ supabase }) {
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState(null);
  const [check, setCheck] = useState("");

  async function test() {
    setBusy("test"); setResult(null);
    try {
      const out = await invoke(supabase, { action: "connection_test" });
      if (out?.connected === false) { setResult({ ok: false, text: out.message || "Zoho did not accept the connection." }); return; }
      setResult({ ok: true, text: out?.organisation ? `Connected to Zoho Books: ${out.organisation}.` : "Connected to Zoho Books." });
    } catch (e) { setResult({ ok: false, text: e.message }); } finally { setBusy(""); }
  }

  async function runCheck() {
    setBusy("check"); setCheck("");
    try {
      const out = await invoke(supabase, { action: "probe" });
      setCheck(JSON.stringify(out, null, 2));
    } catch (e) { setCheck(`Check failed: ${e.message}`); } finally { setBusy(""); }
  }

  return (
    <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 8, display: "grid", gap: 6 }}>
      <strong style={{ fontSize: 12.5 }}>Financial Dashboard connection</strong>
      <div style={{ fontSize: 11.5, color: "#9ca3af" }}>Read-only. Save the three values above first, then test.</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-sm" disabled={!!busy} onClick={test}>{busy === "test" ? "Testing…" : "Test"}</button>
        <button type="button" className="btn btn-sm" disabled={!!busy} onClick={runCheck}>{busy === "check" ? "Checking…" : "Run check"}</button>
      </div>
      {result && <div role="status" style={{ fontSize: 12, color: result.ok ? "#15803d" : "#b91c1c" }}>{result.text}</div>}
      {check && (
        <textarea readOnly aria-label="Check result" value={check} rows={12} onFocus={(e) => e.target.select()}
          style={{ font: "11.5px monospace", padding: 8, border: "1px solid #d1d5db", borderRadius: 6, width: "100%", boxSizing: "border-box" }} />
      )}
    </div>
  );
}
