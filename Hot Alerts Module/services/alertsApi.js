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
export const alertRuleList = (s) => call(s, "alert_rule_list", {});
export const alertManagerList = (s) => call(s, "alert_manager_list", {});

// Compliance register (006). Rows carry `reference`: show it on the register screen and client detail only.
export const clientComplianceList = (s, client = null, type = null, status = "Active", limit = 100, offset = 0) =>
  call(s, "client_compliance_list", { p_client: client, p_type: type, p_status: status, p_limit: limit, p_offset: offset });
export const clientComplianceSave = (s, p) => call(s, "client_compliance_save", { p });
export const clientComplianceClose = (s, id, reason) => call(s, "client_compliance_close", { p_id: id, p_reason: reason });
export const clientComplianceImport = (s, rows) => call(s, "client_compliance_import", { p_rows: rows });

// Preferences (007): the signed-in person's own.
export const alertPreferencesGet = (s) => call(s, "alert_preferences_get", {});
export const alertPreferencesSave = (s, category, channel, enabled) => call(s, "alert_preferences_save", { p_category: category, p_channel: channel, p_enabled: enabled });
export const alertCalendar = (s, from, to) => call(s, "alert_calendar", { p_from: from, p_to: to });

// Regulatory Updates Centre (010).
export const regulatoryList = (s, status = null, limit = 50, offset = 0) => call(s, "regulatory_list", { p_status: status, p_limit: limit, p_offset: offset });
export const regulatoryDetail = (s, id) => call(s, "regulatory_detail", { p_id: id });
export const regulatorySave = (s, p) => call(s, "regulatory_update_save", { p });
export const regulatoryStartReview = (s, id) => call(s, "regulatory_start_review", { p_id: id });
export const regulatoryProposeList = (s, id) => call(s, "regulatory_propose_list", { p_id: id });
export const regulatoryDecideClient = (s, id, client, decision) => call(s, "regulatory_decide_client", { p_id: id, p_client: client, p_decision: decision });
export const regulatoryVerify = (s, id) => call(s, "regulatory_verify", { p_id: id });
export const regulatoryCreateTasks = (s, id) => call(s, "regulatory_create_tasks", { p_id: id });

// Contact log, document requests and items logged by hand (011). These record what a person did: nothing is sent.
export const clientContactLog = (s, p) => call(s, "client_contact_log", { p });
export const clientDocumentRequest = (s, p) => call(s, "client_document_request", { p });
export const alertManualTypes = (s) => call(s, "alert_manual_types", {});
export const alertManualRaise = (s, type, client, detail, due) => call(s, "alert_manual_raise", { p_type: type, p_client: client, p_detail: detail || null, p_due: due || null });

// Business Setup's own checklist function (migration 022): it checks who may work the item. The alert closes at the next scan.
export const checklistItemDone = (s, id) => call(s, "business_setup_checkpoint_set", { p_id: id, p_status: "Completed", p_note: null });
