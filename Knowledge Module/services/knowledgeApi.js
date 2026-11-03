import { supabase } from "@app/supabase";
import { SEARCH_LIMIT, escapeLike } from "../logic/search.js";
import { assertAllUpdated } from "../logic/status.js";

// The database grants read on these columns only: basis, payee and confidence are refused, so "*" fails on this table for everyone.
const PRICE_LINE_COLUMNS = "id, category_id, template, line_group, item, amount_aed, valid_until, status, visibility, source_ref, approved_by, approved_at, created_at, created_by, updated_at, updated_by, deleted_at";
// Only these two tables hold rows that are approved, shared or removed through the helpers below. The value is what a write returns.
const RETURNED_COLUMNS = { knowledge_entries: "*", knowledge_price_lines: PRICE_LINE_COLUMNS };

export function check({ data, error }) {
  if (error) throw new Error(error.hint ? `${error.message} (${error.hint})` : error.message);
  return data;
}

function reviewed(name) {
  if (!Object.hasOwn(RETURNED_COLUMNS, name)) throw new Error(`Unknown Knowledge table: ${name}`);
  return supabase.from(name);
}

// Searches the combined view. ilike with an escaped pattern, so commas, % and _ in the query match literally.
export async function search(query) {
  const text = String(query ?? "").trim();
  if (!text) return [];
  return check(await supabase.from("v_knowledge_search").select("*")
    .ilike("search_text", `%${escapeLike(text)}%`).order("title").limit(SEARCH_LIMIT));
}

export const listCategories = async () =>
  check(await supabase.from("knowledge_categories").select("*").order("sort_order").order("name"));

export const listPriceLines = async () =>
  check(await supabase.from("knowledge_price_lines").select(`${PRICE_LINE_COLUMNS}, knowledge_categories(name)`).is("deleted_at", null)
    .order("template").order("line_group").order("item"));

// Admin only: basis, payee and confidence by price line id. Returns no rows for anyone else.
export const listPriceLineReview = async () => check(await supabase.rpc("knowledge_price_line_review"));

// Customer-facing banking columns only, through the security-definer function.
export const listBankingPrices = async () => check(await supabase.rpc("knowledge_banking_prices"));

// types is optional: one or more of procedure | checklist | plan | client_answer.
export async function listEntries(types) {
  let query = supabase.from("knowledge_entries").select("*, knowledge_categories(name)").is("deleted_at", null);
  if (types?.length) query = query.in("entry_type", [].concat(types));
  return check(await query.order("title"));
}

// Active catalogue items with their category and department, ordered by category then item.
export async function listServices() {
  const rows = check(await supabase.from("service_items").select("id, name, service_categories!inner(name, department)").eq("is_active", true).eq("service_categories.is_active", true));
  const category = (r) => r.service_categories?.name || "";
  return rows.sort((a, b) => category(a).localeCompare(category(b)) || a.name.localeCompare(b.name));
}

// Insert without an id, update with one. approved_by, approved_at, updated_at and updated_by are set by the database trigger, never sent.
const AUTO_FIELDS = ["approved_by", "approved_at", "updated_at", "updated_by"];

async function save(name, row) {
  const { id, ...values } = row;
  for (const f of AUTO_FIELDS) delete values[f];
  const query = id ? supabase.from(name).update(values).eq("id", id) : supabase.from(name).insert(values);
  return check(await query.select(RETURNED_COLUMNS[name]).single());
}

export const saveEntry = (row) => save("knowledge_entries", row);
export const savePriceLine = (row) => save("knowledge_price_lines", row);

// Sets status only. The trigger records who approved and when.
export async function approve(table, ids) {
  const list = [].concat(ids);
  return assertAllUpdated(check(await reviewed(table).update({ status: "Approved" }).in("id", list).select(RETURNED_COLUMNS[table])), list, "Approved");
}

export async function setVisibility(table, ids, visibility) {
  const list = [].concat(ids);
  return assertAllUpdated(check(await reviewed(table).update({ visibility }).in("id", list).select(RETURNED_COLUMNS[table])), list, "Changed visibility of");
}

export const softDelete = async (table, id) =>
  check(await reviewed(table).update({ deleted_at: new Date().toISOString() }).eq("id", id).select(RETURNED_COLUMNS[table]).single());
