import { useEffect, useState } from "react";
import { Note, box, btn, btnDark } from "./ui";
import { clientComplianceClose, clientComplianceImport, clientComplianceList, clientComplianceSave } from "../services/alertsApi";
import { CSV_HEADER, ITEM_TYPES, itemPayload, parseRegisterCsv, validateItem } from "../logic/registerLogic";
import { daysLabel } from "../logic/alertLogic";

const th = { textAlign: "left", fontSize: 11, color: "#888", fontWeight: 600, padding: "6px 10px", borderBottom: "1px solid #eee", whiteSpace: "nowrap" };
const td = { fontSize: 12, padding: "6px 10px", borderBottom: "1px solid #f3f3f3" };
const input = { padding: 6, fontSize: 12, border: "1px solid #d4d4d4", borderRadius: 6 };
const full = { ...input, width: "100%", boxSizing: "border-box" };
const lab = { fontSize: 11, color: "#666" };
const PAGE = 100;
const EMPTY = { client_id: "", item_type: "", person_name: "", reference: "", issue_date: "", expiry_date: "", next_review_date: "", notes: "" };

// The compliance register: expiry dates for items the CRM has no table for yet. Every change goes through an RPC.
// The reference (a passport or card number) is shown here only; it never goes into an alert.
export default function ComplianceRegister({ supabase, today, fmtDate }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [client, setClient] = useState("");
  const [clientQuery, setClientQuery] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("Active");
  const [form, setForm] = useState(null);       // null = closed; object = add or edit
  const [closing, setClosing] = useState(null); // { id, reason }
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const show = fmtDate || ((d) => d);

  async function load(append = false) {
    setLoading(true); setError("");
    try {
      const r = await clientComplianceList(supabase, clientQuery.trim() || null, type || null, status, PAGE, append ? rows.length : 0);
      setRows((prev) => (append ? [...prev, ...(r?.rows || [])] : r?.rows || []));
      setTotal(Number(r?.total || 0));
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }
  useEffect(() => {
    const t = setTimeout(() => setClientQuery(client), 300);
    return () => clearTimeout(t);
  }, [client]);
  useEffect(() => { load(false); }, [supabase, clientQuery, type, status, reload]);

  async function save() {
    const problem = validateItem(form);
    if (problem) { setError(problem); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      await clientComplianceSave(supabase, itemPayload(form));
      setForm(null); setMessage("Saved.");
      setReload((n) => n + 1);
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  }

  async function doClose() {
    if (!closing.reason.trim()) { setError("Write a reason to close this entry."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      await clientComplianceClose(supabase, closing.id, closing.reason.trim());
      setClosing(null); setMessage("Closed. Its open alert closes at the next scan.");
      setReload((n) => n + 1);
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  }

  const edit = (r) => {
    setForm({ id: r.id, client_id: r.client_id, item_type: r.item_type, person_name: r.person_name || "", reference: r.reference || "",
      issue_date: r.issue_date || "", expiry_date: r.expiry_date || "", next_review_date: r.next_review_date || "", notes: r.notes || "" });
    setClosing(null); setError(""); setMessage("");
  };
  const field = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  if (importing) {
    return <ImportPanel supabase={supabase} onBack={(saved) => { setImporting(false); if (saved) setReload((n) => n + 1); }} />;
  }

  return (
    <div>
      {error && <Note tone="bad">{error}</Note>}
      {message && <Note>{message}</Note>}

      <div style={{ ...box, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input value={client} onChange={(e) => setClient(e.target.value)} placeholder="Client code, e.g. CL000001" style={{ ...input, width: 190 }} aria-label="Client code" />
        <select value={type} onChange={(e) => setType(e.target.value)} style={input} aria-label="Item type">
          <option value="">Any type</option>
          {ITEM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={input} aria-label="Status">
          <option value="Active">Active</option><option value="Closed">Closed</option><option value="All">All</option>
        </select>
        <span style={{ flex: 1 }} />
        <button type="button" style={btn} onClick={() => { setImporting(true); setForm(null); setClosing(null); }}>Import</button>
        <button type="button" style={btnDark} onClick={() => { setForm({ ...EMPTY }); setClosing(null); setError(""); setMessage(""); }}>Add item</button>
      </div>

      {form && (
        <div style={box}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{form.id ? "Edit item" : "Add item"}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
            <label style={lab}>Client code
              <input value={form.client_id} readOnly={!!form.id} onChange={(e) => field("client_id", e.target.value)} style={full} placeholder="CL000001" />
            </label>
            <label style={lab}>Item type
              <select value={form.item_type} disabled={!!form.id} onChange={(e) => field("item_type", e.target.value)} style={full}>
                <option value="">Choose</option>
                {ITEM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label style={lab}>Person (if it belongs to one)
              <input value={form.person_name} onChange={(e) => field("person_name", e.target.value)} style={full} />
            </label>
            <label style={lab}>Reference (shown on the register and client page only)
              <input value={form.reference} onChange={(e) => field("reference", e.target.value)} style={full} />
            </label>
            <label style={lab}>Issue date
              <input type="date" value={form.issue_date} onChange={(e) => field("issue_date", e.target.value)} style={full} />
            </label>
            <label style={lab}>Expiry date
              <input type="date" value={form.expiry_date} onChange={(e) => field("expiry_date", e.target.value)} style={full} />
            </label>
            <label style={lab}>Next review date
              <input type="date" value={form.next_review_date} onChange={(e) => field("next_review_date", e.target.value)} style={full} />
            </label>
          </div>
          <label style={{ ...lab, display: "block", marginTop: 10 }}>Notes
            <textarea value={form.notes} onChange={(e) => field("notes", e.target.value)} rows={2} style={full} />
          </label>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button type="button" style={btnDark} disabled={busy} onClick={save}>{busy ? "Saving..." : "Save"}</button>
            <button type="button" style={btn} disabled={busy} onClick={() => { setForm(null); setError(""); }}>Cancel</button>
          </div>
        </div>
      )}

      {closing && (
        <div style={box}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Close this item</div>
          <div style={{ fontSize: 11, color: "#888", marginBottom: 6 }}>A closed item raises no alerts. The reason is kept in its notes.</div>
          <input value={closing.reason} onChange={(e) => setClosing({ ...closing, reason: e.target.value })} placeholder="Reason" style={full} aria-label="Reason" />
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button type="button" style={btnDark} disabled={busy} onClick={doClose}>{busy ? "Closing..." : "Close item"}</button>
            <button type="button" style={btn} disabled={busy} onClick={() => { setClosing(null); setError(""); }}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ background: "#fff", border: "1px solid #e8e8e8", borderRadius: 8, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Client</th><th style={th}>Type</th><th style={th}>Person</th><th style={th}>Reference</th>
              <th style={th}>Issue date</th><th style={th}>Expiry date</th><th style={th}>Due</th><th style={th}>Next review</th><th style={th}>Status</th><th style={th} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={td}>{r.client_id}{r.client_name ? `  ${r.client_name}` : ""}</td>
                <td style={td}>{r.item_type}</td>
                <td style={td}>{r.person_name || "-"}</td>
                <td style={td}>{r.reference || "-"}</td>
                <td style={td}>{r.issue_date ? show(r.issue_date) : "-"}</td>
                <td style={td}>{r.expiry_date ? show(r.expiry_date) : "-"}</td>
                <td style={td}>{r.status === "Active" ? daysLabel(r.next_review_date || r.expiry_date, today) : "-"}</td>
                <td style={td}>{r.next_review_date ? show(r.next_review_date) : "-"}</td>
                <td style={td}>{r.status}</td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  <button type="button" style={btn} onClick={() => edit(r)}>Edit</button>{" "}
                  {r.status === "Active" && <button type="button" style={btn} onClick={() => { setClosing({ id: r.id, reason: "" }); setForm(null); setError(""); setMessage(""); }}>Close</button>}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td style={{ ...td, color: "#888" }} colSpan={10}>{loading ? "Loading..." : "No register items match."}</td></tr>}
          </tbody>
        </table>
      </div>
      {rows.length < total && (
        <div style={{ marginTop: 8, fontSize: 12, color: "#888" }}>
          Showing {rows.length} of {total}.{" "}
          <button type="button" style={btn} disabled={loading} onClick={() => load(true)}>Load more</button>
        </div>
      )}
    </div>
  );
}

// Paste CSV, check it here, and nothing is sent until Save. The preview lists problem rows; only good rows are sent.
function ImportPanel({ supabase, onBack }) {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true); setError("");
    try {
      setResult(await clientComplianceImport(supabase, parsed.rows));
      setParsed(null);
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
        <button type="button" style={btn} onClick={() => onBack(Boolean(result?.saved))}>Back</button>
        <div style={{ fontWeight: 700, fontSize: 14 }}>Import register items</div>
      </div>
      {error && <Note tone="bad">{error}</Note>}
      {result && (
        <Note tone={result.errors?.length ? "bad" : undefined}>
          Saved {result.saved}. {result.errors?.length ? `${result.errors.length} not saved:` : "No errors."}
          {(result.errors || []).map((e, i) => <div key={i}>Row {e.row}: {e.error}</div>)}
        </Note>
      )}
      <div style={box}>
        <div style={{ fontSize: 11, color: "#888", marginBottom: 6 }}>
          First line must be <code>{CSV_HEADER.join(",")}</code>. Dates as YYYY-MM-DD or DD/MM/YYYY. At most 500 rows.
        </div>
        <textarea value={text} onChange={(e) => { setText(e.target.value); setParsed(null); setResult(null); }} rows={8}
          style={{ ...full, fontFamily: "monospace" }} aria-label="CSV text" />
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button type="button" style={btn} disabled={!text.trim()} onClick={() => { setParsed(parseRegisterCsv(text)); setResult(null); setError(""); }}>Preview</button>
        </div>
      </div>
      {parsed && (
        <div style={box}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{parsed.rows.length} row{parsed.rows.length === 1 ? "" : "s"} ready, {parsed.errors.length} with errors</div>
          {parsed.errors.map((e, i) => <div key={i} style={{ fontSize: 12, color: "#b91c1c" }}>{e.row ? `Row ${e.row}: ` : ""}{e.error}</div>)}
          {parsed.rows.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
              <thead><tr><th style={th}>Client</th><th style={th}>Type</th><th style={th}>Person</th><th style={th}>Issue date</th><th style={th}>Expiry date</th><th style={th}>Next review</th></tr></thead>
              <tbody>
                {parsed.rows.slice(0, 50).map((r, i) => (
                  <tr key={i}><td style={td}>{r.client_id}</td><td style={td}>{r.item_type}</td><td style={td}>{r.person_name || "-"}</td>
                    <td style={td}>{r.issue_date || "-"}</td><td style={td}>{r.expiry_date || "-"}</td><td style={td}>{r.next_review_date || "-"}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          {parsed.rows.length > 50 && <div style={{ fontSize: 12, color: "#888", marginTop: 6 }}>Showing the first 50 of {parsed.rows.length}.</div>}
          <div style={{ marginTop: 10 }}>
            <button type="button" style={btnDark} disabled={busy || !parsed.rows.length || parsed.rows.length > 500} onClick={save}>
              {busy ? "Saving..." : `Save ${parsed.rows.length}`}
            </button>
            {parsed.rows.length > 500 && <span style={{ fontSize: 12, color: "#b91c1c", marginLeft: 8 }}>Too many rows: the limit is 500.</span>}
          </div>
        </div>
      )}
    </div>
  );
}
