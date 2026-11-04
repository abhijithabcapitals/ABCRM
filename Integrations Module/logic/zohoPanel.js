// Decisions for the Zoho panel. No React and no network, so the rules can be tested alone.

export const NOT_CONNECTED = "Invoice: Zoho is not connected yet. You can still send this to Accounts.";
export const NO_QUOTE = "No accepted quotation yet.";
export const NO_MASTER = "This client is not linked to Client Master, so it cannot be linked to Zoho yet.";
export const NO_MATCH = "No match. Add the contact in Zoho, then search again.";
// The text the function sends when the credentials are not saved. The notice above already covers it.
const CREDENTIALS_MISSING = "Zoho credentials are missing.";

export const KIND_LABEL = { estimate: "Estimate", invoice: "Invoice" };

// Which of the six modes one kind of document is in. A saved row wins over the connection state.
// A link that is not known to exist counts as missing, so nothing can be created early.
export function panelMode({ connected, linked, row } = {}) {
  const s = row?.state;
  if (s === "created" || s === "failed" || s === "gone") return s;
  if (s === "unknown" || s === "creating") return "unknown";
  if (connected === false) return "not_connected";
  if (linked !== true) return "needs_contact";
  return "ready";
}

// Accepts one flag, or a flag for each kind.
export function createRights(canCreate) {
  if (canCreate && typeof canCreate === "object") return { estimate: !!canCreate.estimate, invoice: !!canCreate.invoice };
  return { estimate: !!canCreate, invoice: !!canCreate };
}

const CREATE_LABEL = { ready: "Create draft", failed: "Try again", gone: "Create again", unknown: "Check and try again" };

// A job invoice voided in Zoho can be made again once its number is no longer on the job. While it is still there,
// the row's own warning says to clear it on the job, so no button is offered. The server refuses early attempts too.
export function canReissue(sourceTable, row) {
  if (sourceTable !== "accounting_jobs" || row?.state !== "created") return false;
  if (String(row.zoho_status ?? "").toLowerCase() !== "void") return false;
  return !/clear it on the job/i.test(`${row.error ?? ""} ${row.read_error ?? ""}`);
}

// Which buttons and links one row shows. reissue: a voided job invoice that may be created again.
export function rowActions(mode, { canCreate, connected, linked, hasUrl, reissue } = {}) {
  const retry = mode === "failed" || mode === "gone" || mode === "unknown";
  const again = mode === "created" && !!reissue;
  const canMake = !!canCreate && connected !== false && linked === true && (mode === "ready" || retry || again);
  return {
    create: canMake ? (again ? "Create invoice" : CREATE_LABEL[mode]) : null,
    viewPdf: mode === "created",
    openZoho: mode === "created" && !!hasUrl,
  };
}

// Notes for one row, each as { tone: "warn" | "error", text }.
export function rowNotes(row, mode) {
  const notes = [];
  if (!row) return notes;
  if (row.total_warning) notes.push({ tone: "warn", text: "The total in Zoho does not match the CRM total. Check the draft in Zoho before using it." });
  if (row.vat_warning === true) notes.push({ tone: "warn", text: "VAT on this draft differs from the CRM. Check it in Zoho before sending." });
  if (row.earlier_draft) notes.push({ tone: "warn", text: `An earlier draft, ${row.earlier_draft}, may still exist in Zoho. Check that it is not used by mistake.` });
  if (row.error) notes.push({ tone: mode === "failed" ? "error" : "warn", text: String(row.error) });
  if (row.read_error && row.read_error !== row.error) notes.push({ tone: "warn", text: String(row.read_error) });
  if (row.adopted_count) notes.push({ tone: "warn", text: "An existing Zoho draft with this reference was found and linked instead of making a new one." });
  return notes;
}

// Notes for the whole panel. A row's own read_error is shown on that row, not here.
export function panelNotes({ connected, readError }) {
  if (connected !== false) return [];
  const notes = [{ tone: "warn", text: NOT_CONNECTED }];
  if (readError && readError !== CREDENTIALS_MISSING) notes.push({ tone: "warn", text: String(readError) });
  return notes;
}

