import type { Express } from "express";
import { config, getMcpResourceUrl } from "../config.js";

type AsMetadata = Record<string, unknown>;

let cached: { at: number; data: AsMetadata } | null = null;
const TTL_MS = 5 * 60 * 1000;

/**
 * Mirror the municipal AS metadata on the resource host.
 *
 * Some MCP clients (and Okta's own registry) probe
 * /.well-known/oauth-authorization-server on the *resource* origin rather than
 * following the PRM's authorization_servers entry.
 */
export async function fetchAndMergeOktaAsMetadata(): Promise<AsMetadata> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.data;
  if (!config.oauth.issuer) throw new Error("OKTA_ISSUER is not configured");

  const res = await fetch(`${config.oauth.issuer}/.well-known/oauth-authorization-server`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Okta AS metadata fetch failed (${res.status})`);

  const upstream = (await res.json()) as AsMetadata;
  const data: AsMetadata = {
    ...upstream,
    resource: getMcpResourceUrl(),
    resource_documentation: config.appUrl,
  };
  cached = { at: Date.now(), data };
  return data;
}

export function mountMcpDiscoveryRoutes(app: Express) {
  app.get("/.well-known/mcp", (_req, res) => {
    res.json({
      name: "riverbend-resident-portal",
      version: "1.0.0",
      transport: "streamable-http",
      endpoint: getMcpResourceUrl(),
      authorization: config.oauth.enabled
        ? {
            type: "oauth2",
            issuer: config.oauth.issuer,
            protected_resource_metadata: `${config.apiPublicUrl}/.well-known/oauth-protected-resource`,
          }
        : null,
    });
  });
}
