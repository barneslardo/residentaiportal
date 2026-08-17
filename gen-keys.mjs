#!/usr/bin/env node
/**
 * Generate the two RSA signing keys the portal needs, as JWKs.
 *
 *   secrets/app-sign-on-key.json   — portal OIDC web app (private_key_jwt)
 *   secrets/agent-private-key.json — AI agent registration (both ID-JAG hops)
 *
 * The .public.json halves are what you upload to Okta. Existing keys are never
 * overwritten: rotating a key that Okta already trusts breaks sign-in until the
 * public half is re-registered, so that has to be a deliberate act.
 */
import { generateKeyPair, exportJWK } from "jose";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const secretsDir = path.join(root, "secrets");
mkdirSync(secretsDir, { recursive: true });

const force = process.argv.includes("--force");

async function makeKey(name) {
  const privPath = path.join(secretsDir, `${name}.json`);
  const pubPath = path.join(secretsDir, `${name}.public.json`);

  if (existsSync(privPath) && !force) {
    console.log(`· ${name}.json already exists — leaving it alone (use --force to replace)`);
    return;
  }

  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const kid = randomUUID();

  const priv = { ...(await exportJWK(privateKey)), kid, alg: "RS256", use: "sig" };
  const pub = { ...(await exportJWK(publicKey)), kid, alg: "RS256", use: "sig" };

  writeFileSync(privPath, `${JSON.stringify(priv, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(pubPath, `${JSON.stringify(pub, null, 2)}\n`);
  console.log(`✓ ${name}.json (kid ${kid})`);
}

await makeKey("app-sign-on-key");
await makeKey("agent-private-key");

console.log(`\nKeys are in ${secretsDir}`);
console.log("Upload the *.public.json halves to Okta, or let scripts/setup_okta.py do it.");
