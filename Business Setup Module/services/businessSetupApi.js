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
export const saveClientContact = (client, data, version) => rpc("client_master_save", { p_id: client, p_data: data, p_version: version });
export const saveVisa = (p) => rpc("business_setup_visa_save", { p });

// Fees and templates
export const listFees = () => run(table("business_setup_fee_items").select("*").order("sort_order"));
export const saveFee = (p) => rpc("business_setup_fee_item_save", { p });
export const listQuoteTemplates = () => run(table("business_setup_quote_templates").select("*").order("label"));
export const saveQuoteTemplate = (p) => rpc("business_setup_quote_template_save", { p });

// Quotes and services
export const rejectQuote = (id, reason) => rpc("business_setup_quote_reject", { p_id: id, p_reason: reason });
export const linkQuote = (id, client) => rpc("business_setup_quote_link", { p_id: id, p_client: client });
export const signLetter = (id, date, path) => rpc("business_setup_letter_sign", { p_id: id, p_date: date, p_path: path });
export const updateService = (id, status, fields = {}, reason = null) => rpc("business_setup_service_update", { p_id: id, p_status: status, p_fields: fields, p_reason: reason });
export const completeService = (id, details, reason = null) => rpc("business_setup_service_complete", { p_id: id, p_output_details: details, p_reason: reason });

// Money
export const addPayment = (p) => rpc("business_setup_payment_add", { p });
export const addRefund = (p) => rpc("business_setup_refund_add", { p });
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
// The login name for the quote message: id, username and status, for anyone who may issue quotes.
export const loginName = (client) => rpc("business_setup_portal_login_name", { p_client: client });
export const loginState = (client) => rpc("business_setup_portal_login_state", { p_client: client });
export const loginSave = (client, username, password) => rpc("business_setup_portal_login_save", { p_client: client, p_username: username, p_password: password });
export const loginStatus = (client, active) => rpc("business_setup_portal_login_status", { p_client: client, p_active: active });

// Cases and leads
export const caseList = (view) => rpc("business_setup_case_list", { p_view: view });
export const caseNew = (p) => rpc("business_setup_case_new", { p });
export const caseTake = (id) => rpc("business_setup_case_take", { p_case: id });
// The same checked step for Finance, on the payment right (no login is issued).
export const caseLinkClientForPayment = (id, client = null, allowDuplicate = false) => rpc("business_setup_case_link_client_for_payment", { p_case: id, p_client: client, p_allow_duplicate: allowDuplicate });
export const caseLinkClient = (id, client = null, allowDuplicate = false) => rpc("business_setup_case_link_client", { p_case: id, p_client: client, p_allow_duplicate: allowDuplicate });
export const caseShared = (id) => rpc("business_setup_case_shared", { p_case: id });
export const caseLost = (id, reason) => rpc("business_setup_case_lost", { p_case: id, p_reason: reason });
export const caseConfirm = (id) => rpc("business_setup_case_confirm", { p_case: id });
export const caseAssign = (id, to, note) => rpc("business_setup_case_assign", { p_case: id, p_to: to, p_note: note });
export const reassignRequest = (id, to, reason) => rpc("business_setup_reassign_request", { p_case: id, p_to: to, p_reason: reason });
export const reassignRespond = (id, approve, note) => rpc("business_setup_reassign_respond", { p_id: id, p_approve: approve, p_note: note });

// A reviewer completes the client's form. Staff files go to staff/<client_id>/ in the bucket the client portal uses.
export const formStaffSave = (id, answers) => rpc("business_setup_form_staff_save", { p_id: id, p_answers: answers });
export const formDocAdd = (id, kind, path) => rpc("business_setup_form_doc_add", { p_id: id, p_kind: kind, p_path: path });
export async function addStaffFormDocument(formId, clientId, kind, file) {
  const path = `staff/${clientId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
  const { error } = await supabase.storage.from("client-portal").upload(path, file);
  if (error) throw new Error(error.message);
  return formDocAdd(formId, kind, path);
}

// Accounts
export const handoverState = (quote) => rpc("business_setup_handover_state", { p_quote: quote });
export const sendToAccounts = (quote, remarks) => rpc("business_setup_send_to_accounts", { p_quote: quote, p_remarks: remarks });

// Import
export const latestImport = async () => (await run(table("business_setup_import_rows").select("import_id").order("created_at", { ascending: false }).limit(1)))?.[0]?.import_id || null;
export const importReport = (id) => rpc("business_setup_import_report", { p_import: id });
export const importDecide = (row, client, decision) => rpc("business_setup_import_decide", { p_row: row, p_client: client, p_decision: decision });
export const importApply = (id) => rpc("business_setup_import_apply", { p_import: id });

// Signed copies of quotes. A client uploads through the portal; staff add one under staff/<client_id>/ in the same bucket.
export const listSigned = (quote) => run(table("business_setup_signed_quotes").select("id,quote_id,source,status,note,storage_path,created_at,decided_at").eq("quote_id", quote).order("created_at", { ascending: false }));
export const signedAdd = (quote, path) => rpc("business_setup_signed_add", { p_quote: quote, p_path: path });
export const signedDecide = (id, confirm, note = null, allowExpired = false) => rpc("business_setup_signed_decide", { p_id: id, p_confirm: confirm, p_note: note, p_allow_expired: allowExpired });
export async function addStaffSignedCopy(quote, clientId, file) {
  const path = `staff/${clientId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
  const { error } = await supabase.storage.from("client-portal").upload(path, file);
  if (error) throw new Error(error.message);
  return signedAdd(quote, path);
}

// Payment by case, and a case's documents when it has no client yet
export const invoiceRecord = (p) => rpc("business_setup_invoice_record", { p });
export const caseInvoiceOverride = (id, reason) => rpc("business_setup_case_invoice_override", { p_case: id, p_reason: reason });
export const caseInvoices = (caseId) => run(table("business_setup_invoices").select("id,invoice_number,issued_on,amount,file_path,source,created_at").eq("case_id", caseId).order("created_at", { ascending: false }));
export const casePaidOverride = (id, reason) => rpc("business_setup_case_paid_override", { p_case: id, p_reason: reason });
export const caseDocuments = (id) => rpc("business_setup_case_documents", { p_case: id });
