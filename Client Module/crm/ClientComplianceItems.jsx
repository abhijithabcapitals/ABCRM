// A client's active compliance register items, recent contacts and open document requests, shown in the client detail.
// A refused, missing or empty result shows nothing and never breaks the panel.
import { useEffect, useRef, useState } from "react";
import { fmtDate } from "@banking/components/shared";
import { rpc } from "@banking/services/bankingApi";

const th = { textAlign: "left", fontSize: 11, color: "#888", fontWeight: 600, padding: "4px 8px" };
const td = { fontSize: 12, padding: "4px 8px" };
const title = { fontWeight: 700, fontSize: 13, marginBottom: 4 };

export default function ClientComplianceItems({ clientId }) {
  const [rows, setRows] = useState([]);
  const [work, setWork] = useState({ contacts: [], requests: [] });
  const [error, setError] = useState("");
  const latest = useRef(clientId);
  latest.current = clientId;

  async function loadWork() {
    const asked = clientId;
    try {
      const w = await rpc("client_work_list", { p_client: asked });
      if (latest.current !== asked) return;
      setWork({ contacts: w?.contacts || [], requests: w?.requests || [] });
    } catch { /* not switched on, or refused: show nothing */ }
  }
  useEffect(() => {
    let live = true;
    setRows([]);
    setWork({ contacts: [], requests: [] });
    if (!clientId) return undefined;
    rpc("client_compliance_list", { p_client: clientId, p_type: null, p_status: "Active", p_limit: 50, p_offset: 0 })
      .then((r) => { if (live && Array.isArray(r?.rows)) setRows(r.rows); })
      .catch(() => {});
    loadWork();
    return () => { live = false; };
  }, [clientId]);

  async function received(id) {
    setError("");
    try {
      await rpc("client_document_answered", { p_id: id, p_note: null });
      await loadWork();
    } catch (e) { setError(e.message); }
  }

  return (
    <>
      {rows.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={title}>Compliance items</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>Type</th><th style={th}>Person</th><th style={th}>Reference</th><th style={th}>Expiry date</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}><td style={td}>{r.item_type}</td><td style={td}>{r.person_name || "-"}</td><td style={td}>{r.reference || "-"}</td><td style={td}>{r.expiry_date ? fmtDate(r.expiry_date) : "-"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {work.requests.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={title}>Documents requested</div>
          {error && <div style={{ fontSize: 12, color: "#b91c1c" }}>{error}</div>}
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>Documents</th><th style={th}>Requested</th><th style={th}>Due</th><th style={th} /></tr></thead>
            <tbody>
              {work.requests.map((r) => (
                <tr key={r.id}><td style={td}>{r.what}</td><td style={td}>{fmtDate(r.requested_on)}</td><td style={td}>{fmtDate(r.due_on)}</td>
                  <td style={td}><button type="button" onClick={() => received(r.id)}>Received</button></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {work.contacts.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={title}>Recent contacts</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>Date</th><th style={th}>Channel</th><th style={th}>By</th><th style={th}>Note</th><th style={th}>Follow up</th></tr></thead>
            <tbody>
              {work.contacts.map((c) => (
                <tr key={c.id}><td style={td}>{fmtDate(c.contacted_on)}</td><td style={td}>{c.channel}</td><td style={td}>{c.by_name || "-"}</td><td style={td}>{c.note || "-"}</td><td style={td}>{c.follow_up_on ? fmtDate(c.follow_up_on) : "-"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
