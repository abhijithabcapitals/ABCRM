// Supabase access for the Business Setup module. The generic helpers are Banking's; the functions below are this module's.
import { rpc, run, table } from "@banking/services/bankingApi";

export { rpc, table, run, listAll, insertRow, updateRow, profiles } from "@banking/services/bankingApi";

export const myAccess = () => rpc("business_setup_my_access");
export const saveSetting = (key, value) => rpc("business_setup_settings_save", { p_key: key, p_value: value });
export const listSettings = () => run(table("business_setup_settings").select("*").is("archived_at", null).order("key"));
export const listStaff = () => run(table("business_setup_staff").select("*").is("archived_at", null));
export const saveStaff = (userId, role) => run(table("business_setup_staff").upsert({ user_id: userId, role, archived_at: null }));
export const removeStaff = (userId) => run(table("business_setup_staff").update({ archived_at: new Date().toISOString() }).eq("user_id", userId));
