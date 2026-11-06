// Reads every Accounting quote and agreement made with migration 008 and their mail drafts, newest first, page by page.
// No imports, so the paging is tested with fake page readers. accountingApi.js passes the Supabase readers.
export const ACCOUNTING_TEMPLATES = ["AB Capital/Accounting Quote", "AB Capital/Accounting Agreement"];
export const PAGE = 1000;      // Supabase answers at most this many rows per request
export const MAX_ROWS = 20000; // a ceiling far above the 2000 the screen must reach, so a runaway loop stops
export const ID_CHUNK = 100;   // parent ids per mail request, to keep the URL short

// readPage(from, to) returns rows from..to (inclusive) in a fixed order; stops at a short page.
export async function readAll(readPage, { page = PAGE, max = MAX_ROWS } = {}) {
  const rows = [];
  for (let from = 0; from < max; from += page) {
    const got = (await readPage(from, Math.min(from + page, max) - 1)) || [];
    rows.push(...got);
    if (got.length < page) break;
  }
  return rows;
}

// readDocs(from, to): rows whose library_template is one of ACCOUNTING_TEMPLATES, ordered by created_at desc.
// readMail(parentIds, from, to): mail rows whose parent_id is in parentIds, in the same order.
// Returns documents and mail rows together, newest first, as the old desk list did.
export async function loadAccountingDocs({ readDocs, readMail }, opts = {}) {
  const docs = await readAll(readDocs, opts);
  const ids = docs.map((d) => d.id);
  const mail = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    mail.push(...(await readAll((from, to) => readMail(chunk, from, to), opts)));
  }
  return [...docs, ...mail].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
}
