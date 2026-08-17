import { decodeJwt } from "jose";
import type { Request } from "express";
import { AppError } from "./errors.js";
import { refreshOidcTokens } from "./oidc.js";

const EXPIRY_SKEW_SEC = 120;

export function idTokenExpiresAt(idToken: string): number | null {
  try {
    const exp = decodeJwt(idToken).exp;
    return typeof exp === "number" ? exp : null;
  } catch {
    return null;
  }
}

export function isIdTokenExpired(idToken: string, skewSec = EXPIRY_SKEW_SEC): boolean {
  const exp = idTokenExpiresAt(idToken);
  if (!exp) return true;
  return exp <= Math.floor(Date.now() / 1000) + skewSec;
}

/** A currently-valid org id_token for ID-JAG hop 1, refreshing when needed. */
export async function ensureFreshIdToken(req: Request): Promise<string> {
  const idToken = req.session?.idToken;
  if (!idToken) {
    throw new AppError(
      400,
      "OIDC_REQUIRED",
      "Sign in with Okta so your session carries an id_token the assistant can delegate from."
    );
  }
  if (!isIdTokenExpired(idToken)) return idToken;

  const refreshToken = req.session?.refreshToken;
  if (!refreshToken) {
    throw new AppError(
      401,
      "ID_TOKEN_EXPIRED",
      "Your Okta sign-in expired. Sign out and sign in again to keep using the assistant."
    );
  }

  const tokens = await refreshOidcTokens(refreshToken);
  if (!tokens.id_token) {
    throw new AppError(
      401,
      "ID_TOKEN_EXPIRED",
      "Could not refresh your Okta session. Sign out and sign in with Okta again."
    );
  }

  req.session.idToken = tokens.id_token;
  if (tokens.refresh_token) req.session.refreshToken = tokens.refresh_token;
  await new Promise<void>((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
  return tokens.id_token;
}
