// Read-only list of a client's active compliance register items, shown in the client detail.
// A refused, missing or empty result shows nothing and never breaks the panel.
import { useEffect, useState } from "react";
import { fmtDate } from "@banking/components/shared";
import { rpc } from "@banking/services/bankingApi";

export default function ClientComplianceItems({ clientId }) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    let live = true;
    setRows([]);
    if (!clientId) return undefined;
    rpc("client_compliance_list", { p_client: clientId, p_type: null, p_status: "Active", p_limit: 50, p_offset: 0 })
      .then((r) => { if (live && Array.isArray(r?.rows)) setRows(r.rows); })
      .catch(() => {});
    return () => { live = false; };
  }, [clientId]);
  if (!rows.length) return null;
  const th = { textAlign: "left", fontSize: 11, color: "#888", fontWeight: 600, padding: "4px 8px" };
  const td = { fontSize: 12, padding: "4px 8px" };
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Compliance items</div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr><th style={th}>Type</th><th style={th}>Person</th><th style={th}>Reference</th><th style={th}>Expiry date</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}><td style={td}>{r.item_type}</td><td style={td}>{r.person_name || "-"}</td><td style={td}>{r.reference || "-"}</td><td style={td}>{r.expiry_date ? fmtDate(r.expiry_date) : "-"}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
