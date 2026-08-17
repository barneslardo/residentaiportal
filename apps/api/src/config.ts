import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_SCOPES, configurePersonaGroupIds } from "@resident/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Repo root .env — dist/ and src/ are both two levels below apps/api. */
const envPath = path.resolve(__dirname, "../../../.env");
dotenv.config({ path: envPath, override: true });

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

function resolveOktaOrgUrl(): string {
  const explicit = optional("OKTA_ORG_URL");
  if (explicit) return explicit.replace(/\/$/, "");
  const issuer = optional("OKTA_ISSUER");
  if (issuer) {
    try {
      return new URL(issuer).origin;
    } catch {
      /* fall through */
    }
  }
  return "";
}

function resolveKeyPath(raw: string, fallback: string): string {
  const value = raw || fallback;
  return path.isAbsolute(value) ? value : path.resolve(path.dirname(envPath), value);
}

const oktaOrgUrl = resolveOktaOrgUrl();
const oktaApiToken = optional("OKTA_API_TOKEN").trim().replace(/^SSWS\s+/i, "");

const oidcClientId = optional("OKTA_OIDC_CLIENT_ID");
const oidcRedirectUri =
  optional("OKTA_OIDC_REDIRECT_URI") ||
  `${optional("API_PUBLIC_URL", "http://localhost:3220").replace(/\/$/, "")}/auth/oidc/callback`;

const agentRegistrationId = optional("OKTA_AGENT_REGISTRATION_ID");
/** AI agent registration id — signs both ID-JAG hops. Never the OIDC web app id. */
const agentClientId = optional("AGENT_CLIENT_ID") || agentRegistrationId;

const agentKeyPath = resolveKeyPath(optional("AGENT_PRIVATE_KEY_PATH"), "secrets/agent-private-key.json");
const oidcKeyPath = resolveKeyPath(optional("OKTA_OIDC_PRIVATE_KEY_PATH"), "secrets/app-sign-on-key.json");
const agentKeyOnDisk = fs.existsSync(agentKeyPath);
const oidcKeyOnDisk = fs.existsSync(oidcKeyPath);

const resourceAsIssuer = (optional("RESOURCE_AS_ISSUER") || optional("OKTA_ISSUER")).replace(/\/$/, "");

function resolveOidcTokenAuthMethod(): "private_key_jwt" | "client_secret" {
  const explicit = optional("OKTA_OIDC_AUTH_METHOD").toLowerCase();
  if (explicit === "private_key_jwt" || explicit === "client_secret") return explicit;
  return oidcKeyOnDisk && oidcClientId ? "private_key_jwt" : "client_secret";
}

configurePersonaGroupIds(process.env.OKTA_GROUP_IDS);

const nodeEnv = process.env.NODE_ENV ?? "development";

