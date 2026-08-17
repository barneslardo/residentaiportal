import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import session from "express-session";
import passport from "passport";
import rateLimit from "express-rate-limit";
import { ZodError } from "zod";
import { CITY_NAME } from "@resident/shared";
import { agentDisabledReason, config, isProduction } from "./config.js";
import { errorHandler, sendError } from "./lib/errors.js";
import { requestId } from "./middleware/requestId.js";
import { optionalBearerAuth } from "./middleware/auth.js";
import { isOidcEnabled } from "./lib/oidc.js";
import { authRouter } from "./routes/auth.js";
import { chatRouter } from "./routes/chat.js";
import { portalRouter } from "./routes/portal.js";
import { getMcpPublicInfo, mountMcpRoutes } from "./mcp/routes.js";
import { isModelLocked, listAvailableChatModels } from "./lib/llm-proxy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

if (config.trustProxy) app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use(cors({ origin: config.corsOrigins, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(requestId);

app.use(
  session({
    name: "riverbend.sid",
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: isProduction,
      httpOnly: true,
      sameSite: "lax",
      domain: config.sessionCookieDomain || undefined,
      maxAge: 8 * 60 * 60 * 1000,
    },
  })
);

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user: Express.User, done) => done(null, user));
app.use(passport.initialize());
app.use(passport.session());

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "riverbend-resident-portal",
    city: CITY_NAME,
    oidc: isOidcEnabled(),
    oauth: config.oauth.enabled,
    agentDelegation: { enabled: config.agent.enabled, reason: agentDisabledReason() },
    llm: listAvailableChatModels().map((m) => m.id),
    llmLocked: isModelLocked(),
    mcp: getMcpPublicInfo(),
  });
});

mountMcpRoutes(app);

app.use("/auth", authRouter);
app.use("/api/v1/chat", apiLimiter, chatRouter);
app.use("/api/v1", apiLimiter, optionalBearerAuth, portalRouter);

// ── Static SPA (same origin — no second hostname, no CORS on the portal) ────
const webDist = path.resolve(__dirname, "../../web/dist");
if (fs.existsSync(webDist)) {
  app.use(
    express.static(webDist, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith("index.html")) res.setHeader("Cache-Control", "no-store");
      },
    })
  );
  app.get(/^\/(?!api|auth|mcp|health|\.well-known).*/, (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(path.join(webDist, "index.html"));
  });
} else {
  console.warn(`[web] no build at ${webDist} — run 'pnpm --filter @resident/web build'`);
}

app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof ZodError) {
    return sendError(res, 400, "VALIDATION_ERROR", "Invalid request data", err.flatten());
  }
  return errorHandler(err, req, res);
});

app.listen(config.port, () => {
  const mcp = getMcpPublicInfo();
  console.log(`Riverbend Resident Portal on http://localhost:${config.port}`);
  console.log(`  Public URL: ${config.appUrl}`);
  console.log(`  Okta OIDC:  ${isOidcEnabled() ? config.oidc.redirectUri : "disabled"}`);
  console.log(`  Delegation: ${config.agent.enabled ? "ID-JAG enabled" : `disabled (${agentDisabledReason()})`}`);
  console.log(`  MCP:        ${mcp.enabled ? mcp.url : "disabled (set OKTA_ISSUER)"}`);
  console.log(`  Models:     ${listAvailableChatModels().map((m) => m.id).join(", ") || "none configured"}`);
});
