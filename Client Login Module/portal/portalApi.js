// Talks to the client-portal Edge Function. Clients are not Supabase users: their session is a token
// kept in this browser tab only, so closing the tab signs them out.
const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/client-portal`;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;
const KEY = "crm_client_portal_token";

export const DOC_TYPES = ["Trade Licence", "MOA / AOA", "Passport / ID", "Bank Statement", "Invoice", "VAT Document", "Corporate Tax Document", "Other"];

export function getPortalToken() {
  try { return sessionStorage.getItem(KEY); } catch { return null; }
}

async function post(body, bearer = ANON) {
  const res = await fetch(FN, { method: "POST", headers: { "Content-Type": "application/json", apikey: ANON, Authorization: `Bearer ${bearer}` }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || "Something went wrong. Please try again."), { termsRequired: !!data.terms_required, signedOut: !!data.signed_out });
  return data;
}

// Staff actions run with the staff member's own login.
export const staffPost = (accessToken, action, body = {}) => post({ action, ...body }, accessToken);

export async function portalLogin(username, password) {
  const { token } = await post({ action: "login", username, password });
  sessionStorage.setItem(KEY, token);
}

// A request link (?client_link=...): exchanged for the same kind of session as a password sign-in. Replaces any session in this tab.
export async function portalLinkLogin(link) {
  const { token } = await post({ action: "link_login", link });
  sessionStorage.setItem(KEY, token);
}

function signOutLocally() {
  try { sessionStorage.removeItem(KEY); } catch { /* storage blocked: nothing to clear */ }
  window.location.reload();
}

async function call(action, body = {}) {
  try {
    return await post({ action, token: getPortalToken(), ...body });
  } catch (e) {
    if (e.signedOut) signOutLocally();
    // New Terms were published while this page was open: reload, and the gate asks for agreement.
    if (e.termsRequired) window.location.reload();
    throw e;
  }
}

export const portalApi = {
  load: () => call("me"),
  terms: () => call("terms_get"),
  acceptTerms: (terms_id) => call("terms_accept", { terms_id }),
  docUrl: async (id) => (await call("doc_url", { id })).url,
  submitChange: (field, value) => call("submit_change", { field, value }),
  galleryUrl: async (source, id) => (await call("gallery_url", { source, id })).url,
  setupView: () => call("setup_view"),
  requests: async () => (await call("requests")).requests,
  requestShared: (id) => call("request_shared", { id }),
  formSave: (answers) => call("form_save", { answers }),
  formSubmit: () => call("form_submit"),
  setupDecide: (document_id, decision, note) => call("setup_decide", { document_id, decision, note }),
  // The client's own proposals with every option, and their reply: choose an option or comment. Accept and Reject go through setupDecide.
  proposals: async () => (await call("proposals")).proposals,
  proposalReply: (document_id, kind, option, comment) => call("proposal_reply", { document_id, kind, option, comment }),
  // "I have paid". The optional proof goes up first as this login's own upload, then the claim names it.
  setupClaim: async ({ invoice_id, amount, paid_on, reference }, file) => {
    let proof_id;
    if (file) {
      const { id, upload_url, mime } = await call("upload_start", { file_name: file.name, size: file.size, for_claim: true });
      const put = await fetch(upload_url, { method: "PUT", headers: { "Content-Type": mime }, body: file });
      if (!put.ok) throw new Error(`${file.name} could not be uploaded. Please try again.`);
      await call("upload_done", { id });
      proof_id = id;
    }
    return call("setup_payment_claim", { invoice_id, amount, paid_on, reference, proof_id });
  },
  setupFile: async (kind, id) => (await call("setup_file", { kind, id })).url,
  formUpload: async (file, doc_type) => {
    const { id, upload_url, mime } = await call("upload_start", { file_name: file.name, size: file.size, doc_type, for_form: true });
    const put = await fetch(upload_url, { method: "PUT", headers: { "Content-Type": mime }, body: file });
    if (!put.ok) throw new Error(`${file.name} could not be uploaded. Please try again.`);
    await call("upload_done", { id });
  },
  logout: async () => {
    try { await call("logout"); } finally { signOutLocally(); }
  },
  upload: async (file, { doc_type, note }) => {
    const { id, upload_url, mime } = await call("upload_start", { file_name: file.name, size: file.size, doc_type, note });
    const put = await fetch(upload_url, { method: "PUT", headers: { "Content-Type": mime }, body: file });
    if (!put.ok) throw new Error(`${file.name} could not be uploaded. Please try again.`);
    await call("upload_done", { id });
  },
};
