import { useState, useEffect } from "react";
import { supabase } from "../supabase";
import { fmtDate } from "../dateFormat";

export default function MyTasks({ profile }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMyTasks();
  }, [profile]);

  async function fetchMyTasks() {
    if (!profile) return;
    setLoading(true);
    // Match either the legacy single assignee_id OR if the user's name
    // appears anywhere in the assignees array — so tasks with multiple
    // assignees show up for every co-assignee, not just the "primary" one.
    const nameFilter = profile.full_name
      ? `,assignees.cs.{${profile.full_name}}`
      : "";
    const { data } = await supabase
      .from("tasks")
      .select("*, task_field_values(*)")
      .is("deleted_at", null)
      .or(`assignee_id.eq.${profile.id}${nameFilter}`)
      .order("due_date", { ascending: true, nullsFirst: false });
    if (data) setTasks(data);
    setLoading(false);
  }

  async function updateStatus(taskId, newStatus) {
    await supabase
      .from("tasks")
      .update({
        status: newStatus,
        updated_by: profile?.full_name || "Unknown",
        updated_at: new Date().toISOString(),
      })
      .eq("id", taskId);
    fetchMyTasks();
  }

  function getPriorityStyle(priority) {
    if (priority === "High") return { background: "#fee2e2", color: "#b91c1c" };
    if (priority === "Low") return { background: "#dcfce7", color: "#15803d" };
    return { background: "#fef9c3", color: "#854d0e" };
  }

  const overdue = tasks.filter(
    (t) =>
      t.due_date && new Date(t.due_date) < new Date() && t.status !== "Done",
  );
  const upcoming = tasks.filter(
    (t) => !overdue.find((o) => o.id === t.id) && t.status !== "Done",
  );
  const done = tasks.filter((t) => t.status === "Done");

  function renderGroup(title, groupTasks, color) {
    if (groupTasks.length === 0) return null;
    return (
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 10,
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: "2px 10px",
              borderRadius: 20,
              background: color.bg,
              color: color.text,
            }}
          >
            {title}
          </span>
          <span style={{ fontSize: 12, color: "#aaa" }}>
            {groupTasks.length}
          </span>
        </div>
        <div
          style={{
            background: "#fff",
            border: "1px solid #e8e8e8",
            borderRadius: 8,
            overflowX: "auto",
          }}
        >
          <table
            className="task-table"
            style={{ width: "100%", borderCollapse: "collapse" }}
          >
            <thead>
              <tr>
                <th style={thStyle}>Task</th>
                <th style={thStyle}>Priority</th>
                <th style={thStyle}>Assignees</th>
                <th style={thStyle}>Due date</th>
                <th style={thStyle}>Status</th>
              </tr>
            </thead>
            <tbody>
              {groupTasks.map((task) => {
                const isOverdue =
                  task.due_date &&
                  new Date(task.due_date) < new Date() &&
                  task.status !== "Done";
                const allAssignees =
                  task.assignees?.length > 0
                    ? task.assignees
                    : task.assignee
                      ? [task.assignee]
                      : [];
                return (
                  <tr key={task.id}>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 500 }}>{task.title}</div>
                      {task.description && (
                        <div
                          style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}
                        >
                          {task.description.slice(0, 60)}
                          {task.description.length > 60 ? "..." : ""}
                        </div>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <span
                        className="badge"
                        style={getPriorityStyle(task.priority)}
                      >
                        {task.priority}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <div
                        style={{ display: "flex", flexWrap: "wrap", gap: 4 }}
                      >
                        {allAssignees.length > 0 ? (
                          allAssignees.map((name) => (
                            <span
                              key={name}
                              style={{
                                background:
                                  name === profile?.full_name
                                    ? "var(--accent-weak)"
                                    : "#f0f0ef",
                                color:
                                  name === profile?.full_name
                                    ? "var(--accent)"
                                    : "#555",
                                borderRadius: 20,
                                padding: "1px 8px",
                                fontSize: 11,
                                fontWeight: 500,
                              }}
                            >
                              {name}
                            </span>
                          ))
                        ) : (
                          <span style={{ color: "#ccc" }}>—</span>
                        )}
                      </div>
                    </td>
                    <td
                      style={{
                        ...tdStyle,
                        fontSize: 12,
                        color: isOverdue ? "#b91c1c" : "#555",
                        fontWeight: isOverdue ? 600 : 400,
                      }}
                    >
                      {task.due_date
                        ? isOverdue
                          ? `⚠️ ${fmtDate(task.due_date)}`
                          : fmtDate(task.due_date)
                        : "—"}
                    </td>
                    <td style={tdStyle}>
                      <select
                        value={task.status}
                        onChange={(e) => updateStatus(task.id, e.target.value)}
                        style={{ fontSize: 11, padding: "3px 6px" }}
                      >
                        {["To Do", "In Progress", "In Review", "Done"].map(
                          (s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ),
                        )}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">My Tasks</div>
          <div className="page-subtitle">
            {profile?.full_name} · {tasks.length} task
            {tasks.length !== 1 ? "s" : ""} assigned
          </div>
        </div>
      </div>

      <div className="content-area">
        {loading ? (
          <div style={{ color: "#aaa", fontSize: 13 }}>
            Loading your tasks...
          </div>
        ) : tasks.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "60px 20px",
              color: "#aaa",
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
            <div style={{ fontSize: 14 }}>No tasks assigned to you yet</div>
          </div>
        ) : (
          <>
            {renderGroup("Overdue", overdue, {
              bg: "#fee2e2",
              text: "#b91c1c",
            })}
            {renderGroup("In Progress", upcoming, {
              bg: "#fef9c3",
              text: "#854d0e",
            })}
            {renderGroup("Done", done, { bg: "#dcfce7", text: "#15803d" })}
          </>
        )}
      </div>
    </div>
  );
}

const thStyle = {
  textAlign: "left",
  padding: "10px 14px",
  fontSize: 11,
  fontWeight: 700,
  color: "#999",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  borderBottom: "1px solid #ebebeb",
  background: "#fafaf9",
  whiteSpace: "nowrap",
};

const tdStyle = {
  padding: "10px 14px",
  borderBottom: "1px solid #f0f0f0",
  verticalAlign: "middle",
  fontSize: 13,
};
