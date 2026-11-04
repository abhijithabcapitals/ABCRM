// Actions for the zoho-books Edge Function. Kept free of Deno and Supabase imports so tests can run offline.

export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

import { canCreate, clientVisible, dubaiToday, fromBanking, fromHub, type Kind, type Source, toZohoBody, totalsMatch, vatMissing } from "./mapping.ts";
import { ZohoAccessError, ZohoHttpError, ZohoTimeoutError } from "./zohoClient.ts";

// deno-lint-ignore no-explicit-any
type Json = any;

export type ZohoLike = {
  orgId: string;
  // Data centre, such as "ae". Used only to build the Open in Zoho link.
  dc: string;
  get(path: string, query?: Record<string, string>): Promise<Json>;
  getPdf(path: string): Promise<Uint8Array>;
  post(path: string, body: unknown, query?: Record<string, string>): Promise<Json>;
};

export type Deps = {
  isAdmin(): Promise<boolean>;
  can(department: string, permission: string): Promise<boolean>;
  // Service-role Supabase client.
  db: Json;
  zoho(): Promise<ZohoLike>;
  // The saved Zoho tax id for 5% VAT, or null when none is saved.
  vatTaxId(): Promise<string | null>;
  userId: string;
  now(): Date;
};

// The only error text the browser sees for a Zoho or unexpected failure. Raw detail stays in the server log.
export function browserMessage(e: unknown): string {
  if (e instanceof ZohoAccessError) return "Zoho access has stopped. An admin must reconnect.";
  if (e instanceof ZohoHttpError) {
    return e.status === 429 ? "Zoho is busy, try again shortly." : "Zoho refused the request.";
  }
  return "Something went wrong talking to Zoho.";
}

type Department = "business_setup" | "banking";
const RPC: Record<Department, string> = { business_setup: "business_setup_can", banking: "banking_can" };
const MANAGE: Record<Department, string> = { business_setup: "setup.quotes.manage", banking: "cases.manage" };
const VIEW: Record<Department, string> = { business_setup: "setup.access", banking: "cases.view" };

type Rpc = (name: string, args: { p_permission: string }) => Promise<{ data: unknown; error: unknown }>;

// Fails closed: an unknown department, a missing function, an error or anything but true means no.
export async function permissionCheck(rpc: Rpc, department: string, permission: string): Promise<boolean> {
  if (department !== "business_setup" && department !== "banking") return false;
  try {
    const { data, error } = await rpc(RPC[department], { p_permission: permission });
    return !error && data === true;
  } catch {
    return false;
  }
}

function departmentOf(body: Json): Department {
  const d = body?.department;
  if (d !== "business_setup" && d !== "banking") throw new UserError("Unknown department.");
  return d;
}

async function needPermission(deps: Deps, department: Department, permission: string) {
  if (!(await deps.can(department, permission))) {
    throw new UserError("You do not have permission to do this.");
  }
}

async function requireAdmin(deps: Deps) {
  if (!(await deps.isAdmin())) throw new UserError("Only a CRM admin can do this.");
}

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export async function handle(action: string, body: Json, deps: Deps): Promise<object> {
  try {
    return await run(action, body ?? {}, deps);
  } catch (e) {
    if ((e as Error)?.name === "MissingSecretError") {
      return { connected: false, message: "Zoho credentials are missing. Add them in Settings > Integrations." };
    }
    throw e;
  }
}

