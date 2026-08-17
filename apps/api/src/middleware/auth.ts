import type { NextFunction, Request, Response } from "express";
import {
  capDelegatedScopes,
  hasAnyScope,
  primaryPersona,
  resolveRoleFromGroups,
  resolveScopesFromGroups,
  type AuthUser,
  type OAuthScope,
} from "@resident/shared";
import { config } from "../config.js";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { verifyOAuthAccessToken } from "../lib/verify-oauth-token.js";
import type { MunicipalContext } from "../lib/context.js";

declare global {
  namespace Express {
    interface User extends AuthUser {}
    interface Request {
      oauth?: {
        sub: string;
        email?: string;
        scopes: string[];
        groups: string[];
        clientId: string;
      };
    }
  }
}

/** Attach `req.oauth` when a valid municipal AS bearer token is presented. */
export async function optionalBearerAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ") || !config.oauth.enabled) return next();
  try {
    const verified = await verifyOAuthAccessToken(header.slice(7));
    req.oauth = {
      sub: verified.sub,
      email: verified.email,
      scopes: verified.scopes,
      groups: verified.groups,
      clientId: verified.clientId,
    };
  } catch {
    return next(new AppError(401, "INVALID_TOKEN", "Invalid or expired access token"));
  }
  return next();
}

export function requireSession(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new AppError(401, "UNAUTHORIZED", "Sign in required"));
  return next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.role === "admin") return next();
  return next(new AppError(403, "FORBIDDEN", "City Administrator access required"));
}

export function requireScopes(...scopes: OAuthScope[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (req.oauth && hasAnyScope(req.oauth.scopes, scopes)) return next();
    if (req.user && hasAnyScope(req.user.scopes ?? [], scopes)) return next();
    return next(new AppError(403, "FORBIDDEN", `Required scope: ${scopes.join(" or ")}`));
  };
}

/**
 * Build the authorization context for a REST or MCP call.
 *
 * Bearer tokens win over the session cookie: an MCP client presenting a
 * municipal access token is the actor, even if a browser session happens to
 * exist. Bearer scopes are still capped by the operator's persona so a
 * generously-scoped token cannot exceed what its holder is entitled to.
 */
export async function buildContext(
  req: Request,
  channel: MunicipalContext["channel"]
): Promise<MunicipalContext> {
  const requestId = req.headers["x-request-id"] as string | undefined;

  if (req.oauth) {
    const email = req.oauth.email ?? req.user?.email;
    if (!email) {
      throw new AppError(
        401,
        "NO_SUBJECT_EMAIL",
        "The access token carries no email claim, so the portal cannot tell whose records it authorizes. Add `email` to the custom authorization server's token claims."
      );
    }
    const groups = req.oauth.groups.length ? req.oauth.groups : (req.user?.groups ?? []);
    const entitled = groups.length ? resolveScopesFromGroups(groups) : (req.user?.scopes ?? []);
    const effective = entitled.length
      ? capDelegatedScopes(req.oauth.scopes, entitled)
      : req.oauth.scopes;

    const record = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { residentId: true, displayName: true },
    });
    const persona = primaryPersona(groups);

    return {
      actorEmail: email.toLowerCase(),
      actorName: record?.displayName ?? email,
      role: groups.length ? resolveRoleFromGroups(groups) : (req.user?.role ?? "resident"),
      personaId: persona?.id,
      personaLabel: persona?.label,
      scopes: effective,
      residentId: record?.residentId ?? req.user?.residentId ?? null,
      channel,
      requestId,
      delegation: { mode: "bearer", issuedScopes: req.oauth.scopes },
    };
  }

  if (!req.user) throw new AppError(401, "UNAUTHORIZED", "Sign in required");

  return {
    actorEmail: req.user.email,
    actorName: req.user.displayName,
    role: req.user.role,
    personaId: req.user.personaId,
    personaLabel: req.user.persona,
    scopes: req.user.scopes ?? [],
    residentId: req.user.residentId ?? null,
    channel,
    requestId,
    delegation: { mode: "session", issuedScopes: req.user.scopes ?? [] },
  };
}
