import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";

export default function AccountingClients({ profile }) {
  const [clients, setClients] = useState([]);
  const [groups, setGroups] = useState({});
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (profile?.role !== "admin") {
      setClients([]);
      setGroups({});
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function loadClients() {
      setLoading(true);
      setError("");

      const [clientsResult, groupsResult] = await Promise.all([
        supabase
          .schema("acct")
          .from("clients")
          .select("id, client_code, display_name, client_type, status, group_id")
          .order("display_name", { ascending: true }),
        supabase
          .schema("acct")
          .from("client_groups")
          .select("id, name")
          .order("name", { ascending: true }),
      ]);

      if (cancelled) return;

      if (clientsResult.error || groupsResult.error) {
        setClients([]);
        setGroups({});
        setError(
          clientsResult.error?.message ||
            groupsResult.error?.message ||
            "Unable to load accounting records.",
        );
        setLoading(false);
        return;
      }

      setClients(clientsResult.data || []);
      setGroups(
        Object.fromEntries((groupsResult.data || []).map((group) => [group.id, group.name])),
      );
      setLoading(false);
    }

    loadClients();
    return () => {
      cancelled = true;
    };
  }, [profile?.role, refreshKey]);

  const filteredClients = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    if (!term) return clients;
    return clients.filter((client) =>
      [
        client.client_code,
        client.display_name,
        client.client_type,
        client.status,
        groups[client.group_id],
      ]
        .filter(Boolean)
        .some((value) => value.toLocaleLowerCase().includes(term)),
    );
  }, [clients, groups, search]);

  if (profile?.role !== "admin") {
    return (
      <div style={{ padding: 32, color: "#b42318" }}>
        Accounting records are restricted to CRM administrators.
      </div>
    );
  }

  return (
    <div style={{ padding: 28, maxWidth: 1180, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          marginBottom: 22,
        }}
      >
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#1a1a1a" }}>
            Accounting clients
          </div>
          <div style={{ fontSize: 13, color: "#6b7280", marginTop: 5 }}>
            Restricted directory · {clients.length} records
          </div>
        </div>
        <button
          type="button"
          onClick={() => setRefreshKey((key) => key + 1)}
          disabled={loading}
          style={{
            border: "1px solid #d1d5db",
            borderRadius: 7,
            padding: "8px 12px",
            background: "#fff",
            color: "#374151",
            cursor: loading ? "wait" : "pointer",
          }}
        >
          Refresh
        </button>
      </div>

      <input
        aria-label="Search accounting clients"
        placeholder="Search clients, groups, or status..."
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        style={{ maxWidth: 420, marginBottom: 16 }}
      />

      {error && (
        <div
          role="alert"
          style={{
            padding: 14,
            border: "1px solid #f1b8b5",
            borderRadius: 8,
            background: "#fff5f4",
            color: "#9b1c16",
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          Could not load the accounting directory: {error}
          <div style={{ marginTop: 6 }}>
            Check that the accounting schema is installed, exposed to the API, and secured
            with the CRM admin-only SQL policy.
          </div>
        </div>
      )}

      <div
        style={{
          overflowX: "auto",
          border: "1px solid #e5e7eb",
          borderRadius: 9,
          background: "#fff",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", background: "#f9fafb", color: "#6b7280" }}>
              {["Code", "Client", "Group", "Type", "Status"].map((heading) => (
                <th
                  key={heading}
                  scope="col"
                  style={{
                    padding: "11px 14px",
                    fontWeight: 600,
                    borderBottom: "1px solid #e5e7eb",
                  }}
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} style={{ padding: 20, color: "#6b7280" }}>
                  Loading accounting records...
                </td>
              </tr>
            ) : error ? null : filteredClients.length ? (
              filteredClients.map((client) => (
                <tr key={client.id}>
                  <td style={cellStyle}>{client.client_code}</td>
                  <td style={{ ...cellStyle, color: "#111827", fontWeight: 600 }}>
                    {client.display_name}
                  </td>
                  <td style={cellStyle}>{groups[client.group_id] || "—"}</td>
                  <td style={cellStyle}>{client.client_type.replaceAll("_", " ")}</td>
                  <td style={cellStyle}>{client.status.replaceAll("_", " ")}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} style={{ padding: 20, color: "#6b7280" }}>
                  {clients.length ? "No clients match this search." : "No accounting client records are available."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const cellStyle = {
  padding: "11px 14px",
  borderBottom: "1px solid #f0f1f3",
  color: "#4b5563",
};