async function run(action: string, body: Json, deps: Deps): Promise<object> {
  if (action === "connection_test") {
    await requireAdmin(deps);
    const zoho = await deps.zoho();
    const res = await zoho.get("/organizations");
    const match = (res?.organizations ?? []).find((o: Json) => String(o?.organization_id) === zoho.orgId);
    if (!match) {
      return {
        connected: false,
        message: "Zoho answered, but the organisation in ZOHO_BOOKS_ORG_ID is not one this login can see. Check that setting.",
      };
    }
    return { connected: true, organisation: String(match.name ?? "") };
  }

  if (action === "taxes_list") {
    await requireAdmin(deps);
    const zoho = await deps.zoho();
    const res = await zoho.get("/settings/taxes");
    return { taxes: res?.taxes ?? [] };
  }

  if (action === "contacts_search") {
    const department = departmentOf(body);
    await needPermission(deps, department, MANAGE[department]);
    const query = text(body.query);
    if (!query) throw new UserError("Enter a name to search for.");
    const zoho = await deps.zoho();
    const res = await zoho.get("/contacts", { contact_name_contains: query });
    return {
      contacts: (res?.contacts ?? []).map((c: Json) => ({
        id: String(c.contact_id),
        name: c.contact_name,
        tax_reg_no: c.tax_reg_no ?? null,
        currency_code: c.currency_code,
      })),
    };
  }

  if (action === "contact_link") {
    const department = departmentOf(body);
    await needPermission(deps, department, MANAGE[department]);
    const clientId = text(body.client_id);
    const contactId = text(body.zoho_contact_id);
    if (!clientId) throw new UserError("Choose a client first.");
    if (!/^\d+$/.test(contactId)) throw new UserError("Choose a Zoho contact from the list.");
    // The client must belong to this department, and a different link is replaced only on request.
    const owner = department === "banking"
      ? await deps.db.from("banking_clients").select("id").eq("client_master_id", clientId).maybeSingle()
      : await deps.db.from("client_master").select("client_id").eq("client_id", clientId).maybeSingle();
    if (owner.error) {
      console.error("zoho-books: contact_link client check failed:", owner.error.code, owner.error.message);
      throw new UserError("Could not check the client.");
    }
    if (!owner.data) {
      throw new UserError(department === "banking" ? "This client is not in Business Banking." : "That client was not found.");
    }
    const current = await deps.db.from("zoho_contact_links").select("zoho_contact_id, zoho_contact_name")
      .eq("client_id", clientId).maybeSingle();
    if (current.error) {
      console.error("zoho-books: contact_link read failed:", current.error.code, current.error.message);
      throw new UserError("Could not read the Zoho link.");
    }
    if (current.data && current.data.zoho_contact_id !== contactId && body.replace !== true) {
      return { needs_replace: true, current_name: current.data.zoho_contact_name };
    }
    const zoho = await deps.zoho();
    const contact = (await zoho.get(`/contacts/${contactId}`))?.contact;
    if (!contact) throw new UserError("Zoho did not return that contact.");
    if (contact.currency_code !== "AED") {
      throw new UserError("Only a Zoho contact billed in AED can be linked, because CRM amounts are in AED.");
    }
    const name = text(contact.contact_name);
    if (!name) throw new UserError("That Zoho contact has no name. Add one in Zoho first.");
    const { error } = await deps.db.from("zoho_contact_links").upsert({
      client_id: clientId,
      zoho_contact_id: contactId,
      zoho_contact_name: name,
      linked_by: deps.userId,
      linked_at: deps.now().toISOString(),
    }, { onConflict: "client_id" });
    if (error) {
      if (error.code === "23503") throw new UserError("That client was not found.");
      console.error("zoho-books: contact_link save failed:", error.code, error.message);
      throw new UserError("Could not save the Zoho link.");
    }
    return { ok: true, zoho_contact_id: contactId, zoho_contact_name: name };
  }

  if (action === "document_create") return await createDocument(body, deps);
  if (action === "document_state") return await documentState(body, deps);
  if (action === "document_pdf") return await documentPdf(body, deps);

  if (action === "contact_get") {
    const department = departmentOf(body);
    await needPermission(deps, department, VIEW[department]);
    const clientId = text(body.client_id);
    if (!clientId) throw new UserError("Choose a client first.");
    const { data, error } = await deps.db
      .from("zoho_contact_links")
      .select("zoho_contact_id, zoho_contact_name")
      .eq("client_id", clientId)
      .maybeSingle();
    if (error) {
      console.error("zoho-books: contact_get read failed:", error.code, error.message);
      throw new UserError("Could not read the Zoho link.");
    }
    if (!data) return { linked: false };
    return { linked: true, zoho_contact_id: data.zoho_contact_id, zoho_contact_name: data.zoho_contact_name };
  }

  throw new UserError("Unknown action.");
}

