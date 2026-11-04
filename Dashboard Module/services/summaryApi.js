// One fetcher per card, each returning the figures its card shows.
import { supabase } from "@app/supabase";
import { compliance } from "@client-module/crm/taxLogic";
import { BD_STAGES } from "@business-development/logic/businessDevelopmentData";
import {
  bdFigures, bankingFigures, setupFigures, accountingFigures, hrFigures, taxFigures, notificationFigures, isNoAccess,
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

export const summaryApi = {
  bd: async () => bdFigures(check(await supabase.rpc("bd_ui_leads", { p_limit: 500 })), BD_STAGES),
  banking: async () => bankingFigures(check(await supabase.rpc("banking_dashboard", { p_from: null, p_to: null, p_bank: null, p_employee: null }))),
  setup: async () => setupFigures(check(await supabase.rpc("business_setup_dashboard"))),
  accounting: async () => accountingFigures(check(await supabase.from("accounting_job_list").select("work_status, balance, follow_up_due, needs_invoice"))),
  hr: async () => hrFigures(check(await supabase.rpc("hr_dashboard"))),
  tax: async () => {
    const rows = check(await supabase.from("client_master").select("data").limit(5000));
    return taxFigures(compliance(rows.map((r) => r.data)));
  },
  notifications: async () => {
    const { data: auth } = await supabase.auth.getUser();
    const id = auth?.user?.id;
    if (!id) return notificationFigures([]);
    return notificationFigures(check(await supabase.from("notifications").select("*").eq("user_id", id).order("created_at", { ascending: false }).limit(50)));
  },
};

const EMPTY_SNAPSHOT = { data: null, as_of: null, status: null, error: null, last_attempt_at: null };

// The one snapshot row. The Zoho cards share a single read of it.
export async function readSnapshot() {
  const row = check(await supabase.from("zoho_finance_snapshot").select("data, as_of, status, error, last_attempt_at").eq("id", 1).maybeSingle());
  return row || EMPTY_SNAPSHOT;
}

// Asks the zoho-finance function to rebuild the row: { status: "ok" | "partial" | "failed" | "busy" | "fresh", error? }.
export async function refreshSnapshot(force = false) {
  const { data, error } = await supabase.functions.invoke("zoho-finance", { body: { action: "refresh", force } });
  if (error) {
    let message = error.message;
    try { message = (await error.context?.json())?.error || message; } catch { /* keep message */ }
    throw new Error(message);
  }
  return data;
}
