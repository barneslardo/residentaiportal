import { OAuthScopes, hasAnyScope, type OAuthScope } from "@resident/shared";

/**
 * Everything an operation needs to decide "may this actor do this, to this record".
 *
 * One context type is shared by the three ways a tool can be reached — the
 * in-app assistant (delegated ID-JAG token), an external MCP client (bearer
 * token), and the REST API (session or bearer) — so the authorization decision
 * is made in exactly one place regardless of entry point.
 */
export type DelegationInfo = {
  mode: "id-jag" | "bearer" | "session";
  /** Scopes Okta actually put on the token, before the app's persona cap. */
  issuedScopes: string[];
  jti?: string;
  aud?: string;
  expiresIn?: number;
};

export type MunicipalContext = {
  actorEmail: string;
  actorName: string;
  role: "resident" | "staff" | "admin";
  personaId?: string;
  personaLabel?: string;
  /** Effective scopes: what Okta granted, capped by the operator's persona. */
  scopes: string[];
  /** The acting person's own household record, when they have one. */
  residentId: string | null;
  channel: "chat" | "mcp" | "rest" | "ui";
  requestId?: string;
  delegation: DelegationInfo;
};

export function contextHasScope(ctx: MunicipalContext, required: readonly OAuthScope[]): boolean {
  return hasAnyScope(ctx.scopes, required);
}

export function isAdmin(ctx: MunicipalContext): boolean {
  return ctx.scopes.includes(OAuthScopes.ADMIN);
}

/**
 * Can this actor reach `residentId`'s records?
 *
 * `.self` scopes authorize the verb; this authorizes the row. Staff-wide scopes
 * (or admin) lift the restriction — that is the whole point of the persona
 * contrast in the demo.
 */
export function canReachResident(
  ctx: MunicipalContext,
  residentId: string | null | undefined,
  staffScopes: readonly OAuthScope[]
): boolean {
  if (isAdmin(ctx)) return true;
  if (residentId && ctx.residentId && residentId === ctx.residentId) return true;
  return hasAnyScope(ctx.scopes, staffScopes);
}

export class ScopeError extends Error {
  constructor(
    public required: OAuthScope[],
    public reason: string
  ) {
    super(reason);
  }
}