export const config = {
  port: parseInt(optional("API_PORT", "3220"), 10),
  nodeEnv,
  appUrl: optional("APP_URL", "http://localhost:5175").replace(/\/$/, ""),
  apiPublicUrl: optional("API_PUBLIC_URL", "http://localhost:3220").replace(/\/$/, ""),
  corsOrigins: optional("CORS_ORIGIN", "http://localhost:5175")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  sessionSecret: optional("SESSION_SECRET", "dev-session-secret-change-me"),
  sessionCookieDomain: optional("SESSION_COOKIE_DOMAIN"),
  databaseUrl: optional("DATABASE_URL", "postgresql://resident:resident@localhost:5441/resident_portal"),
  trustProxy: process.env.TRUST_PROXY !== "false",

  /** Dev login form — never available in production regardless of the flag. */
  devLoginEnabled: process.env.DEV_LOGIN_ENABLED === "true" && nodeEnv !== "production",
  paymentsRequireConfirmation: process.env.PAYMENTS_REQUIRE_CONFIRMATION !== "false",

  oauth: {
    issuer: optional("OKTA_ISSUER").replace(/\/$/, ""),
    /** Must match the custom AS audience AND the PRM `resource` value. */
    audience: optional("OKTA_AUDIENCE"),
    enabled: Boolean(optional("OKTA_ISSUER")),
  },

  okta: {
    orgUrl: oktaOrgUrl,
    apiToken: oktaApiToken,
    /** Management API is optional — used only to backfill a missing groups claim. */
    managementEnabled: Boolean(oktaApiToken && oktaOrgUrl),
  },

  /** Human sign-in (authorization code + PKCE). */
  oidc: {
    orgUrl: oktaOrgUrl,
    clientId: oidcClientId,
    clientSecret: optional("OKTA_OIDC_CLIENT_SECRET"),
    redirectUri: oidcRedirectUri,
    scopes: optional("OIDC_SCOPES", "openid profile email groups offline_access"),
    tokenAuthMethod: resolveOidcTokenAuthMethod(),
    privateKeyPath: oidcKeyOnDisk ? oidcKeyPath : "",
    enabled: Boolean(oidcClientId && oidcRedirectUri && oktaOrgUrl),
  },

  /** Okta AI agent registration — ID-JAG exchange for delegated resident.* scopes. */
  agent: {
    orgUrl: oktaOrgUrl,
    clientId: agentClientId,
    registrationId: agentRegistrationId,
    privateKeyPath: agentKeyPath,
    resourceAsIssuer,
    tokenScope: optional("AGENT_TOKEN_SCOPE", ALL_SCOPES.join(" ")),
    enabled: Boolean(
      agentClientId &&
        agentClientId !== oidcClientId &&
        resourceAsIssuer.includes("/oauth2/aus") &&
        oktaOrgUrl &&
        agentKeyOnDisk
    ),
  },

  llm: {
    grokKey: optional("GROK_API_KEY") || optional("XAI_API_KEY"),
    openaiKey: optional("OPENAI_API_KEY"),
    anthropicKey: optional("ANTHROPIC_API_KEY"),
    defaultModel: optional("CHAT_DEFAULT_MODEL", "grok-4.3"),
    /**
     * Pin the assistant to exactly one model. Enforced server-side: the model
     * list collapses to this entry and any model/provider on the request is
     * ignored, so a crafted request cannot reach a different vendor even if
     * another provider's key happens to be present in the environment.
     * Set to an empty string to allow every configured model.
     */
    lockedModel: optional("CHAT_LOCKED_MODEL", "grok-4.3").trim(),
  },
};

/** Why the agent exchange is off — surfaced in /health and the trust panel. */
export function agentDisabledReason(): string | null {
  if (config.agent.enabled) return null;
  if (!config.agent.clientId) return "AGENT_CLIENT_ID is not set";
  if (config.agent.clientId === config.oidc.clientId)
    return "AGENT_CLIENT_ID must be the AI agent registration, not the OIDC web app client id";
  if (!config.agent.resourceAsIssuer.includes("/oauth2/aus"))
    return "RESOURCE_AS_ISSUER must be the municipal custom authorization server (…/oauth2/aus…)";
  if (!config.agent.orgUrl) return "OKTA_ORG_URL is not set";
  return `agent private key not found at ${config.agent.privateKeyPath}`;
}

/** MCP protected resource identifier (RFC 9728). */
export function getMcpResourceUrl(): string {
  const explicit = process.env.MCP_RESOURCE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  return `${config.apiPublicUrl}/mcp`;
}

/** Expected `aud` claim on resident.* access tokens. */
export function getOAuthAudience(): string {
  return (config.oauth.audience || getMcpResourceUrl()).replace(/\/$/, "");
}

export function getAcceptedOAuthAudiences(): string[] {
  const primary = getOAuthAudience();
  const alt = `${config.apiPublicUrl}/mcp`;
  return primary === alt ? [primary] : [primary, alt];
}

export const isProduction = config.nodeEnv === "production" || config.apiPublicUrl.startsWith("https://");

export function assertDatabaseUrl() {
  if (!config.databaseUrl) throw new Error("DATABASE_URL is required");
}
