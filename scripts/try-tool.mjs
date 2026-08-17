#!/usr/bin/env node
/**
 * Invoke a municipal tool exactly the way the assistant would, without needing
 * an LLM key or a live Okta delegation.
 *
 * The context is synthesized from an email + Okta group names, and the scopes
 * are derived through the same persona matrix the real delegation path uses —
 * so an allow/deny here is the same decision the agent would get.
 *
 *   node scripts/try-tool.mjs --list
 *   node scripts/try-tool.mjs --email dana.whitfield@riverbend.example \
 *        --groups "Riverbend Residents" get_utility_account
 *   node scripts/try-tool.mjs --email l@x --groups "Riverbend Social Services" \
 *        get_assistance_cases '{"limit":5}'
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "apps/api/dist");

// The API reads .env itself on import; make sure DATABASE_URL is present first.
for (const line of readFileSync(path.join(root, ".env"), "utf8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
  const [key, ...rest] = trimmed.split("=");
  process.env[key.trim()] ??= rest.join("=").trim().replace(/^["']|["']$/g, "");
}

const { ALL_TOOLS, runTool, toolsForScopes } = await import(`${dist}/tools/registry.js`);
const shared = await import(`${root}/packages/shared/dist/index.js`);
const { prisma } = await import(`${dist}/lib/prisma.js`);

const args = process.argv.slice(2);

function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
}

if (args.includes("--list")) {
  for (const tool of ALL_TOOLS) {
    console.log(`${tool.name.padEnd(30)} ${tool.requiredScopes.join(" | ")}`);
  }
  await prisma.$disconnect();
  process.exit(0);
}

const email = flag("email", "dana.whitfield@riverbend.example").toLowerCase();
const groups = flag("groups", "Riverbend Residents").split(",").map((g) => g.trim());
const positional = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const toolName = positional[0];
const input = positional[1] ? JSON.parse(positional[1]) : {};

if (!toolName) {
  console.error("Usage: node scripts/try-tool.mjs [--email X] [--groups \"A,B\"] <tool> ['{json}']");
  console.error("       node scripts/try-tool.mjs --list");
  process.exit(1);
}

const scopes = shared.resolveScopesFromGroups(groups);
const persona = shared.primaryPersona(groups);
const user = await prisma.user.findUnique({
  where: { email },
  select: { residentId: true, displayName: true },
});

const ctx = {
  actorEmail: email,
  actorName: user?.displayName ?? email,
  role: shared.resolveRoleFromGroups(groups),
  personaId: persona?.id,
  personaLabel: persona?.label,
  scopes,
  residentId: user?.residentId ?? null,
  channel: "chat",
  requestId: "try-tool",
  delegation: { mode: "session", issuedScopes: scopes },
};

console.log(`actor    ${email}`);
console.log(`persona  ${persona?.label ?? "(none)"}  role=${ctx.role}  resident=${ctx.residentId ?? "—"}`);
console.log(`scopes   ${scopes.length} (${toolsForScopes(scopes).length}/${ALL_TOOLS.length} tools reachable)`);
console.log(`tool     ${toolName} ${JSON.stringify(input)}\n`);

const outcome = await runTool(toolName, input, ctx);
console.log(outcome.allowed ? "── ALLOWED ──" : "── DENIED ──");
console.log(JSON.stringify(outcome.result, null, 2));

await prisma.$disconnect();
process.exit(outcome.ok ? 0 : 2);
