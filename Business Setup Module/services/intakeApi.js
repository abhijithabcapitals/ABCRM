// Talks to the setup-intake Edge Function: the public form, with no login. No staff code and no Supabase session here, because the public page imports it.
const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/setup-intake`;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const intakeToken = () => {
  try { return new URLSearchParams(window.location.search).get("intake"); } catch { return null; }
};

export const intakeUrl = (token) => `${window.location.origin}${import.meta.env.BASE_URL}?intake=${encodeURIComponent(token)}`;

export async function intakePost(body, bearer = ANON) {
  const res = await fetch(FN, { method: "POST", headers: { "Content-Type": "application/json", apikey: ANON, Authorization: `Bearer ${bearer}` }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

export async function intakeUpload(token, submissionId, file, kind) {
  const { upload_url, mime } = await intakePost({ action: "upload_start", token, submission_id: submissionId, kind, filename: file.name, size: file.size });
  const put = await fetch(upload_url, { method: "PUT", headers: { "Content-Type": mime }, body: file });
  if (!put.ok) throw new Error(`${file.name} could not be uploaded. Please try again.`);
}
