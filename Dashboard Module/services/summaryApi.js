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
