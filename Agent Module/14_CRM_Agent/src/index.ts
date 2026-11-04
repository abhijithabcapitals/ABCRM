// Cloudflare Worker "crm-agent": the MCP endpoint of the CRM Agent, at /mcp.
//
// Clients send a Bearer token, checked through the crm_agent_check_mcp_token database function.
// Until a token is generated in the CRM, the MCP_AUTH_TOKEN Worker secret is the fallback.
// get_crm_lead_status reads through the crm_agent_lead_status database function using a
// separate read token. Every tool call is logged (tool, result, error code, duration only).
// The other two tools are placeholders: they change nothing and return not_implemented
// until they are connected to authorized CRM handlers.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

interface Env {
  MCP_AUTH_TOKEN?: string;
  CRM_READ_TOKEN?: string;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
}

const MAX_REQUEST_BODY_SIZE = 64 * 1024;
const CRM_READ_TIMEOUT_MS = 10_000;
const encoder = new TextEncoder();

function jsonError(message: string, status: number, headers: Record<string, string> = {}) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function bearerToken(request: Request) {
  return request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
}

async function hasValidBearerToken(request: Request, expectedToken: string) {
  const suppliedToken = bearerToken(request);
  if (!suppliedToken) return false;

  const [expectedDigest, suppliedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(expectedToken)),
    crypto.subtle.digest("SHA-256", encoder.encode(suppliedToken)),
  ]);
  const expectedBytes = new Uint8Array(expectedDigest);
  const suppliedBytes = new Uint8Array(suppliedDigest);
  let difference = 0;
  for (let index = 0; index < expectedBytes.length; index += 1) {
    difference |= expectedBytes[index] ^ suppliedBytes[index];
  }
  return difference === 0;
}

async function checkMcpToken(env: Env, token: string): Promise<"valid" | "invalid" | "unset" | "unreachable"> {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) return "unreachable";

  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/crm_agent_check_mcp_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: env.SUPABASE_PUBLISHABLE_KEY },
      body: JSON.stringify({ p_token: token }),
      signal: AbortSignal.timeout(CRM_READ_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error("MCP token check failed", response.status);
      return "unreachable";
    }

    const result = await response.json();
    return result === "valid" || result === "invalid" || result === "unset" ? result : "unreachable";
  } catch (error) {
    console.error("MCP token check failed", error instanceof Error ? error.name : "Unknown error");
    return "unreachable";
  }
}

function unavailableToolResult(toolName: string) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          error: "not_implemented",
          tool: toolName,
          message: "No CRM operation was performed. Connect this placeholder to an authorized CRM handler before use.",
        }),
      },
    ],
  };
}

function jsonToolResult(body: unknown, isError = false) {
  return { isError, content: [{ type: "text" as const, text: JSON.stringify(body) }] };
}

