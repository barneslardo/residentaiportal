#!/usr/bin/env node
/**
 * Check the agent registration's client authentication in isolation.
 *
 * A full ID-JAG exchange needs a live user id_token, which you only have inside
 * a browser session. But the failure mode that actually bites — the agent's
 * public key not being registered on the Okta side — shows up before the
 * subject token is ever examined. So: send a real, correctly-signed client
 * assertion with a deliberately bogus subject_token and read which error comes
 * back.
 *
 *   invalid_client            → Okta does not trust this key for this client
 *   invalid_grant / invalid_request → client auth PASSED, only the fake subject
 *                                     token was rejected (this is the good case)
 *
 *   node scripts/probe-agent.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { SignJWT, importJWK, decodeJwt } from "jose";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const env = {};
for (const line of readFileSync(path.join(root, ".env"), "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const [k, ...rest] = t.split("=");
  env[k.trim()] = rest.join("=").trim().replace(/^["']|["']$/g, "");
}

// CLI overrides let this probe be pointed at a known-good registration (e.g. the
// SIS demo's) as a control, to tell "this registration is misconfigured" apart
// from "the request shape is wrong".
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};

const orgUrl = (env.OKTA_ORG_URL || "").replace(/\/$/, "");
const clientId = arg("client-id", env.AGENT_CLIENT_ID || env.OKTA_AGENT_REGISTRATION_ID || "");
const asIssuer = (arg("audience", env.RESOURCE_AS_ISSUER || env.OKTA_ISSUER || "")).replace(/\/$/, "");
const rawKeyPath = arg("key", env.AGENT_PRIVATE_KEY_PATH || "secrets/agent-private-key.json");
const keyPath = path.isAbsolute(rawKeyPath) ? rawKeyPath : path.join(root, rawKeyPath);

if (!orgUrl || !clientId || !asIssuer) {
  console.error("Need OKTA_ORG_URL, AGENT_CLIENT_ID, and RESOURCE_AS_ISSUER in .env");
  process.exit(1);
}

const jwk = JSON.parse(readFileSync(keyPath, "utf8"));
const key = await importJWK(jwk, "RS256");
const tokenEndpoint = `${orgUrl}/oauth2/v1/token`;

console.log(`agent client  ${clientId}`);
console.log(`signing kid   ${jwk.kid}`);
console.log(`token endpoint ${tokenEndpoint}`);
console.log(`audience (AS)  ${asIssuer}\n`);

async function assertion(audience) {
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
    .setIssuer(clientId)
    .setSubject(clientId)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("5m")
    .setJti(randomUUID())
    .sign(key);
}

const body = new URLSearchParams({
  grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
  subject_token: "not-a-real-id-token",
  subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
  requested_token_type: "urn:ietf:params:oauth:token-type:id-jag",
  audience: asIssuer,
  scope: "resident.admin",
  client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
  client_assertion: await assertion(tokenEndpoint),
});

const res = await fetch(tokenEndpoint, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
  body,
});
const data = await res.json().catch(() => ({}));

console.log(`HTTP ${res.status}`);
console.log(JSON.stringify(data, null, 2));

// Okta answers this endpoint in two different shapes depending on the failure:
// RFC 6749 (`error`) and its own (`errorCode`). Reading only one of them turns a
// hard failure into a silent pass, which is worse than no check at all.
const err = data.error || data.errorCode || "";
const detail = data.error_description || data.errorSummary || "";
console.log("\n── verdict ──");
if (err === "invalid_client") {
  console.log(`✗ Okta rejected the client itself: ${detail || err}`);
  console.log("  Either the public key is not registered on this agent registration,");
  console.log("  or the registration cannot authenticate at the org token endpoint.");
  console.log(`  Public half to register on ${clientId}:`);
  console.log(`    ${path.join(root, "secrets/agent-private-key.public.json")}`);
  console.log(`    kid ${jwk.kid}`);
  process.exit(2);
} else if (res.status === 200) {
  console.log("? Unexpected success against a bogus subject token — inspect the response.");
} else if (/subject_token|assertion|invalid_grant|invalid_request/i.test(`${err} ${detail}`)) {
  console.log("✓ Client authentication PASSED — the key is registered and trusted.");
  console.log("  The remaining error is only the deliberately-fake subject token.");
  console.log("  Real delegation now depends on the AS policy allowing jwt-bearer,");
  console.log("  which /auth/oidc/delegation-probe will confirm once you sign in.");
} else {
  console.log(`? Inconclusive: ${err}${detail ? ` — ${detail}` : ""}`);
  console.log("  Not a client-auth rejection, but not the expected subject-token error either.");
  process.exit(3);
}
