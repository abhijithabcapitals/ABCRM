// Cloudflare Worker "crm-agent": the MCP endpoint of the CRM Agent, at /mcp.
//
// Clients send the MCP_AUTH_TOKEN Worker secret as a Bearer token. The three tools
// are placeholders: they read nothing, change nothing and return not_implemented
// until they are connected to authorized CRM handlers.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

interface Env {
  MCP_AUTH_TOKEN?: string;
}

const MAX_REQUEST_BODY_SIZE = 64 * 1024;
const encoder = new TextEncoder();

function jsonError(message: string, status: number, headers: Record<string, string> = {}) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

async function hasValidBearerToken(request: Request, expectedToken: string) {
  const suppliedToken = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
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

function createMcpServer() {
  const server = new McpServer({ name: "crm-agent", version: "1.0.0" }, { capabilities: { tools: {} } });

  server.registerTool(
    "get_crm_lead_status",
    {
      description: "Placeholder for reading a lead's current status from the CRM. Not connected to CRM data yet.",
      inputSchema: z.object({ lead_id: z.string().trim().min(1).max(128) }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => unavailableToolResult("get_crm_lead_status"),
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
    async () => unavailableToolResult("update_crm_lead"),
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
    async () => unavailableToolResult("trigger_agent_workflow"),
  );

  return server;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname !== "/mcp") return jsonError("Not found.", 404);

    const expectedToken = env.MCP_AUTH_TOKEN;
    if (!expectedToken || expectedToken.length < 32) {
      return jsonError("MCP endpoint authentication is not configured.", 503);
    }
    if (!(await hasValidBearerToken(request, expectedToken))) {
      return jsonError("Authentication required.", 401, { "WWW-Authenticate": 'Bearer realm="MCP"' });
    }

    const server = createMcpServer();
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
