// One wrapper per browser-callable Notification Centre function. Each is (supabase, ...args)
// and throws the database's own error, so the page shows its plain sentence.
// The thrown error keeps `code`, which isNotSwitchedOn() reads.

async function call(supabase, fn, args) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    const e = new Error(error.message || "Something went wrong.");
    e.code = error.code;
    throw e;
  }
  return data;
}

// Reads (004)
export const alertMyAccess = (s) => call(s, "alert_my_access", {});
export const alertList = (s, scope, filter = "All", department = null, limit = 100, offset = 0) =>
  call(s, "alert_list", { p_scope: scope, p_filter: filter, p_department: department, p_limit: limit, p_offset: offset });
export const alertTiles = (s, scope, department = null) => call(s, "alert_tiles", { p_scope: scope, p_department: department });
export const alertDetail = (s, id) => call(s, "alert_detail", { p_id: id });
export const alertManagementSummary = (s) => call(s, "alert_management_summary", {});
export const alertCoverage = (s) => call(s, "alert_coverage", {});

// Actions (003)
export const alertAssign = (s, id, user) => call(s, "alert_assign", { p_id: id, p_user: user });
export const alertSetStatus = (s, id, status) => call(s, "alert_set_status", { p_id: id, p_status: status });
export const alertResolve = (s, id, note = null, dismiss = false) => call(s, "alert_resolve", { p_id: id, p_note: note, p_dismiss: dismiss });
export const alertEscalate = (s, id, reason) => call(s, "alert_escalate", { p_id: id, p_reason: reason });
export const alertMarkRead = (s, id) => call(s, "alert_mark_read", { p_id: id });
export const clientOwnerList = (s, department) => call(s, "client_owner_list", { p_department: department });
export const clientOwnerProposals = (s, department) => call(s, "client_owner_proposals", { p_department: department });
export const clientOwnersSet = (s, department, clients, owner) =>
  call(s, "client_owners_set", { p_department: department, p_clients: clients, p_owner: owner });
export const alertRuleSave = (s, code, enabled, steps) => call(s, "alert_rule_save", { p_code: code, p_enabled: enabled, p_steps: steps });
export const alertSetMode = (s, mode) => call(s, "alert_set_mode", { p_mode: mode });
export const alertScanNow = (s) => call(s, "alert_scan_now", {});