// ---- Create a draft estimate or invoice ----

const SOURCE_DEPARTMENT: Record<string, Department> = { hub_documents: "business_setup", banking_quotations: "banking" };
const STUCK_MS = 2 * 60_000;
const BUSY = "This draft is already being created. Try again in a moment.";
const WAIT = "Zoho may still be creating this draft. Check again in 2 minutes.";
const UNCONFIRMED = "Zoho did not confirm the draft. Wait 2 minutes, then press Create again. The CRM checks Zoho before making a new one.";
const TOO_MANY = "Zoho returned too many possible matches, so no draft was created. Check Zoho, then try again.";
// A voided, declined or expired document is not a live draft to adopt.
const DEAD = new Set(["void", "declined", "expired"]);

class Ambiguous extends Error {
  constructor() {
    super(TOO_MANY);
  }
}

function createPermission(department: Department, kind: Kind): string {
  if (department === "banking") return "cases.manage";
  return kind === "invoice" ? "setup.services.manage" : "setup.quotes.manage";
}

async function readRow(deps: Deps, table: string, column: string, value: unknown, columns = "*"): Promise<Json> {
  const { data, error } = await deps.db.from(table).select(columns).eq(column, value).maybeSingle();
  if (error) {
    console.error(`zoho-books: read of ${table} failed:`, error.code, error.message);
    throw new UserError("Could not read the quote.");
  }
  return data;
}

// Amounts, department and client are always read here, never taken from the browser.
async function loadSource(deps: Deps, table: string, id: string): Promise<Source> {
  if (table === "hub_documents") {
    const row = await readRow(deps, table, "id", id);
    if (!row) throw new UserError("That quote was not found.");
    if (row.doc_type !== "quote") throw new UserError("Only a quote can be sent to Zoho.");
    if (row.department !== "Business Setup") {
      throw new UserError("This quote belongs to another department. Only Business Setup quotes can be created here.");
    }
    return fromHub(row);
  }
  const quote = await readRow(deps, table, "id", id);
  if (!quote) throw new UserError("That quote was not found.");
  const kase = quote.case_id ? await readRow(deps, "banking_cases", "id", quote.case_id) : null;
  const client = kase?.client_id ? await readRow(deps, "banking_clients", "id", kase.client_id) : null;
  return fromBanking(quote, client?.client_master_id ?? null);
}

// The nearest earlier version that already has a draft of this kind in Zoho.
async function earlierDraft(deps: Deps, table: string, id: string, kind: Kind): Promise<string | null> {
  const column = table === "hub_documents" ? "revises_id" : "supersedes_id";
  try {
    const seen = new Set([id]);
    let current = id;
    for (let i = 0; i < 25; i++) {
      const node = await readRow(deps, table, "id", current, column);
      const parent = node?.[column];
      if (!parent || seen.has(parent)) return null;
      seen.add(parent);
      const { data } = await deps.db.from("zoho_documents").select("state, zoho_number")
        .eq("source_table", table).eq("source_id", parent).eq("kind", kind).maybeSingle();
      if (data?.state === "created" && data.zoho_number) return data.zoho_number;
      current = parent;
    }
  } catch {
    // The hint is optional. A read problem must not hide the draft.
  }
  return null;
}

