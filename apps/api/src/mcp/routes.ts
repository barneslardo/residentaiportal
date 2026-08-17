import { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { config, getMcpResourceUrl, getOAuthAudience } from "../config.js";
import { AppError } from "../lib/errors.js";
import { buildContext, optionalBearerAuth } from "../middleware/auth.js";
import { createMunicipalMcpServer } from "./server.js";
import { fetchAndMergeOktaAsMetadata, mountMcpDiscoveryRoutes } from "./discovery.js";
import {
  MCP_SCOPES,
  getProtectedResourceMetadataUrl,
  mountProtectedResourceMetadata,
} from "./metadata.js";

/** RFC 9728: point unauthenticated clients at the metadata that tells them how to auth. */
function challenge(res: Response, description: string) {
  res.setHeader(
    "WWW-Authenticate",
    `Bearer resource_metadata="${getProtectedResourceMetadataUrl()}", error="invalid_token", error_description="${description}"`
  );
  res.status(401).json({
    jsonrpc: "2.0",
    error: { code: -32001, message: description },
    id: null,
  });
}

export function mountMcpRoutes(app: Express) {
  mountMcpDiscoveryRoutes(app);

  if (!config.oauth.enabled) {
    app.all("/mcp", (_req, res) => {
      res.status(503).json({
        error:
          "MCP requires OAuth. Set OKTA_ISSUER to the municipal custom authorization server and restart.",
      });
    });
    return;
  }

  mountProtectedResourceMetadata(app);

  app.get("/.well-known/oauth-authorization-server", async (_req, res) => {
    try {
      const metadata = await fetchAndMergeOktaAsMetadata();
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=300");
      res.json(metadata);
    } catch (err) {
      res.status(502).json({
        error: "Failed to load authorization server metadata",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });

  const transports: Record<string, StreamableHTTPServerTransport> = {};

  async function requireBearer(req: Request, res: Response): Promise<boolean> {
    if (!req.headers.authorization?.startsWith("Bearer ")) {
      challenge(res, "A municipal access token is required");
      return false;
    }
    if (!req.oauth) {
      challenge(res, "The access token could not be verified");
      return false;
    }
    return true;
  }

  const postHandler = async (req: Request, res: Response) => {
    if (!(await requireBearer(req, res))) return;

    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    try {
      if (sessionId && transports[sessionId]) {
        await transports[sessionId].handleRequest(req, res, req.body);
        return;
      }
      if (!sessionId && isInitializeRequest(req.body)) {
        const ctx = await buildContext(req, "mcp");
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            transports[id] = transport;
          },
        });
        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && transports[sid]) delete transports[sid];
        };
        const server = createMunicipalMcpServer(ctx);
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: no valid MCP session id" },
        id: null,
      });
    } catch (err) {
      console.error("[mcp] request error:", err);
      if (res.headersSent) return;
      const status = err instanceof AppError ? err.statusCode : 500;
      res.status(status).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: err instanceof AppError ? err.message : "Internal server error",
        },
        id: null,
      });
    }
  };

  const sessionHandler = async (req: Request, res: Response) => {
    if (!(await requireBearer(req, res))) return;
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing MCP session id");
      return;
    }
    try {
      await transports[sessionId].handleRequest(req, res);
    } catch {
      if (!res.headersSent) res.status(500).send("MCP session error");
    }
  };

  app.post("/mcp", optionalBearerAuth, postHandler);
  app.get("/mcp", optionalBearerAuth, sessionHandler);
  app.delete("/mcp", optionalBearerAuth, sessionHandler);
}

export function getMcpPublicInfo() {
  const url = getMcpResourceUrl();
  return {
    enabled: config.oauth.enabled,
    url,
    resource: url,
    issuer: config.oauth.issuer || null,
    audience: getOAuthAudience(),
    protectedResourceMetadata: config.oauth.enabled ? getProtectedResourceMetadataUrl() : null,
    scopes: MCP_SCOPES,
  };
}
