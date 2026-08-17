import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { PORTAL_NAME } from "@resident/shared";
import { runTool, toolsForScopes } from "../tools/registry.js";
import type { MunicipalContext } from "../lib/context.js";

/**
 * An MCP server bound to one verified access token.
 *
 * The tool list is built from that token's scopes rather than from the full
 * registry: a client should see the shape of its authority up front, not
 * discover it by collecting refusals.
 */
export function createMunicipalMcpServer(ctx: MunicipalContext): Server {
  const server = new Server(
    {
      name: "riverbend-resident-portal",
      version: "1.0.0",
      description: `${PORTAL_NAME} — municipal services for the authenticated resident or staff member.`,
    },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolsForScopes(ctx.scopes).map((tool) => ({
      name: tool.name,
      description: `${tool.description} (authorized by ${tool.requiredScopes.join(" or ")})`,
      inputSchema: tool.input_schema,
      ...(tool.writes ? { annotations: { destructiveHint: false, readOnlyHint: false } } : { annotations: { readOnlyHint: true } }),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const outcome = await runTool(
      request.params.name,
      (request.params.arguments ?? {}) as Record<string, unknown>,
      ctx
    );
    return {
      content: [{ type: "text" as const, text: JSON.stringify(outcome.result, null, 2) }],
      isError: !outcome.ok,
    };
  });

  return server;
}
