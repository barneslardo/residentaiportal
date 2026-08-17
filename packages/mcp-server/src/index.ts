#!/usr/bin/env node
/**
 * stdio ⇄ HTTP bridge for the Riverbend municipal MCP server.
 *
 * Desktop MCP clients speak stdio; the portal's MCP endpoint is an
 * OAuth-protected Streamable HTTP resource. This process is the adapter: it
 * exposes stdio locally and forwards every request to the portal with the
 * caller's municipal access token attached.
 *
 * The token is never minted here — you supply one that Okta already issued, so
 * the bridge cannot grant itself authority the operator does not have.
 *
 *   RIVERBEND_MCP_URL=https://resident.skylarbarnes.com/mcp \
 *   RIVERBEND_ACCESS_TOKEN=eyJ... \
 *   node packages/mcp-server/dist/index.js
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const url = process.env.RIVERBEND_MCP_URL ?? "https://resident.skylarbarnes.com/mcp";
const token = process.env.RIVERBEND_ACCESS_TOKEN ?? "";

if (!token) {
  console.error(
    "RIVERBEND_ACCESS_TOKEN is required.\n" +
      "Obtain a municipal access token from the Okta authorization server (client_credentials\n" +
      "or the portal's delegation flow), then re-run. The bridge does not mint tokens."
  );
  process.exit(1);
}

async function connectUpstream(): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client(
    { name: "riverbend-mcp-bridge", version: "1.0.0" },
    { capabilities: {} }
  );
  await client.connect(transport);
  return client;
}

const upstream = await connectUpstream().catch((err: unknown) => {
  console.error(
    `Could not reach the Riverbend MCP server at ${url}: ${err instanceof Error ? err.message : err}\n` +
      "A 401 here means the access token is expired, or its audience does not match the\n" +
      "server's MCP_RESOURCE_URL."
  );
  process.exit(1);
});

const server = new Server(
  { name: "riverbend-resident-portal", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// The upstream tool list is already scope-filtered, so whatever it returns is
// exactly what this token may call — no local filtering to keep in sync.
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const { tools } = await upstream.listTools();
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const result = await upstream.callTool({
    name: request.params.name,
    arguments: (request.params.arguments ?? {}) as Record<string, unknown>,
  });
  return result as { content: Array<{ type: "text"; text: string }>; isError?: boolean };
});

await server.connect(new StdioServerTransport());
console.error(`Riverbend MCP bridge ready → ${url}`);