// What the panel shows for one saved row. Without a connection the row is shown with no Zoho link.
async function shapeRow(
  deps: Deps,
  zoho: { dc: string; orgId: string } | null,
  table: string,
  sourceId: string,
  kind: Kind,
  row: Json,
  extra: object = {},
) {
  const made = row.state === "created";
  return {
    state: row.state,
    zoho_id: made ? row.zoho_id ?? null : null,
    zoho_number: made ? row.zoho_number ?? null : null,
    total_warning: made && (row.total == null || !totalsMatch(Number(row.crm_total), Number(row.total))),
    earlier_draft: await earlierDraft(deps, table, sourceId, kind),
    url: made && row.zoho_id && zoho
      ? `https://books.zoho.${zoho.dc}/app/${zoho.orgId}#/${kind === "invoice" ? "invoices" : "quotes"}/${row.zoho_id}`
      : null,
    ...extra,
  };
}

async function createDocument(body: Json, deps: Deps): Promise<object> {
  const table = text(body.source_table);
  const kind = text(body.kind);
  const sourceId = text(body.source_id);
  if (!Object.hasOwn(SOURCE_DEPARTMENT, table)) throw new UserError("Unknown quote type.");
  if (kind !== "estimate" && kind !== "invoice") throw new UserError("Choose estimate or invoice.");
  if (!sourceId) throw new UserError("Choose a quote first.");
  const department = SOURCE_DEPARTMENT[table];
  await needPermission(deps, department, createPermission(department, kind));

  const src = await loadSource(deps, table, sourceId);
  const refused = canCreate(src, kind);
  if (refused) throw new UserError(refused);
  const vatTaxId = await deps.vatTaxId();
  const noVat = vatMissing(src, vatTaxId);
  if (noVat) throw new UserError(noVat);

  const link = await readRow(deps, "zoho_contact_links", "client_id", src.clientId, "zoho_contact_id");
  if (!link) return { needs_contact: true };
  const zoho = await deps.zoho();
  const now = deps.now();
  const docs = () => deps.db.from("zoho_documents");

  const shape = (row: Json, extra: object = {}) => shapeRow(deps, zoho, table, sourceId, kind, row, extra);

  const existing = await docs().select("*").eq("source_table", table).eq("source_id", sourceId).eq("kind", kind).maybeSingle();
  if (existing.error) {
    console.error("zoho-books: draft lookup failed:", existing.error.code, existing.error.message);
    throw new UserError("Could not read the draft record.");
  }

  let row: Json;
  // A draft Zoho no longer has must never be adopted again, even after a failed retry.
  let deletedId = "";
  let priorState = "";
  let priorCreatedAt = "";
  if (existing.data) {
    const old = existing.data;
    if (old.state === "created") return await shape(old);
    // created_at is when the last attempt started or timed out, so this is a real wait.
    const recent = now.getTime() - Date.parse(old.created_at) < STUCK_MS;
    if (old.state === "creating" && recent) throw new UserError(BUSY);
    if (old.state === "unknown" && recent) throw new UserError(WAIT);
    // failed, unknown, gone, or stuck in creating: take the row over. Only one caller can win.
    deletedId = String(old.zoho_id ?? "");
    priorState = old.state;
    priorCreatedAt = old.created_at;
    const claim = await docs().update({
      state: "creating",
      error: null,
      zoho_number: null,
      zoho_status: null,
      total: null,
      balance: null,
      last_read_at: null,
      reference: src.reference,
      crm_total: src.total,
      created_at: now.toISOString(),
    }).eq("id", old.id).eq("state", old.state).eq("created_at", old.created_at).select();
    if (claim.error) {
      console.error("zoho-books: draft claim failed:", claim.error.code, claim.error.message);
      throw new UserError("Could not start the draft.");
    }
    if (!claim.data?.length) throw new UserError(BUSY);
    row = claim.data[0];
  } else {
    const ins = await docs().insert({
      department: src.department,
      source_table: table,
      source_id: sourceId,
      kind,
      reference: src.reference,
      state: "creating",
      crm_total: src.total,
      created_by: deps.userId,
      created_at: now.toISOString(),
    }).select().single();
    if (ins.error) {
      if (ins.error.code === "23505") {
        // Another press got there first. Show its row and send nothing.
        const winner = await docs().select("*").eq("source_table", table).eq("source_id", sourceId).eq("kind", kind).maybeSingle();
        if (winner.data) return await shape(winner.data);
      }
      console.error("zoho-books: draft insert failed:", ins.error.code, ins.error.message);
      throw new UserError("Could not start the draft.");
    }
    row = ins.data;
  }

  // Saves only while this worker still owns the row. A takeover changes created_at.
  const save = async (patch: Json): Promise<Json> => {
    const res = await docs().update(patch).eq("id", row.id).eq("created_at", row.created_at).select();
    if (res.error) console.error("zoho-books: draft save failed:", res.error.code, res.error.message);
    const lost = !res.error && !res.data?.length;
    if (lost) console.error("zoho-books: draft save matched no row; another press took it over");
    return { error: res.error, lost, row: { ...row, ...patch } };
  };

  // Zoho's own text is shown only for a refusal. Other trouble gets fixed wording.
  const fail = async (e: unknown, posted: boolean) => {
    console.error("zoho-books: document_create:", (e as Error)?.name, (e as ZohoHttpError)?.status ?? "");
    let state = "failed";
    let message = browserMessage(e);
    const patch: Json = {};
    if (e instanceof Ambiguous) {
      message = e.message;
    } else if (e instanceof ZohoHttpError && e.status !== 429) {
      if (posted && e.status >= 500) {
        state = "unknown";
        message = UNCONFIRMED;
      } else {
        message = e.message.trim().slice(0, 300) || message;
      }
    } else if (posted && !(e instanceof ZohoAccessError) && !(e instanceof ZohoHttpError)) {
      state = "unknown";
      message = UNCONFIRMED;
    }
    if (state === "unknown" && posted) {
      // Start the wait now, not at the start of the attempt.
      patch.created_at = deps.now().toISOString();
    } else if (!posted && priorState === "unknown") {
      // The check failed, so nothing is known yet. Keep waiting rules as they were.
      state = "unknown";
      patch.created_at = priorCreatedAt;
    }
    const saved = await save({ ...patch, state, error: message });
    if (saved.lost) throw new UserError(BUSY);
    return await shape(saved.row, { error: message });
  };

  const path = kind === "invoice" ? "/invoices" : "/estimates";
  const idKey = `${kind}_id`;
  const numberKey = `${kind}_number`;

  let posted = false;
  try {
    // A repeat must never make a second copy, so look in Zoho first.
    const found = await zoho.get(path, { reference_number: src.reference });
    const listed = (found?.[`${kind}s`] ?? []) as Json[];
    // Only the first page is read, so a doubtful answer stops here instead of risking a copy.
    if (found?.page_context?.has_more_page === true || listed.some((d) => d?.reference_number == null || d?.customer_id == null)) {
      throw new Ambiguous();
    }
    const candidates = listed
      .filter((d) =>
        d.reference_number === src.reference && String(d.customer_id) === String(link.zoho_contact_id) &&
        String(d[idKey]) !== deletedId && !DEAD.has(String(d.status ?? "").toLowerCase())
      )
      .sort((a, b) => (Date.parse(b.created_time ?? b.date) || 0) - (Date.parse(a.created_time ?? a.date) || 0));
    // A draft another CRM quote already owns is not ours.
    const matches: Json[] = [];
    for (const d of candidates) {
      const held = await docs().select("id").eq("zoho_id", String(d[idKey]));
      if (held.error) throw new Error("zoho_documents lookup failed");
      if (!(held.data ?? []).some((r: Json) => r.id !== row.id)) matches.push(d);
    }
    let doc: Json = matches[0];
    if (!doc) {
      posted = true;
      const reply = await zoho.post(path, toZohoBody(src, String(link.zoho_contact_id), vatTaxId, dubaiToday(now)));
      doc = reply?.[kind];
      if (!doc?.[idKey]) return await fail(new Error("Zoho reply had no document"), true);
    }
    const total = Number(doc.total);
    const saved = await save({
      state: "created",
      zoho_id: String(doc[idKey]),
      zoho_number: doc[numberKey] == null ? null : String(doc[numberKey]),
      zoho_status: doc.status == null ? null : String(doc.status),
      total: Number.isFinite(total) ? total : null,
      crm_total: src.total,
      error: null,
    });
    if (saved.lost) throw new UserError(BUSY);
    if (saved.error) {
      throw new UserError("Zoho has the draft, but the CRM could not save it. Wait two minutes and press Create again to link it.");
    }
    return await shape(saved.row, matches[0] ? { adopted_count: matches.length } : {});
  } catch (e) {
    if (e instanceof UserError) throw e;
    return await fail(e, posted);
  }
}

