// Supabase access for the Accounting pipeline. Reads use the job list view (balance and status come from it); every
// write goes through a database function.
import { rpc, run, table } from "@banking/services/bankingApi";
import { supabase } from "@app/supabase";
import { lastContactByJob } from "../logic/jobs";

// updated_at is passed back exactly as received. A JS Date would cut the microseconds and cause a false "reload" error.

// Supabase caps a response at 1,000 rows, so lists are read page by page until a short page. The id breaks ties so pages never overlap.
const PAGE = 1000;
async function pageAll(build) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const page = (await run(build().range(from, from + PAGE - 1))) || [];
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

export const listJobs = () => pageAll(() => table("accounting_job_list").select("*").order("created_at", { ascending: false }).order("id"));

export async function getJob(id) {
  const [jobs, batches, payments, followUps, events] = await Promise.all([
    run(table("accounting_job_list").select("*").eq("id", id)),
    run(table("accounting_job_batches").select("*, accounting_job_files(*)").eq("job_id", id).order("received_on", { ascending: false })),
    run(table("accounting_payments").select("*, accounting_receipts(*)").eq("job_id", id).order("created_at", { ascending: false })),
    run(table("accounting_followups").select("*").eq("job_id", id).order("created_at", { ascending: false })),
    run(table("accounting_job_events").select("*").eq("job_id", id).order("created_at", { ascending: false })),
  ]);
  const job = jobs?.[0];
  if (!job) throw new Error("Job not found");
  return {
    ...job,
    batches: (batches || []).map(({ accounting_job_files, ...b }) => ({ ...b, files: accounting_job_files || [] })),
    payments: (payments || []).map(({ accounting_receipts, ...p }) => ({ ...p, receipt: Array.isArray(accounting_receipts) ? accounting_receipts[0] || null : accounting_receipts || null })),
    follow_ups: followUps || [],
    events: events || [],
  };
}

// The client master for accounts.review users, in the shape of client_lookup rank 1 rows.
export const clientOptions = () => rpc("accounting_client_options");

export const saveJob = (p) => rpc("accounting_job_save", { p });
export const setStatus = (job, status, remarks, expected) => rpc("accounting_job_set_status", { p_job: job, p_status: status, p_remarks: remarks ?? null, p_expected: expected });
export const setFee = (job, amount) => rpc("accounting_job_set_fee", { p_job: job, p_amount: amount });
export const linkDocument = (job, kind, doc, useTotal = false) => rpc("accounting_job_link_document", { p_job: job, p_kind: kind, p_doc: doc, p_use_quote_total: useTotal });
export const linkClient = (job, clientId) => rpc("accounting_job_link_client", { p_job: job, p_client: clientId });
export const addBatch = (p) => rpc("accounting_batch_add", { p });
export const setBatchSaved = (batch, saved) => rpc("accounting_batch_set_saved", { p_batch: batch, p_saved: saved });
export const setInvoice = (job, number, date, amount) => rpc("accounting_invoice_set", { p_job: job, p_number: number, p_date: date, p_amount: amount });
export const clearInvoice = (job, reason) => rpc("accounting_invoice_clear", { p_job: job, p_reason: reason });
export const addPayment = (p) => rpc("accounting_payment_add", { p });
export const reversePayment = (id, reason) => rpc("accounting_payment_reverse", { p_payment: id, p_reason: reason });
export const addFollowUp = (p) => rpc("accounting_followup_add", { p });

// Completed jobs with a balance, oldest completion first. last_contact is the newest contacted_on, read only for the listed jobs.
const ID_CHUNK = 100;
export async function listFollowUps() {
  const rows = await pageAll(() => table("accounting_job_list").select("*").eq("follow_up_listed", true).order("completed_at", { ascending: true }).order("id"));
  const ids = rows.map((r) => r.id);
  const chunks = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) chunks.push(ids.slice(i, i + ID_CHUNK));
  const contacts = (await Promise.all(chunks.map((c) => pageAll(() => table("accounting_followups").select("job_id, contacted_on").in("job_id", c).order("contacted_on", { ascending: false }).order("id"))))).flat();
  const last = lastContactByJob(contacts);
  return rows.map((r) => ({ ...r, last_contact: last[r.id] || null }));
}
export async function followUpsDueCount() {
  const { count, error } = await supabase.from("accounting_job_list").select("id", { count: "exact", head: true }).eq("follow_up_due", true);
  if (error) throw new Error(error.message);
  return count || 0;
}

const attachReceipt = (id, path) => rpc("accounting_receipt_attach", { p_id: id, p_path: path });
export async function storeReceipt(receiptId, blob, fileName) {
  const path = `Accounting/receipts/${receiptId}/${crypto.randomUUID()}.docx`;
  const { error } = await supabase.storage.from("hub-documents").upload(path, new File([blob], fileName, { type: blob.type }));
  if (error) throw new Error(error.message);
  await attachReceipt(receiptId, path);
  return path;
}
