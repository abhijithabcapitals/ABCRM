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
  if (!res.ok) throw Object.assign(new Error(data.error || "Something went wrong. Please try again."), { signedOut: !!data.signed_out });
  return data;
}

// Staff actions run with the staff member's own login.
export const staffPost = (accessToken, action, body = {}) => post({ action, ...body }, accessToken);

export async function portalLogin(username, password) {
  const { token } = await post({ action: "login", username, password });
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
    throw e;
  }
}

export const portalApi = {
  load: () => call("me"),
  docUrl: async (id) => (await call("doc_url", { id })).url,
  submitChange: (field, value) => call("submit_change", { field, value }),
  galleryUrl: async (source, id) => (await call("gallery_url", { source, id })).url,
  changePassword: (current, next) => call("change_password", { current, next }),
  setupView: () => call("setup_view"),
  formSave: (answers) => call("form_save", { answers }),
  formSubmit: () => call("form_submit"),
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
