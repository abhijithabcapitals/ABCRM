import { supabase } from "@app/supabase";
import { duplicateRows } from "../logic/odCopyView";

// Reads and the admin actions for the OneDrive copy. Everything is in schema od_copy; Row Level Security lets
// only admins and the CEO read it, and the two functions check the same rule again. No file content is ever loaded.
const od = () => supabase.schema("od_copy");

function check({ data, error }) {
  if (error) throw new Error(error.hint ? `${error.message} (${error.hint})` : error.message);
  return data;
}

export const loadReport = async () => check(await od().from("report").select("*").order("area"));
export const loadSettings = async () => check(await od().from("settings").select("stage, last_run_at, last_run_result, rollback_scope").maybeSingle());
export const loadClientFolders = async (clientId) =>
  check(await od().from("client_folders").select("department, web_url").eq("client_id", clientId).order("department"));

const percent = (c) => (c == null ? "" : `${Math.round(Number(c) * 100)}%`);

// kind: 'duplicates' | 'review' | 'unmatched' | 'failed'. Every row comes back as { id, path, note, skipped }.
export async function loadIssues(kind, limit = 200) {
  const n = Math.max(1, Math.min(1000, Number(limit) || 200));
  if (kind === "duplicates") {
    // One row per group: the kept file and every skipped location.
    return duplicateRows(check(await od().from("duplicate_groups").select("keeper_id, keeper_path, keeper_status, copies_skipped, skipped_paths").order("keeper_path").limit(n)));
  }
  if (kind === "review" || kind === "unmatched") {
    const q = od().from("client_matches").select("area, folder_name, confidence, status");
    const rows = check(await (kind === "review" ? q.eq("status", "review") : q.in("status", ["unmatched", "rejected"])).order("area").order("folder_name").limit(n));
    return rows.map((r) => ({
      id: `${r.area}/${r.folder_name}`,
      path: `${r.area} / ${r.folder_name}`,
      note: kind === "review" ? (r.confidence == null ? "Needs a person to confirm the client" : `Closest client match ${percent(r.confidence)}`) : "Goes to 00 Unmatched - to link",
      skipped: 0,
    }));
  }
  if (kind === "failed") {
    const rows = check(await od().from("failed_items").select("source_item_id, path, error, duplicates_not_copied").order("updated_at", { ascending: false }).limit(n));
    return rows.map((r) => ({ id: r.source_item_id, path: r.path, note: r.error || "Failed", skipped: Number(r.duplicates_not_copied) || 0 }));
  }
  throw new Error(`Unknown list: ${kind}`);
}

// scope 'client': value = client id (the pilot). scope 'all' (matched client folders and fixed areas) or 'unmatched':
// value = one old area or null for every area; refused by the database until a pilot copy is verified.
// Moves the plan to the copy stage.
export const approve = async (scope, value = null) => check(await od().rpc("admin_approve", { p_scope: scope, p_value: value }));
// Admins and the CEO (the same rule as the od_copy Row Level Security).
export const canRead = async () => check(await od().rpc("can_read")) === true;
// stage: 'inventory' (start listing), 'paused', 'resume' or 'rollback'.
export const setStage = async (stage) => check(await od().rpc("set_stage", { p_stage: stage }));
