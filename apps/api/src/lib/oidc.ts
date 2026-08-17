import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { config } from "../config.js";
import { listOktaUserGroupNames } from "./okta-client.js";

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type OidcDiscovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
};

let cachedMeta: OidcDiscovery | null = null;

export function isOidcEnabled(): boolean {
  return config.oidc.enabled;
}

/**
 * Human sign-in uses the Okta **org** authorization server, not the municipal
 * custom AS: hop 1 of ID-JAG requires an org-issued id_token.
 */
async function discovery(): Promise<OidcDiscovery> {
  if (cachedMeta) return cachedMeta;
  const orgUrl = config.oidc.orgUrl.replace(/\/$/, "");
  try {
    const res = await fetch(`${orgUrl}/.well-known/openid-configuration`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`OIDC discovery failed (${res.status})`);
    cachedMeta = (await res.json()) as OidcDiscovery;
    return cachedMeta;
  } catch (err) {
    console.warn(
      `[oidc] discovery fetch failed (${err instanceof Error ? err.message : err}); using org defaults`
    );
    cachedMeta = {
      issuer: orgUrl,
      authorization_endpoint: `${orgUrl}/oauth2/v1/authorize`,
      token_endpoint: `${orgUrl}/oauth2/v1/token`,
      jwks_uri: `${orgUrl}/oauth2/v1/keys`,
    };
    return cachedMeta;
  }
}

export function makePkce() {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export async function buildAuthUrl(opts: {
  state: string;
  nonce: string;
  codeChallenge: string;
}): Promise<string> {
  const meta = await discovery();
  const u = new URL(meta.authorization_endpoint);
  u.searchParams.set("client_id", config.oidc.clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", config.oidc.scopes);
  u.searchParams.set("redirect_uri", config.oidc.redirectUri);
  u.searchParams.set("state", opts.state);
  u.searchParams.set("nonce", opts.nonce);
  u.searchParams.set("code_challenge", opts.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

async function applyClientAuth(body: URLSearchParams, tokenEndpoint: string) {
  body.set("client_id", config.oidc.clientId);
  if (config.oidc.tokenAuthMethod === "private_key_jwt") {
    const { signClientAssertion } = await import("./signing-key.js");
    body.set("client_assertion_type", "urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
    body.set(
      "client_assertion",
      await signClientAssertion({
        keyPath: config.oidc.privateKeyPath,
        clientId: config.oidc.clientId,
        audience: tokenEndpoint,
      })
    );
    return;
  }
  if (config.oidc.clientSecret) {
    body.set("client_secret", config.oidc.clientSecret);
    return;
  }
  throw new Error(
    "OIDC token exchange needs OKTA_OIDC_CLIENT_SECRET, or private_key_jwt with secrets/app-sign-on-key.json"
  );
}

type TokenResponse = {
  id_token?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
};

export async function exchangeCode(code: string, codeVerifier: string): Promise<TokenResponse> {
  const meta = await discovery();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.oidc.redirectUri,
    code_verifier: codeVerifier,
  });
  await applyClientAuth(body, meta.token_endpoint);

  const res = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`OIDC code exchange failed (${res.status}): ${JSON.stringify(data)}`);
  return data as TokenResponse;
}

export async function refreshOidcTokens(refreshToken: string): Promise<TokenResponse> {
  const meta = await discovery();
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken });
  await applyClientAuth(body, meta.token_endpoint);

  const res = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`OIDC refresh failed (${res.status}): ${JSON.stringify(data)}`);
  return data as TokenResponse;
}

export async function verifyIdToken(idToken: string, expectedNonce: string) {
  const meta = await discovery();
  const jwks = createRemoteJWKSet(new URL(meta.jwks_uri));
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: meta.issuer,
    audience: config.oidc.clientId,
  });
  if (payload.nonce !== expectedNonce) throw new Error("OIDC nonce mismatch");
  return payload;
}

export function extractGroupsFromClaims(payload: Record<string, unknown>): string[] {
  const candidates = [
    payload.groups,
    payload["https://okta.com/groups"],
    payload.group,
    payload.resident_entitlement,
  ];
  const out = new Set<string>();
  for (const raw of candidates) {
    if (Array.isArray(raw)) for (const g of raw) out.add(String(g));
    else if (typeof raw === "string" && raw.trim()) out.add(raw.trim());
  }
  return [...out];
}

/**
 * Groups from the id_token, falling back to the Management API.
 *
 * The fallback matters because a missing `groups` claim looks identical to "this
 * user has no entitlements" — and would silently downgrade a City Administrator
 * to a bare resident.
 */
export async function resolveOidcGroups(payload: Record<string, unknown>): Promise<string[]> {
  const fromClaims = extractGroupsFromClaims(payload);
  if (fromClaims.length) return fromClaims;

  const sub = typeof payload.sub === "string" ? payload.sub : null;
  if (sub && config.okta.managementEnabled) {
    try {
      const fromApi = await listOktaUserGroupNames(sub);
      if (fromApi.length) {
        console.log(`[oidc] groups claim missing; resolved ${fromApi.length} group(s) via Okta API`);
        return fromApi;
      }
    } catch (err) {
      console.warn("[oidc] Okta group lookup failed:", err instanceof Error ? err.message : err);
    }
  }
  return [];
}
