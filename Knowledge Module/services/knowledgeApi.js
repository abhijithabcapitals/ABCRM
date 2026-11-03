import { supabase } from "@app/supabase";
import { escapeLike } from "../logic/search.js";

const SEARCH_LIMIT = 50;
// Only these two tables hold rows that are approved, shared or removed through the helpers below.
const REVIEWED_TABLES = ["knowledge_entries", "knowledge_price_lines"];

export function check({ data, error }) {
  if (error) throw new Error(error.hint ? `${error.message} (${error.hint})` : error.message);
  return data;
}

function reviewed(name) {
  if (!REVIEWED_TABLES.includes(name)) throw new Error(`Unknown Knowledge table: ${name}`);
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
  check(await supabase.from("knowledge_price_lines").select("*, knowledge_categories(name)").is("deleted_at", null)
    .order("template").order("line_group").order("item"));

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
  const rows = check(await supabase.from("service_items").select("id, name, service_categories(name, department)").eq("is_active", true));
  const category = (r) => r.service_categories?.name || "";
  return rows.sort((a, b) => category(a).localeCompare(category(b)) || a.name.localeCompare(b.name));
}

// Insert without an id, update with one. approved_by, approved_at, updated_at and updated_by are set by the database trigger, never sent.
const AUTO_FIELDS = ["approved_by", "approved_at", "updated_at", "updated_by"];

async function save(name, row) {
  const { id, ...values } = row;
  for (const f of AUTO_FIELDS) delete values[f];
  const query = id ? supabase.from(name).update(values).eq("id", id) : supabase.from(name).insert(values);
  return check(await query.select().single());
}

export const saveEntry = (row) => save("knowledge_entries", row);
export const savePriceLine = (row) => save("knowledge_price_lines", row);

// Sets status only. The trigger records who approved and when.
export const approve = async (table, ids) =>
  check(await reviewed(table).update({ status: "Approved" }).in("id", [].concat(ids)).select());

export const setVisibility = async (table, ids, visibility) =>
  check(await reviewed(table).update({ visibility }).in("id", [].concat(ids)).select());

export const softDelete = async (table, id) =>
  check(await reviewed(table).update({ deleted_at: new Date().toISOString() }).eq("id", id).select().single());