// A contact in another currency cannot be used, because CRM amounts are in AED.
export function contactLinkable(contact) {
  return !contact?.currency_code || String(contact.currency_code).toUpperCase() === "AED";
}

export function contactLine(c) {
  return [c.name, c.tax_reg_no ? `TRN ${c.tax_reg_no}` : "No TRN", c.currency_code || "No currency"].join(" · ");
}

export function replaceQuestion(currentName) {
  return `This client is linked to ${currentName}. Replace it?`;
}

// What to do with the reply from document_pdf. A PDF arrives as a Blob. Anything else is an error reply.
export function pdfReply(data) {
  if (data && typeof data === "object" && typeof data.size === "number" && String(data.type).toLowerCase().startsWith("application/pdf")) {
    return { ok: true };
  }
  const text = data && typeof data === "object" && typeof data.error === "string" ? data.error : "";
  return { ok: false, message: text || "Zoho did not return a PDF." };
}

export function formatAmount(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
}

export const NO_ACCESS = "You don't have access to Zoho details here.";
export const NO_VIEW = "You can't view quotations here.";
export const QUOTE_READ_FAILED = "Could not read the quotation.";
export const LINK_READ_FAILED = "Could not read the Zoho contact link. Press Refresh to try again.";
export const POPUP_BLOCKED = "Your browser blocked the new tab. Allow pop-ups for this site and try again.";

// Only links that point at Zoho Books are shown.
export function safeZohoUrl(url) {
  return typeof url === "string" && url.startsWith("https://books.zoho.") ? url : null;
}

// The message from a failed function call: the function's own JSON error, or the library's text.
export async function readInvokeError(error) {
  let message = error?.message || "Something went wrong talking to Zoho.";
  try { message = (await error.context?.json())?.error || message; } catch { /* keep message */ }
  return message;
}

// One call to the zoho-books function. Returns the data (a Blob for a PDF) or throws an Error with a readable message.
export async function callZoho(supabase, body) {
  const { data, error } = await supabase.functions.invoke("zoho-books", { body });
  if (error) throw new Error(await readInvokeError(error));
  if (data && typeof data === "object" && typeof data.error === "string") throw new Error(data.error);
  // The function answers "not connected" with a normal reply. Only the state read treats that as a result.
  if (data?.connected === false && body?.action !== "document_state") {
    throw new Error(typeof data.message === "string" && data.message ? data.message : "Zoho is not connected.");
  }
  return data;
}

// A counter that tells a late reply whether it still belongs to the screen that asked.
export function makeGuard() {
  let n = 0;
  return { token: () => n, valid: (t) => t === n, next: () => ++n };
}

// Saves a contact link. Either it is saved, or the client already has another contact and staff must confirm.
export async function linkContact({ call, clientId, department, contact, replace }) {
  const out = await call({ action: "contact_link", client_id: clientId, zoho_contact_id: contact.id, department, ...(replace ? { replace: true } : {}) });
  if (out?.needs_replace) return { status: "needs_replace", currentName: out.current_name };
  return { status: "linked", name: out?.zoho_contact_name || contact.name };
}

// Opens the PDF in a tab that was opened on the click. Dependencies are passed in so each step can be tested.
// openTab must be called straight from the click, before any await.
export async function openPdf({ openTab, fetchPdf, makeUrl, later, revoke, isStale = () => false, delay = 60000 }) {
  const tab = openTab();
  if (!tab) return { ok: false, message: POPUP_BLOCKED };
  try { tab.opener = null; } catch { /* ignore */ }
  try {
    const data = await fetchPdf();
    if (isStale()) { tab.close(); return { ok: false, stale: true }; }
    const reply = pdfReply(data);
    if (!reply.ok) throw new Error(reply.message);
    const url = makeUrl(data);
    tab.location.href = url;
    later(() => revoke(url), delay);
    return { ok: true };
  } catch (e) {
    tab.close();
    return { ok: false, message: e.message };
  }
}