async function getLeadStatus(env: Env, lead: string) {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY || !env.CRM_READ_TOKEN) {
    return jsonToolResult({ error: "not_configured", message: "CRM read access is not configured." }, true);
  }

  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/crm_agent_lead_status`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: env.SUPABASE_PUBLISHABLE_KEY },
      body: JSON.stringify({ p_token: env.CRM_READ_TOKEN, p_lead: lead }),
      signal: AbortSignal.timeout(CRM_READ_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error("CRM read failed", response.status);
      return jsonToolResult({ error: "crm_unavailable", message: "The CRM could not be read." }, true);
    }

    const result = (await response.json()) as { error?: string };
    return jsonToolResult(result, Boolean(result.error));
  } catch (error) {
    console.error("CRM read failed", error instanceof Error ? error.name : "Unknown error");
    return jsonToolResult({ error: "crm_unavailable", message: "The CRM could not be read." }, true);
  }
}

// Records tool name, outcome, error code and duration. Never inputs or results.
function logToolCall(
  env: Env,
  ctx: ExecutionContext,
  tool: string,
  startedAt: number,
  result: { isError?: boolean; content: { text: string }[] },
) {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY || !env.CRM_READ_TOKEN) return;

  let errorCode: string | null = null;
  if (result.isError) {
    try {
      const code = (JSON.parse(result.content[0]?.text ?? "") as { error?: unknown }).error;
      errorCode = typeof code === "string" ? code : "unknown";
    } catch {
      errorCode = "unknown";
    }
  }

  const supabaseUrl = env.SUPABASE_URL;
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY;
  const body = JSON.stringify({
    p_read_token: env.CRM_READ_TOKEN,
    p_tool: tool,
    p_ok: !result.isError,
    p_error_code: errorCode,
    p_duration_ms: Math.round(Date.now() - startedAt),
  });

  ctx.waitUntil(
    (async () => {
      try {
        const response = await fetch(`${supabaseUrl}/rest/v1/rpc/crm_agent_log_call`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: publishableKey },
          body,
          signal: AbortSignal.timeout(CRM_READ_TIMEOUT_MS),
        });
        if (!response.ok) console.error("Usage log failed", response.status);
      } catch (error) {
        console.error("Usage log failed", error instanceof Error ? error.name : "Unknown error");
      }
    })(),
  );
}

function createMcpServer(env: Env, ctx: ExecutionContext) {
  const logged =
    <A,>(tool: string, handler: (args: A) => Promise<ReturnType<typeof jsonToolResult>>) =>
    async (args: A) => {
      const startedAt = Date.now();
      const result = await handler(args);
      logToolCall(env, ctx, tool, startedAt, result);
      return result;
    };

  const server = new McpServer({ name: "crm-agent", version: "1.0.0" }, { capabilities: { tools: {} } });

  server.registerTool(
    "get_crm_lead_status",
    {
      description:
        "Read a Business Development lead's current stage, status, priority, owner and follow-up dates. Takes the exact lead number (LD-2026-000002) or lead id. Does not search by name and does not return contact details.",
      inputSchema: z.object({ lead_id: z.string().trim().min(1).max(128) }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    logged("get_crm_lead_status", async ({ lead_id }: { lead_id: string }) => getLeadStatus(env, lead_id)),
  );

  server.registerTool(
    "update_crm_lead",
    {
      description: "Placeholder for updating an allowlisted set of lead details. Not connected to CRM data yet.",
      inputSchema: z
        .object({
          lead_id: z.string().trim().min(1).max(128),
          changes: z
            .object({
              name: z.string().trim().min(1).max(200).optional(),
              stage: z.string().trim().min(1).max(80).optional(),
              status: z.string().trim().min(1).max(80).optional(),
              priority: z.string().trim().min(1).max(40).optional(),
              initial_summary: z.string().max(4000).nullable().optional(),
              next_followup_at: z.string().max(80).nullable().optional(),
              notes: z.string().max(4000).nullable().optional(),
            })
            .strict(),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    logged("update_crm_lead", async () => unavailableToolResult("update_crm_lead")),
  );

  server.registerTool(
    "trigger_agent_workflow",
    {
      description: "Placeholder for invoking an approved agent workflow. Not connected to an agent runtime yet.",
      inputSchema: z
        .object({
          workflow_id: z.string().trim().min(1).max(128),
          input: z
            .record(z.string().max(128), z.union([z.string().max(4000), z.number(), z.boolean(), z.null()]))
            .optional(),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    logged("trigger_agent_workflow", async () => unavailableToolResult("trigger_agent_workflow")),
  );

  return server;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (new URL(request.url).pathname !== "/mcp") return jsonError("Not found.", 404);

    const suppliedToken = bearerToken(request);
    if (!suppliedToken) {
      return jsonError("Authentication required.", 401, { "WWW-Authenticate": 'Bearer realm="MCP"' });
    }

    const tokenState = await checkMcpToken(env, suppliedToken);
    if (tokenState === "unreachable") return jsonError("MCP authentication is unavailable.", 503);
    if (tokenState === "invalid") {
      return jsonError("Authentication required.", 401, { "WWW-Authenticate": 'Bearer realm="MCP"' });
    }
    if (tokenState === "unset") {
      // No token generated in the CRM yet: fall back to the Worker secret.
      const expectedToken = env.MCP_AUTH_TOKEN;
      if (!expectedToken || expectedToken.length < 32) {
        return jsonError("MCP endpoint authentication is not configured.", 503);
      }
      if (!(await hasValidBearerToken(request, expectedToken))) {
        return jsonError("Authentication required.", 401, { "WWW-Authenticate": 'Bearer realm="MCP"' });
      }
    }

    const server = createMcpServer(env, ctx);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      maxRequestBodySize: MAX_REQUEST_BODY_SIZE,
    });

    try {
      await server.connect(transport);
      const response = await transport.handleRequest(request);
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "no-store");
      headers.set("X-Content-Type-Options", "nosniff");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    } catch (error) {
      console.error("MCP request failed", error instanceof Error ? error.message : "Unknown transport error");
      return jsonError("MCP request failed.", 500);
    }
  },
};
