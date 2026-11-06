// Request handler for the onedrive-copy Edge Function. index.ts wires the real Db and Graph; tests
// pass fakes. One run per POST: the stage in od_copy.settings decides the work; 120 s budget.

import { type Db, errText, type GraphApi, runCopy, runInventory, runRollback, scopeFrom, type Settings } from "./stages.ts";

export const RUN_BUDGET_MS = 120_000;
export const MAX_IN_FLIGHT = 4;

export type HandlerDeps = {
  secret: string | undefined;
  db: () => Db;
  graph: (s: Settings) => GraphApi | Promise<GraphApi>;
  now?: () => number;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// Constant-time comparison of the shared secret.
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function handle(req: Request, deps: HandlerDeps): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const given = req.headers.get("x-od-copy-secret") ?? "";
  if (!deps.secret || !given || !sameSecret(given, deps.secret)) return json({ error: "unauthorized" }, 401);

  const now = deps.now ?? Date.now;
  const deadline = now() + RUN_BUDGET_MS;
  let db: Db | undefined;
  let stage = "unknown";
  let result: Record<string, unknown>;
  let status = 200;
  try {
    db = deps.db();
    const s = await db.getSettings();
    stage = s.stage;
    switch (s.stage) {
      case "inventory":
        result = await runInventory(await deps.graph(s), db, deadline, now);
        break;
      case "approved":
      case "copying": {
        const n = Math.max(1, Math.min(MAX_IN_FLIGHT, s.max_in_flight || MAX_IN_FLIGHT));
        result = await runCopy(await deps.graph(s), db, deadline, n, { now });
        break;
      }
      case "rollback":
        result = await runRollback(await deps.graph(s), db, deadline, scopeFrom(s.rollback_scope), now);
        break;
      default:
        result = { skipped: s.stage };
    }
  } catch (e) {
    result = { error: errText(e) };
    status = 500;
  }
  if (!db) return json(result, status);
  try {
    await db.saveSettings({ last_run_at: new Date(now()).toISOString(), last_run_result: { stage, ...result } });
  } catch (e) {
    result = { ...result, error_saving_result: errText(e) };
    status = 500;
  }
  return json(result, status);
}
