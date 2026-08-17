import { Router } from "express";
import {
  PERSONAS,
  SCOPE_CATEGORIES,
  SCOPE_DESCRIPTIONS,
  formatDisplayName,
  primaryPersona,
} from "@resident/shared";
import { config } from "../config.js";
import { AppError } from "../lib/errors.js";
import { sessionUserFromIdentity } from "../lib/auth-user.js";
import { upsertUserFromIdentity } from "../lib/user-provision.js";
import { isOidcEnabled } from "../lib/oidc.js";
import { oidcRouter } from "./oidc.js";
import { blockedToolsForScopes, toolsForScopes } from "../tools/registry.js";

export const authRouter = Router();

authRouter.use("/oidc", oidcRouter);

authRouter.get("/me", (req, res) => {
  if (!req.user) {
    return res.json({
      data: null,
      meta: { oidcEnabled: isOidcEnabled(), devLoginEnabled: config.devLoginEnabled },
    });
  }
  const scopes = req.user.scopes ?? [];
  res.json({
    data: {
      ...req.user,
      tools: {
        allowed: toolsForScopes(scopes).map((t) => t.name),
        blocked: blockedToolsForScopes(scopes).map((t) => ({
          name: t.name,
          requiredScopes: t.requiredScopes,
        })),
      },
      scopeDescriptions: Object.fromEntries(
        scopes.map((s) => [s, SCOPE_DESCRIPTIONS[s as keyof typeof SCOPE_DESCRIPTIONS] ?? s])
      ),
    },
    meta: { oidcEnabled: isOidcEnabled(), devLoginEnabled: config.devLoginEnabled },
  });
});

/** Persona reference for the trust panel and the demo script. */
authRouter.get("/personas", (_req, res) => {
  res.json({
    data: PERSONAS.map((p) => ({
      id: p.id,
      label: p.label,
      oktaGroup: p.oktaGroup,
      role: p.role,
      blurb: p.blurb,
      scopes: p.scopes,
    })),
    meta: { scopeCategories: SCOPE_CATEGORIES, scopeDescriptions: SCOPE_DESCRIPTIONS },
  });
});

/**
 * Dev-only sign-in so the portal is demonstrable before Okta is wired up.
 * Hard-disabled in production regardless of the env flag.
 */
authRouter.post("/dev-login", async (req, res, next) => {
  try {
    if (!config.devLoginEnabled) {
      throw new AppError(403, "DEV_LOGIN_DISABLED", "Dev login is disabled. Sign in with Okta.");
    }
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const groups: string[] = Array.isArray(req.body?.groups) ? req.body.groups.map(String) : [];
    if (!email.includes("@")) throw new AppError(400, "INVALID_EMAIL", "A valid email is required");
    if (!primaryPersona(groups)) {
      throw new AppError(
        400,
        "NO_PERSONA",
        `Pass at least one known group. Options: ${PERSONAS.map((p) => p.oktaGroup).join(", ")}`
      );
    }

    const displayName = formatDisplayName({ email, name: req.body?.name });
    const user = await upsertUserFromIdentity({ email, oktaId: null, displayName, groups });
    const sessionUser = sessionUserFromIdentity({
      id: user.id,
      email: user.email,
      oktaId: null,
      residentId: user.residentId,
      name: displayName,
      groups,
    });

    await new Promise<void>((resolve, reject) => {
      req.login(sessionUser, (err) => (err ? reject(err) : resolve()));
    });
    req.session.authMethod = "dev";
    res.json({ data: sessionUser });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy(() => res.json({ data: { loggedOut: true } }));
  });
});
