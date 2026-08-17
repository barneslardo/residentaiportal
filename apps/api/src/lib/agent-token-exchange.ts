import { decodeJwt } from "jose";
import { ALL_SCOPES } from "@resident/shared";
import { config } from "../config.js";
import { signClientAssertion } from "./signing-key.js";

export function isAgentExchangeEnabled(): boolean {
  return config.agent.enabled;
}

/**
 * Hop 1 requests only `resident.*` scopes — `openid` and friends are invalid on
 * an org-AS token-exchange and make Okta reject the whole request.
 */
function agentExchangeScopes(scope?: string): string {
  const raw = scope || config.agent.tokenScope || ALL_SCOPES.join(" ");
  const requested = raw.split(/\s+/).filter((s) => s.startsWith("resident."));
  return (requested.length ? requested : ALL_SCOPES).join(" ");
}

export type IdJagResult = {
  idJag: string;
  jti?: string;
  aud?: string;
  sub?: string;
  expiresAt?: number;
};

/** Hop 1: user id_token → ID-JAG addressed to the municipal authorization server. */
export async function getIdJag(idToken: string, scope?: string): Promise<IdJagResult> {
  const clientId = config.agent.clientId;
  const orgUrl = config.agent.orgUrl.replace(/\/$/, "");
  const tokenEndpoint = `${orgUrl}/oauth2/v1/token`;

  const clientAssertion = await signClientAssertion({
    keyPath: config.agent.privateKeyPath,
    clientId,
    audience: tokenEndpoint,
  });

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token: idToken,
    subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
    requested_token_type: "urn:ietf:params:oauth:token-type:id-jag",
    audience: config.agent.resourceAsIssuer,
    scope: agentExchangeScopes(scope),
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: clientAssertion,
  });

  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
    error_description?: string;
    errorSummary?: string;
  };
  if (!res.ok) {
    throw new Error(
      `ID-JAG exchange failed (${res.status}): ${
        data.error_description ?? data.errorSummary ?? data.error ?? JSON.stringify(data)
      }`
    );
  }
  if (!data.access_token) throw new Error("ID-JAG response missing access_token");

  const result: IdJagResult = { idJag: data.access_token };
  try {
    const claims = decodeJwt(data.access_token);
    result.jti = typeof claims.jti === "string" ? claims.jti : undefined;
    result.aud = Array.isArray(claims.aud) ? claims.aud.join(",") : (claims.aud as string | undefined);
    result.sub = typeof claims.sub === "string" ? claims.sub : undefined;
    result.expiresAt = typeof claims.exp === "number" ? claims.exp : undefined;
  } catch {
    /* opaque assertion — the audit row simply carries no jti */
  }
  return result;
}

export type DelegatedTokenResponse = {
  access_token?: string;
  scope?: string;
  expires_in?: number;
  token_type?: string;
};

/** Hop 2: ID-JAG → delegated access token on the municipal custom AS. */
export async function exchangeIdJagForAccessToken(idJag: string): Promise<DelegatedTokenResponse> {
  const clientId = config.agent.clientId;
  const issuer = config.agent.resourceAsIssuer.replace(/\/$/, "");
  const tokenEndpoint = `${issuer}/v1/token`;

  const clientAssertion = await signClientAssertion({
    keyPath: config.agent.privateKeyPath,
    clientId,
    audience: tokenEndpoint,
  });

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: idJag,
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: clientAssertion,
  });

  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  const data = (await res.json().catch(() => ({}))) as DelegatedTokenResponse & {
    error?: string;
    error_description?: string;
    errorSummary?: string;
  };
  if (!res.ok) {
    throw new Error(
      `Delegated access token exchange failed (${res.status}): ${
        data.error_description ?? data.errorSummary ?? data.error ?? JSON.stringify(data)
      }`
    );
  }
  return data;
}

export type DelegationResult = {
  accessToken: string;
  grantedScopes: string[];
  expiresIn?: number;
  idJagJti?: string;
  idJagAud?: string;
};

/** Both hops. The returned token is what every agent tool call is authorized by. */
export async function getDelegatedAccessToken(
  idToken: string,
  scope?: string
): Promise<DelegationResult> {
  const hop1 = await getIdJag(idToken, scope);
  const hop2 = await exchangeIdJagForAccessToken(hop1.idJag);
  if (!hop2.access_token) throw new Error("Token exchange returned no access_token");
  return {
    accessToken: hop2.access_token,
    grantedScopes: (hop2.scope ?? "").split(/\s+/).filter(Boolean),
    expiresIn: hop2.expires_in,
    idJagJti: hop1.jti,
    idJagAud: hop1.aud,
  };
}
