// Rules for the Improvements page that need no database, so node --test can check them.

export const CATEGORIES = [
  ["idea", "Idea"],
  ["problem", "Problem / bug"],
  ["request", "Feature request"],
  ["other", "Other"],
];

export const STATUSES = [
  ["new", "New"],
  ["seen", "Seen"],
  ["planned", "Planned"],
  ["done", "Done"],
  ["declined", "Declined"],
];

export const STATUS_COLOURS = {
  new: { bg: "#e6f6f6", fg: "#0e7f7d" },
  seen: { bg: "#eef1f6", fg: "#46536b" },
  planned: { bg: "#fff4e0", fg: "#9a5b00" },
  done: { bg: "#e7f6ea", fg: "#1f7a35" },
  declined: { bg: "#fbeaea", fg: "#a12a2a" },
};

// The bucket refuses anything else, so the page refuses it first with a clearer message.
export const MAX_FILES = 10;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"];
export const TITLE_MAX = 200;
export const DETAILS_MAX = 10000;

export const labelOf = (list, key) => (list.find(([k]) => k === key) || [key, key])[1];

// Adds new files to those already picked. Returns the files kept and one message per file left out.
export function addFiles(current, incoming) {
  const kept = [...current];
  const errors = [];
  for (const file of incoming) {
    if (kept.length >= MAX_FILES) { errors.push(`Only ${MAX_FILES} files per improvement: ${file.name} was left out.`); continue; }
    if (!ALLOWED_TYPES.includes(file.type)) { errors.push(`${file.name}: only PNG, JPG, GIF, WebP images or PDF.`); continue; }
    if (file.size > MAX_FILE_BYTES) { errors.push(`${file.name} is over 10 MB.`); continue; }
    kept.push(file);
  }
  return { files: kept, errors };
}

// A storage-safe file name: letters, digits, dot, dash and underscore only, at most 80 characters.
export function safeName(name) {
  const cleaned = String(name || "file").normalize("NFKD").replace(/[^\w.-]+/g, "_").replace(/_+/g, "_").replace(/^[._]+/, "");
  return (cleaned || "file").slice(-80);
}

// <user id>/<improvement id>/<uuid>-<file name>, the only place the database accepts a screenshot.
export const storagePath = (userId, improvementId, uuid, name) => `${userId}/${improvementId}/${uuid}-${safeName(name)}`;

// A screenshot pasted from the clipboard has no useful name; give it one.
export function namePasted(file, index, now = new Date()) {
  if (file.name && file.name !== "image.png") return file;
  const ext = (file.type.split("/")[1] || "png").replace("jpeg", "jpg");
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return new File([file], `screenshot-${stamp}-${index + 1}.${ext}`, { type: file.type });
}

// Empty string when the form can be sent, else what to fix.
export function formProblem({ title, details }) {
  const t = String(title || "").trim();
  if (!t) return "Add a short title.";
  if (t.length > TITLE_MAX) return `Keep the title under ${TITLE_MAX} characters.`;
  if (String(details || "").length > DETAILS_MAX) return `Keep the details under ${DETAILS_MAX} characters.`;
  return "";
}

// Rows the admin filter shows. "open" means anything not done or declined.
export function filterRows(rows, status) {
  if (!status || status === "all") return rows;
  if (status === "open") return rows.filter((r) => r.status !== "done" && r.status !== "declined");
  return rows.filter((r) => r.status === status);
}

export const isImage = (attachment) => String(attachment?.type || "").startsWith("image/");
