// Supabase access for the Business Setup module. The generic helpers are Banking's; the functions below are this module's.
import { rpc, run, table } from "@banking/services/bankingApi";
import { supabase } from "@app/supabase";

export { rpc, table, run, listAll, insertRow, updateRow, profiles } from "@banking/services/bankingApi";

const BUCKET = "business-setup-documents";

export const myAccess = () => rpc("business_setup_my_access");
export const saveSetting = (key, value) => rpc("business_setup_settings_save", { p_key: key, p_value: value });
export const listSettings = () => run(table("business_setup_settings").select("*").is("archived_at", null).order("key"));
export const listStaff = () => run(table("business_setup_staff").select("*").is("archived_at", null));
export const saveStaff = (userId, role) => run(table("business_setup_staff").upsert({ user_id: userId, role, archived_at: null }));
export const removeStaff = (userId) => run(table("business_setup_staff").update({ archived_at: new Date().toISOString() }).eq("user_id", userId));

// Pages
export const dashboard = () => rpc("business_setup_dashboard");
export const expiries = (days = 90) => rpc("business_setup_expiries", { p_days: days });
export const clientList = () => rpc("business_setup_client_list");
export const workspace = (client) => rpc("business_setup_workspace", { p_client: client });
export const listTasks = () => run(table("business_setup_tasks").select("*").eq("status", "Open").order("due_date", { nullsFirst: false }));
export const saveTask = (p) => rpc("business_setup_task_save", { p });
export const usdRate = async () => {
  const rows = await run(table("business_setup_settings").select("value").eq("key", "usd_rate"));
  return Number(rows?.[0]?.value) || null;
};

// KYC
export const saveKyc = (client, p) => rpc("business_setup_kyc_save", { p_client: client, p });
export const savePartner = (client, p) => rpc("business_setup_partner_save", { p_client: client, p });
export const deletePartner = (id) => rpc("business_setup_partner_delete", { p_id: id });

// Fees and templates
export const listFees = () => run(table("business_setup_fee_items").select("*").order("sort_order"));
export const saveFee = (p) => rpc("business_setup_fee_item_save", { p });
export const listQuoteTemplates = () => run(table("business_setup_quote_templates").select("*").order("label"));
export const saveQuoteTemplate = (p) => rpc("business_setup_quote_template_save", { p });

// Quotes and services
export const acceptQuote = (id, allowExpired = false) => rpc("business_setup_quote_accept", { p_id: id, p_allow_expired: allowExpired });
export const rejectQuote = (id, reason) => rpc("business_setup_quote_reject", { p_id: id, p_reason: reason });
export const linkQuote = (id, client) => rpc("business_setup_quote_link", { p_id: id, p_client: client });
export const signLetter = (id, date, path) => rpc("business_setup_letter_sign", { p_id: id, p_date: date, p_path: path });
export const updateService = (id, status, fields = {}, reason = null) => rpc("business_setup_service_update", { p_id: id, p_status: status, p_fields: fields, p_reason: reason });
export const completeService = (id, details, reason = null) => rpc("business_setup_service_complete", { p_id: id, p_output_details: details, p_reason: reason });

// Money
export const addPayment = (p) => rpc("business_setup_payment_add", { p });
export const reversePayment = (id, reason) => rpc("business_setup_payment_reverse", { p_id: id, p_reason: reason });
export const attachReceipt = (id, path) => rpc("business_setup_receipt_attach", { p_id: id, p_path: path });
export async function storeReceipt(receiptId, blob, fileName) {
  const path = `Business Setup/receipts/${receiptId}/${crypto.randomUUID()}.docx`;
  const { error } = await supabase.storage.from("hub-documents").upload(path, new File([blob], fileName, { type: blob.type }));
  if (error) throw new Error(error.message);
  await attachReceipt(receiptId, path);
  return path;
}

// Files: private bucket, opened through short signed links
export async function uploadFile(client, file, folder = "files") {
  const path = `${client}/${folder}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file);
  if (error) throw new Error(error.message);
  return path;
}
export async function openDocument(path) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 120);
  if (error) throw new Error(error.message);
  window.open(data.signedUrl, "_blank", "noopener");
}
export const addDocument = (p) => rpc("business_setup_document_add", { p });

// Forms
export const listForms = (status = null) => rpc("business_setup_form_list", { p_status: status });
export const formDetail = (id) => rpc("business_setup_form_detail", { p_id: id });
export const takeForm = (id) => rpc("business_setup_form_take", { p_id: id });
export const returnForm = (id, note) => rpc("business_setup_form_return", { p_id: id, p_note: note });
export const validateForm = (id, contact, version) => rpc("business_setup_form_validate", { p_id: id, p_contact: contact, p_version: version });

// Client login
export const loginState = (client) => rpc("business_setup_portal_login_state", { p_client: client });
export const loginSave = (client, username, password) => rpc("business_setup_portal_login_save", { p_client: client, p_username: username, p_password: password });
export const loginStatus = (client, active) => rpc("business_setup_portal_login_status", { p_client: client, p_active: active });

// Accounts
export const handoverState = (quote) => rpc("business_setup_handover_state", { p_quote: quote });
export const sendToAccounts = (quote, remarks) => rpc("business_setup_send_to_accounts", { p_quote: quote, p_remarks: remarks });

// Import
export const latestImport = async () => (await run(table("business_setup_import_rows").select("import_id").order("created_at", { ascending: false }).limit(1)))?.[0]?.import_id || null;
export const importReport = (id) => rpc("business_setup_import_report", { p_import: id });
export const importDecide = (row, client, decision) => rpc("business_setup_import_decide", { p_row: row, p_client: client, p_decision: decision });
export const importApply = (id) => rpc("business_setup_import_apply", { p_import: id });
