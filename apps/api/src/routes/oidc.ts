import { randomUUID } from "node:crypto";
import { Router } from "express";
import { formatDisplayName, primaryPersona } from "@resident/shared";
import { config, agentDisabledReason } from "../config.js";
import { AppError } from "../lib/errors.js";
import {
  exchangeIdJagForAccessToken,
  getIdJag,
  isAgentExchangeEnabled,
} from "../lib/agent-token-exchange.js";
import { ensureFreshIdToken, idTokenExpiresAt, isIdTokenExpired } from "../lib/session-id-token.js";
import { buildAuthUrl, exchangeCode, isOidcEnabled, makePkce, resolveOidcGroups, verifyIdToken } from "../lib/oidc.js";
import { sessionUserFromIdentity } from "../lib/auth-user.js";
import { upsertUserFromIdentity } from "../lib/user-provision.js";

export const oidcRouter = Router();

function loginRedirect(res: import("express").Response, code: string, message?: string) {
  const qs = new URLSearchParams({ error: code });
  if (message) qs.set("message", message);
  return res.redirect(`${config.appUrl}/login?${qs.toString()}`);
}

oidcRouter.get("/login", async (req, res) => {
  if (!isOidcEnabled()) {
    return res
      .status(503)
      .json({ error: { code: "OIDC_DISABLED", message: "Okta sign-in is not configured yet" } });
  }
  try {
    const state = randomUUID();
    const nonce = randomUUID();
    const pkce = makePkce();
    req.session.oidc = { state, nonce, verifier: pkce.verifier };
    req.session.returnTo =
      typeof req.query.returnTo === "string" && req.query.returnTo.startsWith("/")
        ? req.query.returnTo
        : "/";
    res.redirect(await buildAuthUrl({ state, nonce, codeChallenge: pkce.challenge }));
  } catch (err) {
    console.error("[oidc] login error:", err);
    loginRedirect(res, "oidc_start_failed", err instanceof Error ? err.message : undefined);
  }
});

oidcRouter.get("/callback", async (req, res) => {
  if (!isOidcEnabled()) return loginRedirect(res, "oidc_disabled");

  const { code, state, error, error_description: errorDescription } = req.query;
  if (error) {
    return loginRedirect(res, String(error), errorDescription ? String(errorDescription) : undefined);
  }
  if (typeof code !== "string" || typeof state !== "string") {
    return loginRedirect(res, "invalid_callback");
  }
  const pending = req.session.oidc;
  if (!pending || pending.state !== state) return loginRedirect(res, "state_mismatch");

  try {
    const tokens = await exchangeCode(code, pending.verifier);
    if (!tokens.id_token) throw new Error("OIDC response missing id_token");

    const payload = (await verifyIdToken(tokens.id_token, pending.nonce)) as Record<string, unknown>;
    const email =
      (typeof payload.email === "string" && payload.email) ||
      (typeof payload.preferred_username === "string" && payload.preferred_username) ||
      null;
    if (!email?.includes("@")) throw new Error("OIDC token is missing an email claim");

    const groups = await resolveOidcGroups(payload);
    if (!primaryPersona(groups)) {
      return loginRedirect(
        res,
        "not_authorized",
        "Your Okta account is not in a Riverbend group yet. Ask the City Administrator to add you to Riverbend Residents or a departmental group."
      );
    }

    const firstName = typeof payload.given_name === "string" ? payload.given_name : undefined;
    const lastName = typeof payload.family_name === "string" ? payload.family_name : undefined;
    const displayName = formatDisplayName({
      email,
      name: typeof payload.name === "string" ? payload.name : undefined,
      firstName,
      lastName,
    });

    const user = await upsertUserFromIdentity({
      email: email.toLowerCase(),
      oktaId: typeof payload.sub === "string" ? payload.sub : null,
      displayName,
      firstName,
      lastName,
      groups,
    });

    delete req.session.oidc;
    const returnTo = req.session.returnTo || "/";
    delete req.session.returnTo;

    const sessionUser = sessionUserFromIdentity({
      id: user.id,
      email: user.email,
      oktaId: user.oktaId,
      residentId: user.residentId,
      name: displayName,
      firstName,
      lastName,
      groups,
    });

    // Passport 0.7 regenerates the session on login — stash tokens afterwards.
    await new Promise<void>((resolve, reject) => {
      req.login(sessionUser, (err) => (err ? reject(err) : resolve()));
    });
    req.session.idToken = tokens.id_token;
    if (typeof tokens.refresh_token === "string") req.session.refreshToken = tokens.refresh_token;
    req.session.authMethod = "oidc";
    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });

    const defaultPath = sessionUser.role === "resident" ? "/" : "/staff";
    const dest = returnTo && returnTo !== "/" && returnTo.startsWith("/") ? returnTo : defaultPath;
    res.redirect(`${config.appUrl}${dest}`);
  } catch (err) {
    console.error("[oidc] callback error:", err);
    loginRedirect(res, "oidc_callback_failed", err instanceof Error ? err.message : undefined);
  }
});

/** Delegation posture for the trust panel. */
oidcRouter.get("/agent-status", (req, res) => {
  const idToken = req.session?.idToken;
  const exp = idToken ? idTokenExpiresAt(idToken) : null;
  res.json({
    data: {
      agentExchangeEnabled: isAgentExchangeEnabled(),
      agentDisabledReason: agentDisabledReason(),
      hasIdToken: Boolean(idToken),
      idTokenExpired: idToken ? isIdTokenExpired(idToken) : null,
      idTokenExpiresAt: exp ? new Date(exp * 1000).toISOString() : null,
      hasRefreshToken: Boolean(req.session?.refreshToken),
      authMethod: req.session?.authMethod ?? null,
      oidcAppClientId: config.oidc.clientId || null,
      agentRegistrationId: config.agent.registrationId || null,
      agentClientId: config.agent.clientId || null,
      resourceAuthorizationServer: config.agent.resourceAsIssuer || null,
    },
  });
});

/** Run both ID-JAG hops and report exactly where they fail. */
oidcRouter.get("/delegation-probe", async (req, res, next) => {
  try {
    if (!req.user) throw new AppError(401, "UNAUTHORIZED", "Sign in required");
    if (!isAgentExchangeEnabled()) {
      throw new AppError(503, "AGENT_DISABLED", agentDisabledReason() ?? "Agent exchange not configured");
    }
    const idToken = await ensureFreshIdToken(req);

    let hop1: Record<string, unknown> = { ok: false };
    let hop2: Record<string, unknown> = { ok: false };
    try {
      const jag = await getIdJag(idToken);
      hop1 = { ok: true, jti: jag.jti, audience: jag.aud, subject: jag.sub };
      try {
        const token = await exchangeIdJagForAccessToken(jag.idJag);
        hop2 = {
          ok: true,
          scope: token.scope,
          expiresIn: token.expires_in,
          tokenType: token.token_type,
        };
      } catch (err) {
        hop2 = { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    } catch (err) {
      hop1 = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    res.json({ data: { hop1, hop2 } });
  } catch (err) {
    next(err);
  }
});
