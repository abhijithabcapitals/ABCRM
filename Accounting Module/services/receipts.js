// Word receipt for a recorded payment. The payment and its number are already saved; if the file fails, this throws
// and the screen offers Create file again.
import { loadHubSettings } from "@template-hub/services/hubApi";
import { receiptDocx } from "@banking/logic/documents";
import { storeReceipt } from "./jobsApi";

// payment: the result of accounting_payment_add (receipt_id, receipt_number, amount, paid_on, method, reference, note).
export async function fileReceipt(payment, job) {
  const settings = await loadHubSettings();
  const { blob, fileName } = await receiptDocx(
    { banking_receipts: { receipt_number: payment.receipt_number }, payment_date: payment.paid_on, amount: payment.amount, payment_method: payment.method, transaction_reference: payment.reference, payment_ref: payment.receipt_number, description: payment.note },
    { display_name: job.client_name }, { case_ref: job.job_number }, settings.company);
  await storeReceipt(payment.receipt_id, blob, fileName);
  const { saveAs } = await import("file-saver");
  saveAs(blob, fileName);
}
