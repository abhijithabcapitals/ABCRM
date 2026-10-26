// Supabase Edge Function — Wiki "Ask AI" agent.
// Paste into the Supabase Dashboard (Edge Functions → new function
// "wiki-ai-search" → Code) and Deploy. Then set the secret:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// (or Dashboard → Edge Functions → Manage secrets).
//
// What it does: natural-language Q&A over the Knowledge Base. It searches
// BOTH:
//   1. every wiki page the caller can see, and
//   2. every task in the "Knowledge Hub" space (folders like Accounting and
//      Tax Compliances, Business Set Up and PRO Team, Company Formation),
// because the answers often live in task titles/descriptions, not just pages.
//
// Phase 1 = full scan + Claude reasoning (no embeddings yet):
//   Stage A — send Claude every page/task the CALLER can see (title + path +
//             short snippet) and let it either pick the best items to read,
//             or return a disambiguation list when several distinct items
//             plausibly match.
//   Stage B — fetch the FULL content of the chosen items and synthesize a
//             grounded answer with citations.
//
// RLS: the function talks to Postgres with the caller's JWT (anon key +
// Authorization header), so it can only ever read pages/tasks the user is
// allowed to see — the Anthropic key is the only privileged secret, and it
// never leaves the server.
//
// Phase 2 (future): add pgvector embeddings for true hybrid retrieval. The
// two-stage shape stays; only Stage A's candidate selection changes.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  // supabase-js functions.invoke() sends apikey + x-client-info from the
  // browser; the preflight fails ("Failed to send a request…") unless they're
  // all allowed here.
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Cost/quality levers:
// - ROUTING_MODEL (Stage A) just PICKS which pages/tasks are relevant from the
//   full catalog — cheap work, so Haiku. Its big, stable catalog prefix is also
//   prompt-cached, so repeated questions within ~5 min pay ~1/10th on Stage A.
// - ANSWER_MODEL (Stage B) writes the actual answer from the chosen items —
//   quality matters, so Sonnet (swap to "claude-opus-5" for the best answers).
// NOTE: Haiku 4.5 does NOT support the `effort` param — only pass effort to
// Sonnet/Opus, never to the routing model.
const ROUTING_MODEL = "claude-haiku-4-5";
const ANSWER_MODEL = "claude-sonnet-5";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

// Which space holds the task-based knowledge (matched by name).
const KNOWLEDGE_HUB_SPACE = "Knowledge Hub";

