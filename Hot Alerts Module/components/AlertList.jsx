import { BACKLOG_STYLE, PRIORITY_STYLES, TAG_STYLES, tagFor, daysLabel } from "../logic/alertLogic";

const th = { textAlign: "left", fontSize: 11, color: "#888", fontWeight: 600, padding: "8px 12px", borderBottom: "1px solid #eee", whiteSpace: "nowrap" };
const td = { fontSize: 13, padding: "9px 12px", borderBottom: "1px solid #f3f3f3", verticalAlign: "top" };

// rows come from alert_list. showRead is true only in My scope: a row's `read` means nothing elsewhere.
export default function AlertList({ rows, today, onOpen, showRead, showAssignee, empty }) {
  if (!rows.length) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "#888", fontSize: 13, background: "#fff", border: "1px solid #e8e8e8", borderRadius: 8 }}>
        {empty}
      </div>
    );
  }
  return (
    <div style={{ background: "#fff", border: "1px solid #e8e8e8", borderRadius: 8, overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={th}>Alert</th>
            <th style={th}>Client</th>
            <th style={th}>Category</th>
            {showAssignee && <th style={th}>Assigned to</th>}
            <th style={th}>Due</th>
            <th style={th}>Priority</th>
            <th style={th}>Tag</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => {
            const tag = tagFor(a, today);
            const unread = showRead && !a.read;
            const days = daysLabel(a.due_date, today);
            return (
              <tr key={a.id} onClick={() => onOpen(a.id)} style={{ cursor: "pointer" }}>
                <td style={td}>
                  <div style={{ fontWeight: unread ? 700 : 500 }}>
                    {unread && <span title="Unread" style={{ display: "inline-block", width: 7, height: 7, borderRadius: 4, background: "#ef4444", marginRight: 6 }} />}
                    {a.title}
                  </div>
                  <div style={{ fontSize: 11, color: "#aaa" }}>{a.alert_number}</div>
                </td>
                <td style={td}>{a.client_name || a.client_id || "-"}</td>
                <td style={td}>{a.category || "-"}</td>
                {showAssignee && <td style={td}>{a.assignee_name || "Unassigned"}</td>}
                <td style={{ ...td, whiteSpace: "nowrap", color: days.endsWith("overdue") ? "#b91c1c" : undefined }}>{days}</td>
                <td style={td}><span className="badge" style={PRIORITY_STYLES[a.priority] || PRIORITY_STYLES.Normal}>{a.priority}</span></td>
                <td style={td}>
                  {tag ? <span className="badge" style={TAG_STYLES[tag]}>{tag}</span> : ""}
                  {a.backlog && <span className="badge" style={{ ...BACKLOG_STYLE, marginLeft: tag ? 4 : 0 }}>Backlog</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
