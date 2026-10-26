import { useState, useEffect, useCallback } from "react";
import { supabase } from "../supabase";
import { Kpi, Card, Donut, HBars, ProgressBar, DeltaBadge, SegmentBar, TrendBars } from "./charts";
import { statusColor, PALETTE } from "../chartUtils";
import { fmtDate } from "../dateFormat";
import DrilldownModal from "./DrilldownModal";
import AssigneeTasksModal from "./AssigneeTasksModal";

const ATTN_META = {
  overdue: {
    title: "Most overdue", accent: "#dc2626", tint: "#fef2f2",
    icon: <><path d="M12 3l9 16H3z" /><path d="M12 10v4M12 17h.01" /></>,
    badge: (t) => `${t.days}d`,
  },
  stuck: {
    title: "Stuck", accent: "#b45309", tint: "#fffbeb",
    icon: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    badge: (t) => `${t.days}d idle`,
  },
  unassigned: {
    title: "Unassigned · high", accent: "#6b7280", tint: "#f3f4f6",
    icon: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></>,
    badge: () => "No owner",
  },
};

function AttentionPanel({ items, kind, onOpenScope, spaceName, empty }) {
  const m = ATTN_META[kind];
  const list = items || [];
  return (
    <div className="attn-panel" style={{ minWidth: 0, padding: kind === "overdue" ? "0 16px 0 0" : "0 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ width: 22, height: 22, borderRadius: 7, background: m.tint, color: m.accent, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{m.icon}</svg>
        </span>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: ".03em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{m.title}</span>
        <span style={{ marginLeft: "auto", flexShrink: 0, fontSize: 11, fontWeight: 700, color: m.accent, background: m.tint, borderRadius: 20, padding: "1px 8px" }}>{list.length}</span>
      </div>
      {list.length === 0 ? (
        <div style={{ fontSize: 12, color: "#9ca3af", padding: "6px 2px" }}>{empty}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {list.map((t) => (
            <div key={t.id} className="attn-row" onClick={() => onOpenScope?.({ space_id: t.space_id, list_id: t.list_id }, t.id)}
              style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 8px", cursor: "pointer" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: m.accent, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div title={t.title || "Untitled"} style={{ fontSize: 12.5, color: "#374151", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title || "Untitled"}</div>
                <div style={{ fontSize: 10.5, color: "#9ca3af", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{spaceName?.(t.space_id) || ""}</div>
              </div>
              <span style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 700, color: m.accent, background: m.tint, borderRadius: 20, padding: "2px 8px" }}>{m.badge(t)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Dashboard({ spaces, profile, onNavigate, onSpaceSelect, onOpenScope }) {
  const [data, setData] = useState(null);
  const [ceo, setCeo] = useState(null);           // executive summary (admins)
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [assigneeModal, setAssigneeModal] = useState(null); // assignee name being drilled into
  const [drill, setDrill] = useState(null);                 // { title, metric } KPI drill-down
  const isAdmin = profile?.role === "admin";

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    const calls = [supabase.rpc("dashboard_overview")];
    if (isAdmin) calls.push(supabase.rpc("ceo_overview"));
    const [ov, ce] = await Promise.all(calls);
    if (ov.error) setErr(ov.error.message);
    else setData(ov.data);
    if (ce && !ce.error) setCeo(ce.data);
    setLoading(false);
  }, [isAdmin]);
  useEffect(() => { load(); }, [load]);

  const total = data?.total ?? 0;
  const pct = (n) => (total > 0 ? Math.round((n / total) * 100) : 0);
  const spaceById = Object.fromEntries((spaces || []).map((s) => [s.id, s]));

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Dashboard</div>
          <div className="page-subtitle">CRM-wide summary across every space</div>
        </div>
        <button className="btn btn-primary" onClick={() => onNavigate("tasks")}>+ New Task</button>
      </div>

      <div className="content-area">
        {err && (
          <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", color: "#b91c1c", borderRadius: 8, padding: "10px 12px", fontSize: 12.5, marginBottom: 16 }}>
            {err.includes("function") ? "Analytics aren't available yet — run db/dashboard_analytics.sql in Supabase." : err}
          </div>
        )}
        {loading && !data ? (
          <div style={{ color: "#9ca3af", fontSize: 13 }}>Loading analytics…</div>
        ) : total === 0 ? (
          <EmptyState />
        ) : data ? (
          <>
            {isAdmin && ceo && (() => {
              const leads = ceo.leads || {};
              const rn = ceo.renewals || {};
              const convRate = leads.total > 0 ? Math.round((leads.converted / leads.total) * 100) : 0;
              const soon = rn.soon || [];
              return (
                <div style={{ marginBottom: 22 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 10 }}>Executive summary</div>

                  {/* Value */}
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
                    <Kpi label="Leads (pipeline)" value={(leads.total || 0).toLocaleString()} sub="in lead lists" tip="Every non-deleted task in a lead list (a list with a created_time field)." onClick={() => setDrill({ title: "Leads (pipeline)", metric: "leads" })} />
                    <Kpi label="Converted" value={(leads.converted || 0).toLocaleString()} sub={`${convRate}% conversion`} tone="good" tip="Leads whose status is 'Converted'. Conversion % = converted ÷ leads." onClick={() => setDrill({ title: "Converted leads", metric: "converted" })} />
                    <Kpi label="Renewals overdue" value={(rn.overdue || 0).toLocaleString()} sub="past expiry" tone="danger" tip="License/visa/expiry-type date fields whose date is already in the past." onClick={() => setDrill({ title: "Renewals overdue", metric: "renewals_overdue" })} />
                    <Kpi label="Due ≤ 30 days" value={(rn.d30 || 0).toLocaleString()} sub="renew now" tone="warn" tip="Renewals/expiries falling due within 30 days." onClick={() => setDrill({ title: "Renewals due ≤ 30 days", metric: "renewals_30" })} />
                    <Kpi label="Due 31–90 days" value={((rn.d60 || 0) + (rn.d90 || 0)).toLocaleString()} sub="plan ahead" tip="Renewals/expiries due in 31–90 days." onClick={() => setDrill({ title: "Renewals due 31–90 days", metric: "renewals_90" })} />
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 1fr) minmax(320px, 1.2fr)", gap: 16, marginBottom: 8 }}>
                    <Card title="Leads vs Converted (6 mo)" tip="Monthly leads created vs converted, by created_time. Rising green vs blue is improving conversion.">
                      <TrendBars data={(leads.by_month || []).map((m) => ({ month: m.ym, created: m.leads, completed: m.converted }))} />
                    </Card>
                    <Card title={`Upcoming renewals (${soon.length})`} tip="License/visa/tenancy/permit/VAT-type date fields coming due in the next 90 days, soonest first. Click to open the task.">
                      {soon.length === 0 ? (
                        <div style={{ fontSize: 12.5, color: "#9ca3af" }}>Nothing due in the next 90 days. 🎉</div>
                      ) : (
                        <div style={{ maxHeight: 230, overflowY: "auto" }}>
                          {soon.map((r) => {
                            const urgent = r.days_left <= 30;
                            return (
                              <div key={r.task_id + r.field} onClick={() => onOpenScope?.({ space_id: r.space_id, folder_id: r.folder_id, list_id: r.list_id }, r.task_id)}
                                style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 0", borderBottom: "1px solid #f2f2f2", fontSize: 12.5, cursor: "pointer" }}>
                                <span style={{ minWidth: 0 }}>
                                  <span style={{ color: "#111827", fontWeight: 600, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title || "Untitled"}</span>
                                  <span style={{ color: "#9ca3af", fontSize: 11 }}>{r.list} · {r.field}</span>
                                </span>
                                <span style={{ flexShrink: 0, textAlign: "right" }}>
                                  <span style={{ color: urgent ? "#b91c1c" : "#374151", fontWeight: 700 }}>{r.days_left}d</span>
                                  <span style={{ color: "#9ca3af", fontSize: 11, display: "block" }}>{fmtDate(r.date)}</span>
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </Card>
                  </div>
                  <div style={{ borderBottom: "1px solid #eef0f0", margin: "14px 0 18px" }} />
                </div>
              );
            })()}
            {/* KPI row */}
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 16 }}>
              <Kpi label="Total tasks" value={total.toLocaleString()} sub="across all spaces" tip="Every non-deleted task across all spaces (excludes trashed tasks)." onClick={() => setDrill({ title: "All tasks", metric: "total" })} />
              <Kpi label="In progress" value={data.in_progress.toLocaleString()} sub={`${pct(data.in_progress)}% of all`} tone="warn" tip="Tasks whose status is exactly 'In Progress'." onClick={() => setDrill({ title: "In progress", metric: "in_progress" })} />
              <Kpi label="Completed" value={(data.completed ?? data.done).toLocaleString()} sub={`${pct(data.completed ?? data.done)}% completion`} tone="good" tip="Tasks in a status marked as 'complete' for their space (set per status in Manage statuses; unset statuses auto-count done/complete/closed). Completion % = completed ÷ total." onClick={() => setDrill({ title: "Completed tasks", metric: "completed" })} />
              <Kpi label="Urgent open" value={data.urgent.toLocaleString()} sub="high priority, not done" tone="danger" tip="High-priority tasks that are still open (not in a done/closed/cancelled status)." onClick={() => setDrill({ title: "Urgent open", metric: "urgent" })} />
              <Kpi label="Overdue" value={data.overdue.toLocaleString()} sub="past due & still open" tone="danger" tip="Open tasks whose due date is before today." onClick={() => setDrill({ title: "Overdue tasks", metric: "overdue" })} />
              <Kpi label="Due in 30 days" value={data.due_30d.toLocaleString()} sub={`${data.due_7d} within 7 days`} tip="Open tasks due within the next 30 days (the sub-line shows how many fall within 7 days)." onClick={() => setDrill({ title: "Due in 30 days", metric: "due_30d" })} />
            </div>

            {/* Executive row: velocity · aging · cycle */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(220px, 1fr))", gap: 16, marginBottom: 16 }}>
              <Card title="Velocity (last 30 days)" tip="Created = tasks added in the last 30 days. Completed = tasks marked complete in the last 30 days. '▲/▼ vs prior 30d' compares to the previous 30-day window. Backlog change = created − completed (a growing backlog means work is coming in faster than it's cleared).">
                <div style={{ display: "flex", gap: 24 }}>
                  <div onClick={() => setDrill({ title: "Created (last 30 days)", metric: "created_30d" })} style={{ cursor: "pointer" }} title="Click to list these tasks">
                    <div style={{ fontSize: 24, fontWeight: 800, color: "var(--accent)" }}>{data.created_30d}</div>
                    <div style={{ fontSize: 11.5, color: "#6b7280" }}>created</div>
                    <div style={{ marginTop: 2 }}><DeltaBadge curr={data.created_30d} prev={data.created_prev_30d} goodWhenUp={false} /></div>
                  </div>
                  <div onClick={() => setDrill({ title: "Completed (last 30 days)", metric: "completed_30d" })} style={{ cursor: "pointer" }} title="Click to list these tasks">
                    <div style={{ fontSize: 24, fontWeight: 800, color: "#15803d" }}>{data.completed_30d}</div>
                    <div style={{ fontSize: 11.5, color: "#6b7280" }}>completed</div>
                    <div style={{ marginTop: 2 }}><DeltaBadge curr={data.completed_30d} prev={data.completed_prev_30d} goodWhenUp /></div>
                  </div>
                </div>
                {(() => {
                  const net = (data.created_30d || 0) - (data.completed_30d || 0);
                  return (
                    <div style={{ marginTop: 12, fontSize: 12, color: net > 0 ? "#b45309" : "#15803d", fontWeight: 600 }}>
                      {net > 0 ? `Backlog grew by ${net}` : net < 0 ? `Backlog shrank by ${Math.abs(net)}` : "Backlog flat"} this month
                    </div>
                  );
                })()}
              </Card>
              <Card title="Overdue aging" tip="How long overdue tasks have been past their due date: 0–7 days, 8–30 days, and 30+ days. Bigger 30+ bars mean chronic, long-ignored work. 'Oldest overdue' is the single most overdue task.">
                <SegmentBar segs={[
                  { label: "0–7d", value: data.overdue_0_7 || 0, color: "#f59e0b" },
                  { label: "8–30d", value: data.overdue_8_30 || 0, color: "#f97316" },
                  { label: "30d+", value: data.overdue_30p || 0, color: "#dc2626" },
                ]} />
                <div style={{ marginTop: 12, fontSize: 12, color: "#6b7280" }}>
                  Oldest overdue: <strong style={{ color: "#dc2626" }}>{data.oldest_overdue_days || 0} days</strong>
                </div>
              </Card>
              <Card title="Delivery quality (90 days)" tip="Based on tasks completed in the last 90 days. 'Avg days to complete' = average time from creation to completion (cycle time — lower is faster). 'Completed on time' = share of those completions that were done on or before their due date.">
                <div style={{ display: "flex", gap: 24 }}>
                  <div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: "#111827" }}>{data.cycle_time_avg ?? "—"}</div>
                    <div style={{ fontSize: 11.5, color: "#6b7280" }}>avg days to complete</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: (data.on_time_pct ?? 100) >= 80 ? "#15803d" : "#b45309" }}>{data.on_time_pct ?? "—"}{data.on_time_pct != null ? "%" : ""}</div>
                    <div style={{ fontSize: 11.5, color: "#6b7280" }}>completed on time</div>
                  </div>
                </div>
              </Card>
            </div>

            {/* Attention + deadlines */}
            <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 1.6fr) minmax(220px, 1fr)", gap: 16, marginBottom: 16 }}>
              <Card title="Needs attention" tip="Tasks worth acting on now. Most overdue = furthest past due. Stuck = open with no update in 30+ days. Unassigned · high = High priority with no assignee (with its space). Click any row to open it.">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr" }}>
                  <AttentionPanel items={data.attention?.top_overdue} kind="overdue" onOpenScope={onOpenScope} empty="None overdue 🎉" spaceName={(id) => spaceById[id]?.name} />
                  <AttentionPanel items={data.attention?.stuck} kind="stuck" onOpenScope={onOpenScope} empty="Nothing stuck" spaceName={(id) => spaceById[id]?.name} />
                  <AttentionPanel items={data.attention?.unassigned_high} kind="unassigned" onOpenScope={onOpenScope} empty="All assigned" spaceName={(id) => spaceById[id]?.name} />
                </div>
              </Card>
              <Card title="Deadline calendar" tip="Count of open tasks whose due date falls within each window (cumulative). Since your due dates are statutory/filing deadlines, this is your upcoming compliance load. Open a space's Overview tab for the actual list.">
                {[
                  { label: "Next 7 days", value: data.due_7d, color: "#dc2626" },
                  { label: "Next 30 days", value: data.due_30d, color: "#f59e0b" },
                  { label: "Next 90 days", value: data.due_90d, color: "#0d7d82" },
                ].map((w) => (
                  <div key={w.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: "1px solid #f4f4f4" }}>
                    <span style={{ fontSize: 12.5, color: "#374151" }}>{w.label}</span>
                    <span style={{ fontSize: 18, fontWeight: 800, color: w.color }}>{w.value}</span>
                  </div>
                ))}
                <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 8 }}>Open tasks with a due date (statutory & internal). Open a space's Overview for the list.</div>
              </Card>
            </div>

            {/* Status distribution + assignee workload */}
            <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 1fr) minmax(280px, 1fr)", gap: 16, marginBottom: 16 }}>
              <Card title="Status distribution" tip="Tasks by status. Click a slice or label to list those tasks.">
                <Donut
                  centerLabel={total.toLocaleString()} centerSub="tasks"
                  data={(data.by_status || []).slice(0, 8).map((s) => ({ label: s.status, value: s.count, color: statusColor(s.status) }))}
                  onSliceClick={(d) => setDrill({ title: `Status: ${d.label}`, metric: `status:${d.label}` })}
                />
              </Card>
              <Card title="Workload by assignee" tip="Open (not-done) tasks per person, with overdue counts. Click a name to see their tasks and reassign them (e.g. when someone leaves). Anyone marked '⚠ likely bulk/system' has an abnormally high load (5×+ the median, 100+) — usually a catch-all/import account, not a real person; it's greyed so it doesn't distort the view.">
                {(() => {
                  const rows = data.by_assignee || [];
                  const opens = rows.map((r) => r.open).sort((a, b) => a - b);
                  const median = opens.length ? opens[Math.floor(opens.length / 2)] : 0;
                  const anomalyAt = Math.max(100, median * 5);
                  return (
                    <HBars
                      emptyText="No assignees yet"
                      onRowClick={(d) => d.name && setAssigneeModal(d.name)}
                      data={rows.map((a, i) => {
                        const anomaly = a.open >= anomalyAt;
                        return {
                          name: a.name,
                          label: anomaly ? `⚠ ${a.name}` : a.name,
                          value: a.open,
                          sub: anomaly
                            ? `${a.open} open · likely bulk/system`
                            : `${a.open} open${a.overdue > 0 ? ` · ${a.overdue} overdue` : ""}`,
                          color: anomaly ? "#9ca3af" : a.overdue > 0 ? "#ef4444" : PALETTE[i % PALETTE.length],
                        };
                      })}
                    />
                  );
                })()}
              </Card>
            </div>

            {/* Space health (full width) */}
            <div style={{ marginBottom: 16 }}>
              <Card title="Space health" tip="Per-space snapshot: total tasks, completion % (using that space's completed-statuses config), and overdue count. Click a space to open it. Bar colour is the space's colour.">

                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {(data.by_space || []).map((sp) => {
                    const p = sp.total > 0 ? Math.round(((sp.completed ?? sp.done) / sp.total) * 100) : 0;
                    const sObj = spaceById[sp.space_id];
                    return (
                      <div key={sp.space_id} style={{ cursor: sObj ? "pointer" : "default" }} onClick={() => sObj && onSpaceSelect(sObj)}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4, fontSize: 12.5 }}>
                          <span style={{ fontWeight: 600, color: "#111827" }}>{sp.name}</span>
                          <span style={{ color: "#6b7280" }}>
                            {sp.total} tasks · {p}% done
                            {sp.overdue > 0 && <span style={{ color: "#b91c1c", fontWeight: 600 }}> · {sp.overdue} overdue</span>}
                          </span>
                        </div>
                        <ProgressBar pct={p} color={sObj?.color || "var(--accent)"} />
                      </div>
                    );
                  })}
                </div>
              </Card>
            </div>
          </>
        ) : null}
      </div>

      {assigneeModal && (
        <AssigneeTasksModal
          name={assigneeModal}
          actor={profile?.full_name}
          people={(data?.by_assignee || []).map((a) => a.name).filter(Boolean)}
          onOpenScope={onOpenScope}
          onClose={() => setAssigneeModal(null)}
          onChanged={load}
        />
      )}
      {drill && (
        <DrilldownModal
          title={drill.title}
          metric={drill.metric}
          onOpenScope={onOpenScope}
          onClose={() => setDrill(null)}
        />
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{ textAlign: "center", padding: "60px 20px", background: "#fff", borderRadius: 10, border: "1px solid #e8e8e8" }}>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Welcome to AB Capital Workspace</div>
      <div style={{ fontSize: 13, color: "#888", lineHeight: 1.8 }}>Create a space, add folders and lists, then create tasks — your analytics will appear here.</div>
    </div>
  );
}