// ---- Read back and View PDF ----

const READ_EVERY_MS = 15 * 60_000;
const NOT_READY = "This draft isn't available yet.";
const NO_LONGER = "Zoho no longer has this document.";
const OTHER_CONTACT = "This invoice is billed to a different Zoho contact, so Client Login won't show it.";
const NO_MASTER = "This client has no Client Master record, so Client Login cannot show this invoice.";
const GONE_NOT_SAVED = "Zoho no longer has this document, but Client Login could not be updated. Try again.";
const CLIENT_LOGIN_FAILED = "The Zoho status was read, but Client Login could not be updated. Press Refresh to try again.";

function sourceOf(body: Json): { table: string; id: string; department: Department } {
  const table = text(body.source_table);
  const id = text(body.source_id);
  if (!Object.hasOwn(SOURCE_DEPARTMENT, table)) throw new UserError("Unknown quote type.");
  if (!id) throw new UserError("Choose a quote first.");
  return { table, id, department: SOURCE_DEPARTMENT[table] };
}

function kindOf(body: Json): Kind {
  const kind = text(body.kind);
  if (kind !== "estimate" && kind !== "invoice") throw new UserError("Choose estimate or invoice.");
  return kind;
}

// Removes the client's invoice row for a Zoho id. Returns false when the removal failed.
async function removeInvoiceRow(deps: Deps, zohoId: string): Promise<boolean> {
  const res = await deps.db.from("business_setup_invoices").delete().eq("zoho_id", zohoId);
  if (res.error) console.error("zoho-books: invoice row removal failed:", res.error.code, res.error.message);
  return !res.error;
}

