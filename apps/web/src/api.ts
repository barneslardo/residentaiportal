export type ApiEnvelope<T> = { data: T; meta?: Record<string, unknown> };

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<ApiEnvelope<T>> {
  const res = await fetch(path, {
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers as Record<string, string> | undefined),
    },
    ...init,
  });

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string; details?: unknown } })?.error;
    throw new ApiError(
      res.status,
      err?.code ?? "REQUEST_FAILED",
      err?.message ?? `Request failed (${res.status})`,
      err?.details
    );
  }
  return body as ApiEnvelope<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
};

// ── Types shared with the API responses ────────────────────────────────────

export type Me = {
  id: string;
  email: string;
  displayName: string;
  role: "resident" | "staff" | "admin";
  residentId: string | null;
  groups: string[];
  scopes: string[];
  persona?: string;
  personaId?: string;
  tools: { allowed: string[]; blocked: Array<{ name: string; requiredScopes: string[] }> };
  scopeDescriptions: Record<string, string>;
};

export type AgentStatus = {
  agentExchangeEnabled: boolean;
  agentDisabledReason: string | null;
  hasIdToken: boolean;
  idTokenExpired: boolean | null;
  idTokenExpiresAt: string | null;
  hasRefreshToken: boolean;
  authMethod: string | null;
  oidcAppClientId: string | null;
  agentRegistrationId: string | null;
  agentClientId: string | null;
  resourceAuthorizationServer: string | null;
};

export type ToolTrace = {
  tool: string;
  allowed: boolean;
  requiredScopes: string[];
  durationMs: number;
  denyReason?: string;
};

export type ChatReply = {
  content: string;
  provider: string;
  model: string;
  toolTrace: ToolTrace[];
  delegation: {
    mode: string;
    issuedScopes: string[];
    effectiveScopes: string[];
    cappedBy: string | null;
    expiresIn?: number;
    idJagJti?: string;
    audience?: string;
  };
};

export type PendingIntent = {
  token: string;
  kind: string;
  referenceLabel: string;
  amount: string;
  amountCents: number;
  createdVia: string;
  approvedAt: string | null;
  expiresAt: string;
};
