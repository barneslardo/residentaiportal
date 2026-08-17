import { config } from "../config.js";

/**
 * Org-wide AI agent inventory.
 *
 * The Agent Gateway pitch opens on three questions an org usually cannot
 * answer: where do agents exist, what can they reach, and what did they do.
 * The first two are answerable today from the Okta APIs, and the answer is
 * usually uncomfortable — which is exactly what makes it worth showing.
 */

type OktaClient = {
  client_id: string;
  client_name?: string;
  token_endpoint_auth_method?: string;
  grant_types?: string[];
  application_type?: string;
  client_id_issued_at?: number;
  jwks?: { keys?: Array<{ kid?: string; kty?: string; alg?: string }> };
};

type McpServer = {
  id: string;
  resourceUrl?: string;
  displayName?: string;
  status?: string;
  authorizationServerCount?: number;
  created?: string;
  detectedMetadata?: {
    resourceName?: string;
    scopesSupported?: string[];
    lastRefreshedAt?: string;
  };
};

type AuthServer = { id: string; name?: string; issuer?: string; audiences?: string[]; status?: string };

export type Finding = {
  severity: "high" | "medium" | "low";
  subject: string;
  title: string;
  detail: string;
};

async function oktaGet<T>(path: string): Promise<T> {
  const res = await fetch(`${config.okta.orgUrl}${path}`, {
    headers: { Authorization: `SSWS ${config.okta.apiToken}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Okta ${path} → ${res.status}`);
  return (await res.json()) as T;
}

const STALE_DAYS = 30;

function daysSince(iso?: string): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

/** An agent registration is a `wlp*` client — invisible to /api/v1/apps. */
function isAgent(client: OktaClient): boolean {
  return client.client_id?.startsWith("wlp");
}

export async function buildAgentInventory() {
  if (!config.okta.managementEnabled) {
    throw new Error("Okta Management API is not configured (set OKTA_API_TOKEN)");
  }

  const [clients, mcpRaw, authServers] = await Promise.all([
    oktaGet<OktaClient[]>("/oauth2/v1/clients?limit=200"),
    oktaGet<{ data?: McpServer[] } | McpServer[]>("/resource-servers/api/v1/mcp-servers").catch(
      () => [] as McpServer[]
    ),
    oktaGet<AuthServer[]>("/api/v1/authorizationServers?limit=200").catch(() => [] as AuthServer[]),
  ]);

  const mcpServers: McpServer[] = Array.isArray(mcpRaw) ? mcpRaw : (mcpRaw.data ?? []);
  const agents = clients.filter(isAgent);
  const findings: Finding[] = [];

  // Signing keys shared across clients: whoever holds that private key can
  // authenticate as every client listing it, which collapses two identities
  // into one and makes the audit trail ambiguous.
  const kidOwners = new Map<string, string[]>();
  for (const client of clients) {
    for (const key of client.jwks?.keys ?? []) {
      if (!key.kid) continue;
      kidOwners.set(key.kid, [...(kidOwners.get(key.kid) ?? []), client.client_name || client.client_id]);
    }
  }
  for (const [kid, owners] of kidOwners) {
    if (owners.length > 1) {
      findings.push({
        severity: "high",
        subject: owners.join(" + "),
        title: "Signing key shared across clients",
        detail: `kid ${kid} is registered on ${owners.length} clients. Holding that private key authenticates as any of them, so actions cannot be attributed to one identity.`,
      });
    }
  }

  for (const agent of agents) {
    const keys = agent.jwks?.keys ?? [];
    const name = agent.client_name || agent.client_id;

    if (keys.length === 0) {
      findings.push({
        severity: "high",
        subject: name,
        title: "Agent has no signing key",
        detail: "It cannot authenticate at the token endpoint, so it is either abandoned or relies on a credential held somewhere outside Okta.",
      });
    }
    if (/^(untitled|test|demo|new)\b/i.test(agent.client_name ?? "")) {
      findings.push({
        severity: "medium",
        subject: name,
        title: "Unidentifiable agent name",
        detail: `"${agent.client_name}" says nothing about what this agent does or who owns it — the first thing that breaks an inventory.`,
      });
    }
    if (agent.token_endpoint_auth_method && agent.token_endpoint_auth_method !== "private_key_jwt") {
      findings.push({
        severity: "medium",
        subject: name,
        title: `Weaker client authentication (${agent.token_endpoint_auth_method})`,
        detail: "Agent registrations should use private_key_jwt so no shared secret is transmitted or stored.",
      });
    }
  }

  for (const server of mcpServers) {
    const label = server.displayName || server.detectedMetadata?.resourceName || server.resourceUrl || server.id;
    if (server.status && server.status !== "ACTIVE") {
      findings.push({
        severity: "high",
        subject: label,
        title: `MCP server ${server.status}`,
        detail: `${server.resourceUrl} did not validate. Okta could not read its protected-resource metadata.`,
      });
    }
    if ((server.authorizationServerCount ?? 0) === 0 && server.status === "ACTIVE") {
      findings.push({
        severity: "high",
        subject: label,
        title: "No authorization server resolved",
        detail: "Okta could not match this server to an authorization server, so tokens for it cannot be governed. Usually the RFC 9728 metadata omits authorization_servers or is unreachable.",
      });
    }
    const age = daysSince(server.detectedMetadata?.lastRefreshedAt);
    if (age !== null && age > STALE_DAYS) {
      findings.push({
        severity: "medium",
        subject: label,
        title: `Metadata ${age} days stale`,
        detail: `Okta last read this server's scopes on ${server.detectedMetadata?.lastRefreshedAt?.slice(0, 10)}. Scopes added since then are invisible to policy.`,
      });
    }
  }

  const order = { high: 0, medium: 1, low: 2 } as const;
  findings.sort((a, b) => order[a.severity] - order[b.severity]);

  return {
    generatedAt: new Date().toISOString(),
    org: config.okta.orgUrl,
    summary: {
      agents: agents.length,
      oauthClients: clients.length,
      mcpServers: mcpServers.length,
      authorizationServers: authServers.length,
      findings: findings.length,
      highSeverity: findings.filter((f) => f.severity === "high").length,
    },
    agents: agents
      .map((a) => ({
        clientId: a.client_id,
        name: a.client_name || "(unnamed)",
        authMethod: a.token_endpoint_auth_method ?? "—",
        grantTypes: a.grant_types ?? [],
        keyCount: a.jwks?.keys?.length ?? 0,
        keyIds: (a.jwks?.keys ?? []).map((k) => k.kid).filter(Boolean) as string[],
        createdAt: a.client_id_issued_at ? new Date(a.client_id_issued_at * 1000).toISOString() : null,
        crossAppAccess: (a.grant_types ?? []).some((g) => g.includes("token-exchange")),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    mcpServers: mcpServers.map((s) => ({
      id: s.id,
      resourceUrl: s.resourceUrl ?? "—",
      name: s.displayName || s.detectedMetadata?.resourceName || "(undetected)",
      status: s.status ?? "UNKNOWN",
      authorizationServerCount: s.authorizationServerCount ?? 0,
      scopes: s.detectedMetadata?.scopesSupported ?? [],
      lastRefreshedAt: s.detectedMetadata?.lastRefreshedAt ?? null,
      staleDays: daysSince(s.detectedMetadata?.lastRefreshedAt),
    })),
    authorizationServers: authServers.map((s) => ({
      id: s.id,
      name: s.name ?? "—",
      issuer: s.issuer ?? "—",
      audiences: s.audiences ?? [],
      status: s.status ?? "—",
    })),
    findings,
  };
}
