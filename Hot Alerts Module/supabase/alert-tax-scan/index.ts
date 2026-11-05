// alert-tax-scan: runs the tax tracker over the Client Master, and stores dated items for the daily alert scan.
//   POST with header x-alert-secret  ->  { stored }
// Uses Client Module/crm/taxLogic.js unchanged, so the rules live in one place. Sends nothing to anyone.
// Deploy as "alert-tax-scan" with JWT verification off, using the same secret name as alert-digest. Logs carry no client data.
import { createClient } from "npm:@supabase/supabase-js@2";
import { compliance } from "../../../Client Module/crm/taxLogic.js";
import { secretMatches } from "../alert-digest/rules.ts";
import { taxItemsToStore } from "./rules.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const PAGE = 1000;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  if (!secretMatches(req.headers.get("x-alert-secret"), Deno.env.get("ALERT_DIGEST_SECRET"))) return json({ error: "Not allowed." }, 401);
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const rows: unknown[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin.from("client_master").select("data").order("client_id").range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      rows.push(...(data || []).map((r: { data: unknown }) => r.data));
      if (!data || data.length < PAGE) break;
    }
    const today = new Date();
    const { items } = compliance(rows);
    const { data: stored, error } = await admin.rpc("alert_tax_ingest", { p_items: taxItemsToStore(items, today) });
    if (error) throw new Error(error.message);
    console.log(`alert-tax-scan: ${rows.length} clients, stored ${stored}`);
    return json({ stored });
  } catch (e) {
    console.error("alert-tax-scan failed", (e as Error).name);
    return json({ error: (e as Error).message }, 500);
  }
});