// Adds or refreshes the row Client Login shows. An upsert cannot name a partial unique index, so this reads
// first, then updates or inserts, and falls back to an update if another call added the row in between.
// ok is false when a write failed (so the read time is held back). message is shown to staff.
type Sync = { ok: boolean; message: string | null };
const SYNC_OK: Sync = { ok: true, message: null };
const SYNC_FAILED: Sync = { ok: false, message: CLIENT_LOGIN_FAILED };

// The row is removed and the reason is reported. A failed removal is a failure, so it is retried.
async function hideInvoiceRow(deps: Deps, zohoId: string, message: string): Promise<Sync> {
  return (await removeInvoiceRow(deps, zohoId)) ? { ok: true, message } : SYNC_FAILED;
}

async function saveInvoiceRow(deps: Deps, table: string, sourceId: string, zohoId: string, doc: Json): Promise<Sync> {
  const src = await loadSource(deps, table, sourceId);
  if (!src.clientId) {
    console.error("zoho-books: invoice has no Client Master record, so Client Login cannot show it");
    return await hideInvoiceRow(deps, zohoId, NO_MASTER);
  }
  // The invoice must be billed to the contact linked to this client, or another company could see it.
  const link = await readRow(deps, "zoho_contact_links", "client_id", src.clientId, "zoho_contact_id");
  if (!link || doc.customer_id == null || String(doc.customer_id) !== String(link.zoho_contact_id)) {
    console.error(`zoho-books: invoice customer ${!link ? "has no link" : doc.customer_id == null ? "is missing" : "does not match the link"}`);
    return await hideInvoiceRow(deps, zohoId, OTHER_CONTACT);
  }
  const total = Number(doc.total);
  const date = typeof doc.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(doc.date) ? doc.date : null;
  const fields = {
    client_id: src.clientId,
    quote_id: table === "hub_documents" ? sourceId : null,
    invoice_number: doc.invoice_number == null ? null : String(doc.invoice_number),
    issued_on: date,
    amount: Number.isFinite(total) ? total : null,
    source: "zoho",
    zoho_id: zohoId,
  };
  const rows = () => deps.db.from("business_setup_invoices");
  const update = () => rows().update(fields).eq("zoho_id", zohoId);
  const found = await rows().select("id").eq("zoho_id", zohoId).maybeSingle();
  if (found.error) {
    console.error("zoho-books: invoice row read failed:", found.error.code, found.error.message);
    return SYNC_FAILED;
  }
  let res = found.data ? await update() : await rows().insert(fields);
  if (res.error?.code === "23505") res = await update();
  if (res.error) console.error("zoho-books: invoice row save failed:", res.error.code, res.error.message);
  return res.error ? SYNC_FAILED : SYNC_OK;
}

