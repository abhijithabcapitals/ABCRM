// Supabase Edge Function — Google Sheets → CRM lead ingest.
// Paste into the Supabase Dashboard (Edge Functions → your function → Code) and Deploy.
//
// Fixes the 2026-07 outage: space/folder/list lookups now filter out
// soft-deleted rows and pick the newest active match, so a trashed-and-
// recreated list can never again resolve as "not found" (which caused the
// retry-storm that exhausted the Apps Script urlfetch quota). Missing
// folders/lists are auto-created so a new sheet tab never 404-loops.
// Hashing / idempotency / field-mapping are unchanged.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function sha256hex(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Normalize a value for storage based on the target field's type. DATE fields
// keep only the calendar day (YYYY-MM-DD): an ISO datetime like
// "2026-06-19T12:14:49-05:00" is sliced to "2026-06-19" (no timezone math — the
// date as written wins), so the app renders it correctly as 19-06-2026.
// Unparseable values (e.g. "Liquidated") are left as-is.
function normalizeFieldValue(type: string | undefined, raw: string): string {
  if (type !== "date") return raw;
  const s = raw.trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return s;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { secret, action, spaceName, folderName, listName, title, status, fields, assignTo, items: bodyItems } = await req.json();
    if (secret !== Deno.env.get("WEBHOOK_SECRET")) return json({ error: "Unauthorized" }, 401);
    if (!listName) return json({ error: "Missing listName" }, 400);
    if (action !== "update_fields_batch" && !title) return json({ error: "Missing title" }, 400);

    // Prefer the new secret API key (SERVICE_SECRET_KEY = sb_secret_…); fall
    // back to the legacy service_role during migration.
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SERVICE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Backfill path: update field values on an ALREADY-CREATED task, matched
    // by list + title. Never creates a task or a list. Used to push sheet-only
    // columns (e.g. created_time, Row Number) onto historical leads without
    // re-running the create path (which would make duplicates, since adding
    // fields changes the content hash). Only fields that already have a matching
    // custom-field definition in the list are written.
    if (action === "update_fields") {
      const { data: sp, error: spE } = await db.from("spaces").select("id")
        .eq("name", spaceName).is("deleted_at", null).limit(1).maybeSingle();
      if (spE) return json({ error: "Space lookup failed: " + spE.message }, 500);
      if (!sp) return json({ error: "Space not found" }, 404);
      const { data: fo, error: foE } = await db.from("folders").select("id")
        .eq("name", folderName).eq("space_id", sp.id).is("deleted_at", null).limit(1).maybeSingle();
      if (foE) return json({ error: "Folder lookup failed: " + foE.message }, 500);
      if (!fo) return json({ ok: true, updated: 0, reason: "folder not found" });
      const { data: li, error: liE } = await db.from("lists").select("id")
        .eq("name", listName).eq("folder_id", fo.id).is("deleted_at", null).limit(1).maybeSingle();
      if (liE) return json({ error: "List lookup failed: " + liE.message }, 500);
      if (!li) return json({ ok: true, updated: 0, reason: "list not found" });

      // Match the task by title within the list (active only). Ambiguous or
      // missing names are reported, not guessed.
      const { data: matches, error: mE } = await db.from("tasks").select("id")
        .eq("list_id", li.id).eq("title", String(title).trim()).is("deleted_at", null);
      if (mE) return json({ error: "Task lookup failed: " + mE.message }, 500);
      if (!matches || matches.length === 0) return json({ ok: true, updated: 0, reason: "no matching task" });
      if (matches.length > 1) return json({ ok: true, updated: 0, reason: "ambiguous", count: matches.length });
      const taskId = matches[0].id;

      const { data: defs } = await db.from("space_fields").select("id, field_name, field_type").eq("list_id", li.id);
      const byName = new Map((defs || []).map((d) => [String(d.field_name).toLowerCase(), d]));
      let written = 0;
      for (const [name, value] of Object.entries(fields || {})) {
        if (value == null || String(value).trim() === "") continue;
        const def = byName.get(String(name).toLowerCase());
        if (!def) continue;
        const fid = def.id;
        const v = normalizeFieldValue(def.field_type, String(value));
        const { data: ex } = await db.from("task_field_values").select("id")
          .eq("task_id", taskId).eq("field_id", fid).maybeSingle();
        if (ex) await db.from("task_field_values").update({ value: v }).eq("id", ex.id);
        else await db.from("task_field_values").insert({ task_id: taskId, field_id: fid, value: v });
        written++;
      }
      return json({ ok: true, updated: 1, fields_written: written });
    }

    // ── Batched backfill: many {title, fields} in one request, so a large sheet
    // backfills in a few calls instead of one HTTP round-trip per row (which
    // blows the Apps Script 6-min limit). Resolves the list once, then updates
    // each task by title. Returns a summary + per-item reasons.
    if (action === "update_fields_batch") {
      const items: { title?: string; fields?: Record<string, unknown> }[] =
        Array.isArray(bodyItems) ? bodyItems : [];
      const { data: sp, error: spE } = await db.from("spaces").select("id")
        .eq("name", spaceName).is("deleted_at", null).limit(1).maybeSingle();
      if (spE) return json({ error: "Space lookup failed: " + spE.message }, 500);
      if (!sp) return json({ error: "Space not found" }, 404);
      const { data: fo, error: foE } = await db.from("folders").select("id")
        .eq("name", folderName).eq("space_id", sp.id).is("deleted_at", null).limit(1).maybeSingle();
      if (foE) return json({ error: "Folder lookup failed: " + foE.message }, 500);
      if (!fo) return json({ ok: true, summary: { updated: 0, noMatch: 0, ambiguous: 0, other: items.length }, results: [] });
      const { data: li, error: liE } = await db.from("lists").select("id")
        .eq("name", listName).eq("folder_id", fo.id).is("deleted_at", null).limit(1).maybeSingle();
      if (liE) return json({ error: "List lookup failed: " + liE.message }, 500);
      if (!li) return json({ ok: true, summary: { updated: 0, noMatch: 0, ambiguous: 0, other: items.length }, results: [] });

      const { data: defs } = await db.from("space_fields").select("id, field_name, field_type").eq("list_id", li.id);
      const byName = new Map((defs || []).map((d) => [String(d.field_name).toLowerCase(), d]));
      const results: { title: string; updated: number; reason?: string; count?: number }[] = [];
      for (const it of items) {
        const t = String(it.title || "").trim();
        if (!t) { results.push({ title: t, updated: 0, reason: "empty title" }); continue; }
        const { data: matches } = await db.from("tasks").select("id")
          .eq("list_id", li.id).eq("title", t).is("deleted_at", null);
        if (!matches || matches.length === 0) { results.push({ title: t, updated: 0, reason: "no matching task" }); continue; }
        if (matches.length > 1) { results.push({ title: t, updated: 0, reason: "ambiguous", count: matches.length }); continue; }
        const taskId = matches[0].id;
        for (const [name, value] of Object.entries(it.fields || {})) {
          if (value == null || String(value).trim() === "") continue;
          const def = byName.get(String(name).toLowerCase());
          if (!def) continue;
          const v = normalizeFieldValue(def.field_type, String(value));
          const { data: ex } = await db.from("task_field_values").select("id")
            .eq("task_id", taskId).eq("field_id", def.id).maybeSingle();
          if (ex) await db.from("task_field_values").update({ value: v }).eq("id", ex.id);
          else await db.from("task_field_values").insert({ task_id: taskId, field_id: def.id, value: v });
        }
        results.push({ title: t, updated: 1 });
      }
      const summary = results.reduce((a, r) => {
        if (r.updated === 1) a.updated++;
        else if (r.reason === "ambiguous") a.ambiguous++;
        else if (r.reason === "no matching task") a.noMatch++;
        else a.other++;
        return a;
      }, { updated: 0, noMatch: 0, ambiguous: 0, other: 0 });
      return json({ ok: true, summary, results });
    }

    // Resolve the space — active rows only. NOTE: no ORDER BY created_at here;
    // folders (and possibly other tables) have no created_at column, and an
    // errored lookup must NEVER be mistaken for "not found" — otherwise every
    // request would auto-create a new folder/list. So we check `error`
    // explicitly and only auto-create on a genuinely empty result.
    const { data: space, error: spaceErr } = await db.from("spaces").select("id")
      .eq("name", spaceName).is("deleted_at", null).limit(1).maybeSingle();
    if (spaceErr) return json({ error: "Space lookup failed: " + spaceErr.message }, 500);
    if (!space) return json({ error: "Space not found" }, 404);

    // Resolve the folder (active only); auto-create only if the lookup
    // succeeded and returned nothing.
    let { data: folder, error: folderErr } = await db.from("folders").select("id")
      .eq("name", folderName).eq("space_id", space.id).is("deleted_at", null)
      .limit(1).maybeSingle();
    if (folderErr) return json({ error: "Folder lookup failed: " + folderErr.message }, 500);
    if (!folder) {
      const { data: created, error: fErr } = await db.from("folders")
        .insert({ name: folderName, space_id: space.id }).select("id").single();
      if (fErr || !created) return json({ error: "Folder could not be created: " + (fErr?.message || "") }, 500);
      folder = created;
    }

    // Resolve the list (active only); auto-create only if the lookup succeeded
    // and returned nothing.
    let { data: list, error: listErr } = await db.from("lists").select("id")
      .eq("name", listName).eq("folder_id", folder.id).is("deleted_at", null)
      .limit(1).maybeSingle();
    if (listErr) return json({ error: "List lookup failed: " + listErr.message }, 500);
    if (!list) {
      const { data: created, error: lErr } = await db.from("lists")
        .insert({ name: listName, folder_id: folder.id, space_id: space.id }).select("id").single();
      if (lErr || !created) return json({ error: "List could not be created: " + (lErr?.message || "") }, 500);
      list = created;
    }

    // Content signature: list + title + non-empty sheet fields (sorted). Auto
    // fields like Start Date are intentionally excluded so the hash is stable.
    const entries = Object.entries(fields || {})
      .map(([k, v]) => [k, v == null ? "" : String(v)] as [string, string])
      // Exclude positional/auto fields from the signature: "Row Number" shifts
      // when rows are inserted/deleted above it, which must NOT be read as new
      // content (that would create a duplicate task).
      .filter(([k, v]) => v.trim() !== "" && k.toLowerCase() !== "row number")
      .map(([k, v]) => `${k}\t${v}`)
      .sort();
    const sourceKey = await sha256hex(`${list.id}\n${String(title).trim()}\n${entries.join("\n")}`);

    // Idempotency: if an active task with this exact content exists, skip.
    const { data: existing } = await db.from("tasks").select("id")
      .eq("source_key", sourceKey).is("deleted_at", null).maybeSingle();
    if (existing) return json({ ok: true, skipped: true, task_id: existing.id });

    const today = new Date().toISOString().slice(0, 10);
    const { data: task, error: taskErr } = await db.from("tasks").insert({
      space_id: space.id, folder_id: folder.id, list_id: list.id, source_key: sourceKey,
      title: String(title).trim(), status: status || "To Do", priority: "Medium",
      assignee: assignTo || "", assignees: assignTo ? [assignTo] : [],
      updated_by: "Google Sheets", updated_at: new Date().toISOString(),
    }).select("id").single();
    if (taskErr) {
      // Unique index rejected a race duplicate — treat as already-created.
      return json({ ok: true, skipped: true, error: taskErr.message });
    }

    const { data: defs } = await db.from("space_fields").select("id, field_name, field_type").eq("list_id", list.id);
    const byName = new Map((defs || []).map((d) => [String(d.field_name).toLowerCase(), d]));
    const rows: Record<string, string>[] = [];
    for (const [name, value] of Object.entries(fields || {})) {
      if (value == null || String(value).trim() === "") continue;
      // created_time is set from the task's creation day below — never from the
      // sheet (whose ambiguous dd/mm vs mm/dd formats caused swapped dates).
      if (String(name).toLowerCase() === "created_time") continue;
      const def = byName.get(String(name).toLowerCase());
      if (def) rows.push({ task_id: task.id, field_id: def.id, value: normalizeFieldValue(def.field_type, String(value)) });
    }
    const startDef = byName.get("start date");
    if (startDef) rows.push({ task_id: task.id, field_id: startDef.id, value: today });
    // created_time := today (the day the task is created in the CRM).
    const createdDef = byName.get("created_time");
    if (createdDef) rows.push({ task_id: task.id, field_id: createdDef.id, value: today });
    if (rows.length) await db.from("task_field_values").insert(rows);

    return json({ ok: true, task_id: task.id });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
