// The CRM Agent's tools. Row data only ever goes through ctx.db, the person's own login, so row security applies.
// ctx.admin is the service role, used for table descriptions and the log. Failures come back as text starting
// "Error:" so the model can carry on; nothing here throws.

import { canChangeTable, canReach, checkChange, checkRead, cutResult, KNOWN_TABLES, listReachable, wrapData } from "./logic.js";

const TABLE = {
  schema: { type: "string", description: "Database schema, from list_my_tables" },
  table: { type: "string", description: "Table name without the schema, from list_my_tables" },
};
const ANY_VALUE = { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" }] };

export const TOOLS = [
  {
    name: "list_my_tables",
    description: "List the tables this person may reach, as schema.table.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    name: "describe_table",
    description: "Show a table's columns and primary key.",
    input_schema: { type: "object", properties: TABLE, required: ["schema", "table"], additionalProperties: false },
  },
  {
    name: "read_rows",
    description: "Read rows from a table. Name the columns you need. At most 50 rows. ilike patterns use %.",
    input_schema: {
      type: "object",
      properties: {
        ...TABLE,
        columns: { type: "array", items: { type: "string" } },
        filters: {
          type: "array",
          items: {
            type: "object",
            properties: {
              column: { type: "string" },
              op: { type: "string", enum: ["eq", "in", "ilike", "gte", "lte", "is"] },
              value: { anyOf: [ANY_VALUE, { type: "array", items: ANY_VALUE }] },
            },
            required: ["column", "op", "value"],
            additionalProperties: false,
          },
        },
        order: {
          anyOf: [
            { type: "null" },
            { type: "object", properties: { column: { type: "string" }, ascending: { type: "boolean" } }, required: ["column", "ascending"], additionalProperties: false },
          ],
        },
        limit: { type: "integer" },
      },
      required: ["schema", "table", "columns", "filters", "order", "limit"],
      additionalProperties: false,
    },
  },
  {
    name: "change_rows",
    description: "Insert or update rows, only when the person's own message asks for it. update names rows by primary key. At most 20 rows per call and 3 calls per message. To remove a task, update its deleted_at.",
    input_schema: {
      type: "object",
      properties: {
        ...TABLE,
        action: { type: "string", enum: ["insert", "update"] },
        ids: { type: "array", items: { anyOf: [{ type: "string" }, { type: "number" }] } },
        values: { type: "string", description: "For update: a JSON object of column to new value. Otherwise an empty string." },
        rows: { type: "string", description: "For insert: a JSON array of row objects. Otherwise an empty string." },
      },
      required: ["schema", "table", "action", "ids", "values", "rows"],
      additionalProperties: false,
    },
  },
];

// The two text fields keep the tool's shape simple, so values and rows arrive as JSON text.
export const toolsFor = (readOnly) => TOOLS
  .filter((t) => !readOnly || t.name !== "change_rows")
  .map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));

function parseChangeInput(input) {
  const out = { ...input };
  for (const key of ["values", "rows"]) {
    if (typeof out[key] !== "string") continue;
    if (!out[key].trim()) delete out[key];
    else out[key] = JSON.parse(out[key]);
  }
  return out;
}

async function log(ctx, tool, action, table, ok, code) {
  try {
    await ctx.admin.rpc("crm_agent_chat_log", { p_profile: ctx.profileId, p_tool: tool, p_action: action, p_table: table, p_ok: ok, p_error_code: code });
  } catch { /* the log never stops the work */ }
}

const tableInfo = async (ctx, schema, table) => {
  const { data, error } = await ctx.admin.rpc("crm_agent_table_info", { p_schema: schema, p_table: table });
  return error ? null : data;
};

function applyFilters(query, filters) {
  for (const { column, op, value } of filters) query = query[op](column, value);
  return query;
}

// A database error's own wording is kept, but its details can quote the row, so those are dropped.
const dbError = (error) => `Error: the database refused this: ${String(error.message || "unknown error").slice(0, 200)}`;