// Zoho reports a missing document as 404, or as its own code 1002.
function isMissing(e: unknown): boolean {
  return e instanceof ZohoHttpError && (e.status === 404 || e.code === 1002);
}

// Marks a row gone. The invoice row goes first: if it can't be removed the row stays created, so a later read retries.
async function markGone(deps: Deps, row: Json, kind: Kind): Promise<boolean> {
  if (kind === "invoice" && !(await removeInvoiceRow(deps, String(row.zoho_id)))) return false;
  const res = await deps.db.from("zoho_documents").update({ state: "gone", error: null }).eq("id", row.id).eq("state", "created");
  if (res.error) console.error("zoho-books: gone save failed:", res.error.code, res.error.message);
  return !res.error;
}

async function documentState(body: Json, deps: Deps): Promise<object> {
  const { table, id, department } = sourceOf(body);
  await needPermission(deps, department, VIEW[department]);
  const force = body.force === true;

  const found = await deps.db.from("zoho_documents").select("*").eq("source_table", table).eq("source_id", id).order("kind");
  if (found.error) {
    console.error("zoho-books: state lookup failed:", found.error.code, found.error.message);
    throw new UserError("Could not read the draft record.");
  }
  const saved: Json[] = (found.data ?? []).filter((r: Json) => r.kind === "estimate" || r.kind === "invoice");

  // Saved rows are shown even when Zoho cannot be reached.
  let zoho: ZohoLike | null = null;
  let readError: string | null = null;
  // Set after trouble that would hit every row too: a busy Zoho, lost access, a timeout, or no connection.
  let stop = false;
  try {
    zoho = await deps.zoho();
  } catch (e) {
    stop = true;
    if ((e as Error)?.name === "MissingSecretError") {
      readError = "Zoho credentials are missing.";
    } else {
      console.error("zoho-books: document_state:", (e as Error)?.name);
      readError = browserMessage(e);
    }
  }

  const now = deps.now();
  const rows: object[] = [];
  for (const row of saved) {
    const kind = row.kind as Kind;
    const fresh = row.last_read_at && now.getTime() - Date.parse(row.last_read_at) < READ_EVERY_MS;
    const readable = row.state === "created" && /^\d+$/.test(String(row.zoho_id ?? ""));
    let rowError: string | null = null;
    if (zoho && !stop && readable && (force || !fresh)) {
      try {
        const doc = (await zoho.get(`/${kind}s/${row.zoho_id}`))?.[kind];
        if (!doc) throw new Error("Zoho reply had no document");
        const patch: Json = {
          zoho_status: doc.status == null ? null : String(doc.status),
          total: Number.isFinite(Number(doc.total)) ? Number(doc.total) : null,
          balance: Number.isFinite(Number(doc.balance)) ? Number(doc.balance) : null,
        };
        let sync = SYNC_OK;
        if (kind === "invoice") {
          const status = String(doc.status ?? "").toLowerCase();
          try {
            sync = clientVisible(status)
              ? await saveInvoiceRow(deps, table, id, String(row.zoho_id), doc)
              : (await removeInvoiceRow(deps, String(row.zoho_id)) ? SYNC_OK : SYNC_FAILED);
          } catch (e) {
            console.error("zoho-books: invoice row failed:", (e as Error)?.name);
            sync = SYNC_FAILED;
          }
        }
        // The read time is held back after a failed write, so the next open tries again.
        if (sync.ok) patch.last_read_at = now.toISOString();
        rowError = sync.message;
        const res = await deps.db.from("zoho_documents").update(patch).eq("id", row.id);
        if (res.error) {
          console.error("zoho-books: read-back save failed:", res.error.code, res.error.message);
          rowError ??= "The Zoho status was read but could not be saved.";
        }
        Object.assign(row, patch);
      } catch (e) {
        if (isMissing(e)) {
          if (await markGone(deps, row, kind)) {
            Object.assign(row, { state: "gone", error: null });
          } else {
            rowError = CLIENT_LOGIN_FAILED;
          }
        } else {
          console.error("zoho-books: document_state read:", (e as Error)?.name, (e as ZohoHttpError)?.status ?? "");
          rowError = browserMessage(e);
          if (e instanceof ZohoAccessError || e instanceof ZohoTimeoutError || (e instanceof ZohoHttpError && e.status === 429)) {
            stop = true;
          }
        }
      }
      readError ??= rowError;
    }
    rows.push(
      await shapeRow(deps, zoho, table, id, kind, row, {
        kind,
        reference: row.reference ?? null,
        zoho_status: row.zoho_status ?? null,
        balance: row.balance ?? null,
        last_read_at: row.last_read_at ?? null,
        error: row.error ?? null,
        read_error: rowError,
      }),
    );
  }
  return { rows, connected: zoho !== null, read_error: readError };
}

