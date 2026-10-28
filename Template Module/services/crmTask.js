import { supabase } from "./supabaseClient";
import { CRM_TARGET, FREEZONE_FIELD, cleanFreezone } from "../logic/helpers";

// ── CRM task creation ──
// First status for a list (falls back to folder, then space, then "To Do").
async function firstStatus(space_id, folder_id, list_id) {
  const pick = async (q) => {
    const { data } = await q.order("status_order").limit(1);
    return data && data[0] ? data[0].name : null;
  };
  return (
    (await pick(supabase.from("space_statuses").select("name").eq("list_id", list_id))) ||
    (await pick(supabase.from("space_statuses").select("name").eq("folder_id", folder_id).is("list_id", null))) ||
    (await pick(supabase.from("space_statuses").select("name").eq("space_id", space_id).is("folder_id", null).is("list_id", null))) ||
    "To Do"
  );
}

// Get-or-create a space_field on the target list, reusing any existing field of
// the same name anywhere in the space. Cached within one task creation.
async function ensureField(space, list, name, type, options, order, cache) {
  if (cache.has(name)) return cache.get(name);
  // The field must be scoped to THIS list so it shows in the list's Columns
  // menu (which only lists fields whose list_id === the active list).
  const { data: all } = await supabase
    .from("space_fields").select("*").eq("space_id", space.id).eq("field_name", name);
  let field = (all || []).find((f) => f.list_id === list.id) || null;
  if (!field && (all || []).length) {
    // A same-named field exists at another scope (space/folder/other list).
    // Adopt it into this list — avoids a duplicate-name conflict and makes it
    // appear in this list's Columns.
    const { data, error } = await supabase.from("space_fields")
      .update({ list_id: list.id, folder_id: null }).eq("id", all[0].id).select().single();
    if (!error && data) field = data;
  }
  if (!field) {
    const { data, error } = await supabase.from("space_fields").insert({
      space_id: space.id, folder_id: null, list_id: list.id,
      field_name: name, field_type: type, field_order: order, field_options: options,
    }).select().single();
    if (error) throw new Error(`field "${name}": ${error.message}`);
    field = data;
  } else if (type === "dropdown") {
    // keep the dropdown's options in sync with whatever we need present
    const have = field.field_options || [];
    const add = (options || []).filter((o) => !have.includes(o));
    if (add.length) {
      const merged = [...have, ...add];
      await supabase.from("space_fields").update({ field_options: merged }).eq("id", field.id);
      field = { ...field, field_options: merged };
    }
  }
  cache.set(name, field);
  return field;
}

// File a generated quotation as a task in the shared Delivery ▸ Quotation ▸
// "Quotations by CRM" list. To keep the list from sprouting a new column per
// template (and per ad-hoc row), we DON'T create a number field per fee. The
// list has a fixed, small set of columns:
//   Free Zone (dropdown) · Quotation Date (date) · Fee Breakdown (list) · Total (AED)
// Every fee line and ad-hoc row is written as one line into the single
// "Fee Breakdown" list field, so the column count never grows regardless of how
// many templates or extra rows are involved.
// Best-effort: callers catch errors so a failure never blocks the download.
export async function createCrmTask({ ctx, tpl, templates, profile, quotationDate, taskTitle }) {
  const findOne = async (table, filters) => {
    let q = supabase.from(table).select("*").is("deleted_at", null);
    for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
    const { data } = await q.limit(1).maybeSingle();
    return data;
  };
  const space = await findOne("spaces", { name: CRM_TARGET.space });
  if (!space) throw new Error(`space "${CRM_TARGET.space}" not found`);
  const folder = await findOne("folders", { name: CRM_TARGET.folder, space_id: space.id });
  if (!folder) throw new Error(`folder "${CRM_TARGET.folder}" not found`);
  const list = await findOne("lists", { name: CRM_TARGET.list, folder_id: folder.id });
  if (!list) throw new Error(`list "${CRM_TARGET.list}" not found`);

  const cache = new Map();
  // Clean, de-duplicated freezone names from all templates (e.g. "IFZA").
  const freeZoneName = cleanFreezone(tpl.freezone);
  const freeZoneOptions = [...new Set((templates || []).map((t) => cleanFreezone(t.freezone)).filter(Boolean))];
  const options = freeZoneOptions.length ? freeZoneOptions : [freeZoneName];

  // Fixed columns: Free Zone (dropdown) + Quotation Date + Fee Breakdown + Total.
  const freeZone = await ensureField(space, list, FREEZONE_FIELD, "dropdown", options, 1, cache);
  // Keep the dropdown's options as the clean template set (drops any stale
  // "… Template" entries and stays editable via the field-options editor).
  await supabase.from("space_fields").update({ field_options: options }).eq("id", freeZone.id);
  const values = [{ field_id: freeZone.id, value: freeZoneName }];

  // Quotation date (ISO yyyy-mm-dd so it renders as a real date)
  const dateField = await ensureField(space, list, "Quotation Date", "date", null, 2, cache);
  values.push({ field_id: dateField.id, value: quotationDate || new Date().toISOString().slice(0, 10) });

  // Fee Breakdown: one line per fee/ad-hoc row ("Label — AED 1,234 · remarks"),
  // stored as a `list` field so it renders as a bullet list and never adds
  // columns. `it.amount` is already the formatted AED string.
  const breakdown = (ctx.items || [])
    .map((it) => {
      const base = `${it.label} — AED ${it.amount}`;
      return it.remarks ? `${base} · ${it.remarks}` : base;
    })
    .join("\n");
  const breakdownField = await ensureField(space, list, "Fee Breakdown", "list", null, 3, cache);
  values.push({ field_id: breakdownField.id, value: breakdown });

  // Activity: if the template has a (non-fee) "Activity" field, map its value
  // into an "Activity" list column on the task (one activity per line → renders
  // as bullets). Matched by key or label so it works whatever the template
  // calls it, as long as it's "activity". Not rendered in the .docx — task only.
  const activityField = (tpl.fields || []).find(
    (f) => !f.fee && ((f.key || "").toLowerCase() === "activity" || (f.label || "").trim().toLowerCase() === "activity"),
  );
  if (activityField) {
    const activityVal = String(ctx[activityField.key] ?? "")
      .split(/\r?\n/).map((s) => s.trim()).filter(Boolean).join("\n"); // drop blank lines
    if (activityVal) {
      const actField = await ensureField(space, list, "Activity", "list", null, 4, cache);
      values.push({ field_id: actField.id, value: activityVal });
    }
  }

  const totalField = await ensureField(space, list, "Total (AED)", "number", null, 900, cache);
  values.push({ field_id: totalField.id, value: String(ctx.total_num) });

  const status = await firstStatus(space.id, folder.id, list.id);
  const { data: task, error } = await supabase.from("tasks").insert({
    title: (taskTitle && taskTitle.trim()) || ctx.business_activity || "Quotation",
    description: "",
    space_id: space.id, folder_id: folder.id, list_id: list.id,
    status, priority: "Medium", assignee: "", assignees: [],
    updated_by: profile?.full_name || "Unknown", updated_at: new Date().toISOString(),
  }).select().single();
  if (error) throw new Error("task: " + error.message);

  await supabase.from("task_field_values").insert(values.map((v) => ({ task_id: task.id, ...v })));
  return { task, listName: list.name };
}
