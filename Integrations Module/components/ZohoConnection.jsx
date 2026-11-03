import { useState } from "react";

// Zoho Books block inside the Integrations card: test the saved login, then pick the 5% VAT code.
// Nothing here reads or shows a credential; the choice is saved as ZOHO_VAT_TAX_ID like any other value.
async function invoke(supabase, fn, body) {
  const { data: out, error: fnError } = await supabase.functions.invoke(fn, { body });
  if (fnError) {
    let message = fnError.message;
    try { message = (await fnError.context?.json())?.error || message; } catch { /* keep message */ }
    throw new Error(message);
  }
  if (out?.error) throw new Error(out.error);
  return out;
}

export default function ZohoConnection({ supabase }) {
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState(null);
  const [taxes, setTaxes] = useState([]);
  const [choice, setChoice] = useState("");
  const [saved, setSaved] = useState("");

  async function test() {
    setBusy("test"); setResult(null); setSaved("");
    try {
      const out = await invoke(supabase, "zoho-books", { action: "connection_test" });
      if (out?.connected === false) { setResult({ ok: false, text: out.message || "Zoho did not accept the connection." }); return; }
      setResult({ ok: true, text: "Connected to Zoho Books." });
      const list = await invoke(supabase, "zoho-books", { action: "taxes_list" });
      setTaxes(list?.taxes || []);
    } catch (e) { setResult({ ok: false, text: e.message }); } finally { setBusy(""); }
  }

  async function save() {
    if (!choice) return;
    setBusy("save"); setSaved("");
    try {
      await invoke(supabase, "crm-connections", {
        action: "credential_set", name: "ZOHO_VAT_TAX_ID", value: choice,
        integration_id: "zoho-books", integration_name: "Zoho Books", field_label: "ZOHO_VAT_TAX_ID",
      });
      setSaved("VAT code saved.");
    } catch (e) { setSaved(e.message); } finally { setBusy(""); }
  }

  return (
    <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 8, display: "grid", gap: 6 }}>
      <strong style={{ fontSize: 12.5 }}>Zoho connection</strong>
      <div style={{ fontSize: 11.5, color: "#9ca3af" }}>Save the settings above first, then test. After a good test, pick the 5% VAT code.</div>
      <div>
        <button type="button" className="btn btn-sm" disabled={!!busy} onClick={test}>{busy === "test" ? "Testing…" : "Test"}</button>
      </div>
      {result && <div role="status" style={{ fontSize: 12, color: result.ok ? "#15803d" : "#b91c1c" }}>{result.text}</div>}
      {taxes.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <select aria-label="Zoho 5% VAT code" value={choice} onChange={(e) => setChoice(e.target.value)} style={{ padding: "6px 9px", border: "1px solid #d1d5db", borderRadius: 6, font: "inherit", fontSize: 12.5, flex: 1, minWidth: 0 }}>
            <option value="">Choose the 5% VAT code</option>
            {taxes.map((t) => <option key={t.tax_id} value={t.tax_id}>{t.tax_name}{t.tax_percentage != null ? ` (${t.tax_percentage}%)` : ""}</option>)}
          </select>
          <button type="button" className="btn btn-primary btn-sm" disabled={!!busy || !choice} onClick={save}>{busy === "save" ? "Saving…" : "Save"}</button>
        </div>
      )}
      {saved && <div role="status" style={{ fontSize: 12, color: saved === "VAT code saved." ? "#15803d" : "#b91c1c" }}>{saved}</div>}
    </div>
  );
}