async function readRows(ctx, input) {
  const { schema, table } = input;
  const checked = checkRead(await tableInfo(ctx, schema, table), input);
  if (checked.error) return { text: `Error: ${checked.error}`, code: "bad_input" };
  let query = applyFilters(ctx.db.schema(schema).from(table).select(checked.columns.join(",")), checked.filters);
  if (checked.order) query = query.order(checked.order.column, { ascending: checked.order.ascending !== false });
  const { data, error } = await query.limit(checked.limit);
  if (error) return { text: dbError(error), code: error.code || "db_error" };
  return { text: wrapData(cutResult({ rows: data || [], count: (data || []).length })), code: null };
}

async function changeRows(ctx, input) {
  const { schema, table, action } = input;
  if (ctx.deadline && Date.now() > ctx.deadline) return { text: "Error: out of time, so nothing was changed.", code: "deadline" };
  if (!canChangeTable(schema, table, action)) return { text: `Error: ${schema}.${table} cannot take a ${action} here. Tell the person to make this change in the CRM.`, code: "not_changeable" };
  const checked = checkChange(await tableInfo(ctx, schema, table), parseChangeInput(input), ctx.changeCalls);
  if (checked.error) return { text: `Error: ${checked.error}`, code: "bad_input" };
  ctx.changeCalls += 1;
  const from = ctx.db.schema(schema).from(table);
  const query = action === "insert" ? from.insert(checked.rows)
    : action === "update" ? from.update(checked.values).in(checked.pk, checked.ids)
    : from.delete().in(checked.pk, checked.ids);
  const { data, error } = await query.select(checked.pk);
  if (error) return { text: dbError(error), code: error.code || "db_error" };
  const ids = (data || []).map((row) => row[checked.pk]);
  if (!ids.length) return { text: "Nothing changed. The person may not have access to these rows, or they may not exist. Tell the person it was not done.", code: "no_rows" };
  const text = `Changed ${ids.length} row(s) in ${schema}.${table}: ${JSON.stringify(ids)}`;
  ctx.changes?.push(text);
  return { text: cutResult(text), code: null };
}

const ACTIONS = { describe_table: "describe", read_rows: "read" };

export async function runTool(name, input, ctx) {
  const known = TOOLS.some((t) => t.name === name);
  if (!known) {
    await log(ctx, "unknown", null, null, false, "unknown_tool");
    return "Error: there is no such tool.";
  }
  if (name === "change_rows" && ctx.allowChanges !== true) {
    await log(ctx, name, null, null, false, "read_only");
    return "Error: this agent is read-only. Tell the person to make the change in the CRM.";
  }
  if (name === "list_my_tables") {
    await log(ctx, name, "list", null, true, null);
    return cutResult(listReachable(KNOWN_TABLES, ctx.person));
  }
  const schema = input?.schema;
  const table = input?.table;
  const action = name === "change_rows" ? input?.action : ACTIONS[name];
  const label = typeof schema === "string" && typeof table === "string" ? `${schema}.${table}` : null;
  if (!label) {
    await log(ctx, name, action, null, false, "bad_input");
    return "Error: name a schema and a table.";
  }
  if (!canReach(schema, table, ctx.person)) {
    await log(ctx, name, action, label, false, "refused");
    return `Error: ${label} is not available to this person.`;
  }
  let result;
  try {
    if (name === "describe_table") {
      const info = await tableInfo(ctx, schema, table);
      result = info ? { text: cutResult(info), code: null } : { text: "Error: that table is not available.", code: "no_info" };
    } else if (name === "read_rows") {
      result = await readRows(ctx, input);
    } else {
      result = await changeRows(ctx, input);
    }
  } catch {
    result = { text: "Error: that request failed.", code: "failed" };
  }
  await log(ctx, name, action, label, result.code === null, result.code);
  return result.text;
}