// Cheap HTML → text for feeding article/task bodies to the model.
function stripHtml(html: string): string {
  return (html || "")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/(p|div|h[1-6]|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Minimal Anthropic Messages call with structured (JSON-schema) output.
// When cacheSystem is true, the system prompt is sent as a cacheable prefix so
// a stable, repeated prefix (the Stage A catalog) is billed at ~0.1x on reuse.
// effort is optional because Haiku 4.5 rejects it — omit it for the router.
async function askClaude(
  apiKey: string,
  opts: {
    model: string;
    system: string;
    userText: string;
    schema: Record<string, unknown>;
    maxTokens?: number;
    effort?: "low" | "medium" | "high";
    cacheSystem?: boolean;
  },
): Promise<Record<string, unknown>> {
  const { model, system, userText, schema, maxTokens = 2000, effort, cacheSystem = false } = opts;

  const systemField = cacheSystem
    ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }]
    : system;
  const outputConfig: Record<string, unknown> = { format: { type: "json_schema", schema } };
  if (effort) outputConfig.effort = effort;

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemField,
      messages: [{ role: "user", content: userText }],
      output_config: outputConfig,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Anthropic ${res.status}: ${detail.slice(0, 500)}`);
  }
  const data = await res.json();
  if (data.stop_reason === "refusal") {
    throw new Error("The assistant declined to answer this request.");
  }
  const textBlock = (data.content || []).find((b: { type: string }) => b.type === "text");
  if (!textBlock?.text) throw new Error("Empty response from the model.");
  return JSON.parse(textBlock.text);
}

// Build a "Parent / Child" path from a self-referential name tree.
function pathBuilder(rows: { id: string; name: string; parent_id: string | null }[]) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return (id: string | null): string => {
    const parts: string[] = [];
    let cur = id ? byId.get(id) : null;
    let guard = 0;
    while (cur && guard++ < 10) {
      parts.unshift(cur.name);
      cur = cur.parent_id ? byId.get(cur.parent_id) : null;
    }
    return parts.join(" / ");
  };
}

type Item = {
  kind: "page" | "task";
  id: string;
  title: string;
  path: string;
  content: string;
  // navigation info for tasks
  space_id?: string;
  folder_id?: string | null;
  list_id?: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return json({ error: "Not authenticated" }, 401);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "Server missing ANTHROPIC_API_KEY" }, 500);

    const { query } = await req.json();
    if (!query || typeof query !== "string" || !query.trim()) {
      return json({ error: "Missing query" }, 400);
    }

    // RLS-scoped client — reads only what THIS user can see.
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    // Unified searchable corpus, keyed by "page:<id>" / "task:<id>".
    const items = new Map<string, Item>();

    // ── 1. Wiki pages ──
    const [artsRes, catsRes] = await Promise.all([
      db.from("wiki_articles").select("id, title, content, category_id").is("deleted_at", null),
      db.from("wiki_categories").select("id, name, parent_id").is("deleted_at", null),
    ]);
    if (artsRes.error) return json({ error: "Wiki lookup failed: " + artsRes.error.message }, 500);
    const catPath = pathBuilder(catsRes.data || []);
    for (const a of artsRes.data || []) {
      items.set(`page:${a.id}`, {
        kind: "page",
        id: a.id,
        title: a.title,
        path: catPath(a.category_id),
        content: a.content || "",
      });
    }

    // ── 2. Tasks in the "Knowledge Hub" space ──
    const { data: khSpace } = await db
      .from("spaces").select("id").eq("name", KNOWLEDGE_HUB_SPACE).is("deleted_at", null)
      .limit(1).maybeSingle();
    if (khSpace) {
      const [foldersRes, tasksRes] = await Promise.all([
        db.from("folders").select("id, name, parent_id").eq("space_id", khSpace.id).is("deleted_at", null),
        db.from("tasks").select("id, title, description, space_id, folder_id, list_id")
          .eq("space_id", khSpace.id).is("deleted_at", null),
      ]);
      const folderPath = pathBuilder(foldersRes.data || []);
      for (const t of tasksRes.data || []) {
        const path = ["Knowledge Hub", folderPath(t.folder_id)].filter(Boolean).join(" / ");
        items.set(`task:${t.id}`, {
          kind: "task",
          id: t.id,
          title: t.title,
          path,
          content: t.description || "",
          space_id: t.space_id,
          folder_id: t.folder_id,
          list_id: t.list_id,
        });
      }
    }

    if (items.size === 0) {
      return json({ mode: "not_found", message: "There's nothing to search yet." });
    }

    // ── Stage A: full scan (title + path + short snippet) ──
    const catalog = [...items.entries()]
      .map(([key, it]) => {
        const snippet = stripHtml(it.content).slice(0, 300);
        return `key: ${key}\ntype: ${it.kind === "page" ? "wiki page" : "task"}\ntitle: ${it.title}${it.path ? `\nlocation: ${it.path}` : ""}\nsnippet: ${snippet}`;
      })
      .join("\n---\n");

    const stageASystem =
      "You are the Knowledge Base assistant for an internal CRM. You are given the FULL list of items " +
      "the user can see — both wiki pages and tasks (from the Knowledge Hub space) — each with a title, " +
      "location, and a short snippet. Decide how to answer the user's question:\n" +
      "- mode \"answer\": one or a few items clearly contain the answer. Put their keys in item_keys " +
      "(most relevant first, at most 5). Consider both wiki pages and tasks equally.\n" +
      "- mode \"disambiguate\": several DISTINCT items plausibly match (e.g. similar titles or overlapping " +
      "topics) and the user should choose which they mean. List them in options with a one-line reason " +
      "each. Never silently pick one when the choice is genuinely ambiguous.\n" +
      "- mode \"not_found\": nothing here is relevant.\n" +
      "Match on meaning, not exact wording — the user's phrasing will differ from titles. Use each item's " +
      "exact key verbatim (they look like \"page:<uuid>\" or \"task:<uuid>\").";

    const stageASchema = {
      type: "object",
      additionalProperties: false,
      properties: {
        mode: { type: "string", enum: ["answer", "disambiguate", "not_found"] },
        item_keys: { type: "array", items: { type: "string" } },
        options: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              key: { type: "string" },
              title: { type: "string" },
              reason: { type: "string" },
            },
            required: ["key", "title", "reason"],
          },
        },
      },
      required: ["mode", "item_keys", "options"],
    };

    // Catalog goes into the (cached) system prefix; only the question varies.
    const routing = await askClaude(apiKey, {
      model: ROUTING_MODEL,
      system: `${stageASystem}\n\nItems the user can see:\n${catalog}`,
      userText: `User question: ${query}`,
      schema: stageASchema,
      maxTokens: 1500,
      cacheSystem: true,
      // no effort — Haiku 4.5 does not support the effort parameter
    });

    // Shape an item into the client-facing source/option object.
    const toSource = (it: Item) =>
      it.kind === "task"
        ? { kind: "task", id: it.id, title: it.title, space_id: it.space_id, folder_id: it.folder_id, list_id: it.list_id }
        : { kind: "page", id: it.id, title: it.title };

    if (routing.mode === "not_found") {
      return json({ mode: "not_found", message: "I couldn't find anything relevant in the Knowledge Base." });
    }

    if (routing.mode === "disambiguate") {
      const options = ((routing.options as { key: string; reason: string }[]) || [])
        .filter((o) => items.has(o.key))
        .map((o) => ({ ...toSource(items.get(o.key)!), reason: o.reason }));
      if (options.length === 0) {
        return json({ mode: "not_found", message: "I couldn't find a clear match in the Knowledge Base." });
      }
      return json({ mode: "disambiguate", options });
    }

    // ── Stage B: read full content of the chosen items and synthesize ──
    const chosenKeys = ((routing.item_keys as string[]) || []).filter((k) => items.has(k)).slice(0, 5);
    if (chosenKeys.length === 0) {
      return json({ mode: "not_found", message: "I couldn't find a relevant item in the Knowledge Base." });
    }

    const docs = chosenKeys
      .map((k) => {
        const it = items.get(k)!;
        const label = it.kind === "page" ? "WIKI PAGE" : "TASK";
        return `=== ${label} ===\nkey: ${k}\ntitle: ${it.title}${it.path ? `\nlocation: ${it.path}` : ""}\n\n${stripHtml(it.content).slice(0, 6000)}`;
      })
      .join("\n\n");

    const stageBSystem =
      "You are the Knowledge Base assistant for an internal CRM. Answer the user's question using ONLY the " +
      "wiki page(s) and task(s) provided. Be concise and specific — pull out the exact details asked for " +
      "(numbers, steps, costs, documents, names). If the items don't fully answer it, say what is and isn't " +
      "covered. Do not invent information that isn't in the provided items. In source_keys, list the key of " +
      "every item you actually used (verbatim, e.g. \"page:<uuid>\" or \"task:<uuid>\").";

    const stageBSchema = {
      type: "object",
      additionalProperties: false,
      properties: {
        answer: { type: "string" },
        source_keys: { type: "array", items: { type: "string" } },
      },
      required: ["answer", "source_keys"],
    };

    const result = await askClaude(apiKey, {
      model: ANSWER_MODEL,
      system: stageBSystem,
      userText: `User question: ${query}\n\n${docs}`,
      schema: stageBSchema,
      maxTokens: 3000,
      effort: "medium",
    });

    const usedKeys = ((result.source_keys as string[]) || []).filter((k) => items.has(k));
    const sources = (usedKeys.length ? usedKeys : chosenKeys).map((k) => toSource(items.get(k)!));

    return json({ mode: "answer", answer: result.answer, sources });
  } catch (e) {
    return json({ error: (e as Error).message || "Unexpected error" }, 500);
  }
});
