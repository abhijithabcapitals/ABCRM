// One fetcher per card, each returning the figures its card shows.
import { supabase } from "@app/supabase";
import { compliance } from "@client-module/crm/taxLogic";
import { BD_STAGES } from "@business-development/logic/businessDevelopmentData";
import {
  bdFigures, bankingFigures, setupFigures, accountingFigures, hrFigures, taxFigures, notificationFigures, alertFigures, readPages, NOTIFICATION_LIMIT, isNoAccess, isMissingTable, isMissingFunction,
} from "../logic/summaryFigures.js";

// Keeps error.code so the card can say "no access" instead of "failed".
function check({ data, error }) {
  if (error) {
    const e = new Error(error.message || "Request failed");
    e.code = error.code;
    e.noAccess = isNoAccess(error);
    throw e;
  }
  return data;
}

// `build` makes the query, ordered by a unique column so pages never overlap.
const allRows = (build) => readPages(async (from, to) => check(await build().range(from, to)));

export const summaryApi = {
  bd: async () => bdFigures(check(await supabase.rpc("bd_ui_leads", { p_limit: 500 })), BD_STAGES),
  banking: async () => bankingFigures(check(await supabase.rpc("banking_dashboard", { p_from: null, p_to: null, p_bank: null, p_employee: null }))),
  setup: async () => setupFigures(check(await supabase.rpc("business_setup_dashboard"))),
  accounting: async () => accountingFigures(await allRows(() => supabase.from("accounting_job_list").select("work_status, balance, follow_up_due, needs_invoice").order("id"))),
  hr: async () => hrFigures(check(await supabase.rpc("hr_dashboard"))),
  tax: async () => {
    const rows = await allRows(() => supabase.from("client_master").select("data").eq("status", "active").order("client_id"));
    return taxFigures(compliance(rows.map((r) => r.data)));
  },
  // A missing alert_tiles (migration not applied) reads as { missing: true }, not an error.
  alerts: async () => {
    try {
      return { ...alertFigures(check(await supabase.rpc("alert_tiles", { p_scope: "My" }))), missing: false };
    } catch (e) {
      if (isMissingFunction(e)) return { ...alertFigures(null), missing: true };
      throw e;
    }
  },
  notifications: async () => {
    const { data: auth } = await supabase.auth.getUser();
    const id = auth?.user?.id;
    if (!id) return notificationFigures([]);
    return notificationFigures(check(await supabase.from("notifications").select("*").eq("user_id", id).order("created_at", { ascending: false }).limit(NOTIFICATION_LIMIT)));
  },
};

const EMPTY_SNAPSHOT = { data: null, as_of: null, status: null, error: null, last_attempt_at: null };
const UNAVAILABLE = "The finance service is not available yet.";

// The one snapshot row. The Zoho cards share a single read of it.
// A missing table (migration not applied) reads as an empty snapshot, flagged with missingTable.
export async function readSnapshot() {
  try {
    const row = check(await supabase.from("zoho_finance_snapshot").select("data, as_of, status, error, last_attempt_at").eq("id", 1).maybeSingle());
    return row || EMPTY_SNAPSHOT;
  } catch (e) {
    if (isMissingTable(e)) return { ...EMPTY_SNAPSHOT, missingTable: true };
    throw e;
  }
}

// Asks the zoho-finance function to rebuild the row: { status: "ok" | "partial" | "failed" | "busy" | "fresh", error? }.
// A message the function itself sent is kept. A function that is not deployed, or a network failure, gets one plain line.
export async function refreshSnapshot(force = false) {
  const { data, error } = await supabase.functions.invoke("zoho-finance", { body: { action: "refresh", force } });
  if (error) {
    let message = "";
    try { message = (await error.context?.json())?.error || ""; } catch { /* no body from the function */ }
    throw new Error(message || UNAVAILABLE);
  }
  return data;
}
