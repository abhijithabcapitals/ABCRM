// Actions for the zoho-books Edge Function. Kept free of Deno and Supabase imports so tests can run offline.

export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

// deno-lint-ignore no-explicit-any
type Json = any;

export type ZohoLike = {
  orgId: string;
  get(path: string, query?: Record<string, string>): Promise<Json>;
  post(path: string, body: unknown, query?: Record<string, string>): Promise<Json>;
};

export type Deps = {
  isAdmin(): Promise<boolean>;
  can(department: string, permission: string): Promise<boolean>;
  // Service-role Supabase client.
  db: Json;
  zoho(): Promise<ZohoLike>;
  userId: string;
  now(): Date;
};

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
    const found = (res?.organizations ?? []).some((o: Json) => String(o?.organization_id) === zoho.orgId);
    if (!found) {
      return {
        connected: false,
        message: "Zoho answered, but the organisation in ZOHO_BOOKS_ORG_ID is not one this login can see. Check that setting.",
      };
    }
    return { connected: true };
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
