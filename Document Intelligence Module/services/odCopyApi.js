import { supabase } from "@app/supabase";

// Reads and the three admin actions for the OneDrive copy. Everything is in schema od_copy; Row Level Security lets
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
    const rows = check(await od().from("plan").select("source_item_id, source_path").eq("status", "skipped_duplicate").order("source_path").limit(n));
    return rows.map((r) => ({ id: r.source_item_id, path: r.source_path, note: "Same size and hash as another file, not copied", skipped: 0 }));
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

// scope: 'all' (matched client folders and fixed areas) or 'unmatched'. Moves the plan to the copy stage.
export const approve = async (scope, area = null) => check(await od().rpc("admin_approve", { p_scope: scope, p_area: area }));
// stage: 'inventory' (start listing), 'paused', 'resume' or 'rollback'.
export const setStage = async (stage) => check(await od().rpc("set_stage", { p_stage: stage }));