// A file name that is safe in a Content-Disposition header: letters, digits, dot, dash, underscore and space only.
export function pdfFileName(label: unknown): string {
  const clean = String(label ?? "").replace(/[^A-Za-z0-9._ -]/g, "").replace(/^[. ]+/, "").trim().slice(0, 80);
  return `${clean || "document"}.pdf`;
}

async function documentPdf(body: Json, deps: Deps): Promise<object> {
  const { table, id, department } = sourceOf(body);
  const kind = kindOf(body);
  await needPermission(deps, department, VIEW[department]);

  // The Zoho id comes from the saved row only, never from the request.
  const found = await deps.db.from("zoho_documents").select("*").eq("source_table", table).eq("source_id", id).eq("kind", kind)
    .maybeSingle();
  if (found.error) {
    console.error("zoho-books: pdf lookup failed:", found.error.code, found.error.message);
    throw new UserError("Could not read the draft record.");
  }
  const row = found.data;
  if (!row || row.state !== "created" || !/^\d+$/.test(String(row.zoho_id ?? ""))) throw new UserError(NOT_READY);

  const zoho = await deps.zoho();
  try {
    const pdf = await zoho.getPdf(`/${kind}s/${row.zoho_id}`);
    return { pdf, filename: pdfFileName(row.zoho_number || row.reference) };
  } catch (e) {
    if (!isMissing(e)) throw e;
    throw new UserError((await markGone(deps, row, kind)) ? NO_LONGER : GONE_NOT_SAVED);
  }
}
