import type { Express, Request, Response } from "express";
import { ALL_SCOPES, PORTAL_NAME } from "@resident/shared";
import { config, getMcpResourceUrl } from "../config.js";

export const MCP_SCOPES = ALL_SCOPES;

function issuer(): string {
  return config.oauth.issuer.replace(/\/$/, "");
}

export function buildProtectedResourceMetadata() {
  return {
    resource: getMcpResourceUrl(),
    authorization_servers: [issuer()],
    scopes_supported: MCP_SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: `${PORTAL_NAME} MCP`,
    resource_documentation: config.appUrl,
    mcp_protocol_version: "2025-03-26",
  };
}

function sendMetadata(res: Response, body: Record<string, unknown>) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.status(200).json(body);
}

function metadataHandler() {
  const body = buildProtectedResourceMetadata();
  return (req: Request, res: Response) => {
    if (req.method === "HEAD") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.status(200).end();
    }
    return sendMetadata(res, body);
  };
}

/**
 * RFC 9728 protected-resource metadata.
 *
 * Mounted at every path MCP clients and the Okta agent registry are known to
 * probe — they disagree about where it lives, and a 404 on the wrong one reads
 * as "this server isn't OAuth-protected".
 */
export function mountProtectedResourceMetadata(app: Express) {
  const handler = metadataHandler();
  const paths = [
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
    "/mcp/.well-known/oauth-protected-resource",
  ];
  for (const path of paths) {
    app.options(path, (_req, res) => {
      res.setHeader("Allow", "GET, HEAD, OPTIONS");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.status(204).end();
    });
    app.get(path, handler);
    app.head(path, handler);
  }
}

export function getProtectedResourceMetadataUrl(): string {
  return `${config.apiPublicUrl}/.well-known/oauth-protected-resource`;
}
