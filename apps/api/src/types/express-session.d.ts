import "express-session";

declare module "express-session" {
  interface SessionData {
    /** In-flight OIDC authorization request (state, nonce, PKCE verifier). */
    oidc?: { state: string; nonce: string; verifier: string };
    returnTo?: string;
    /** Org-issued id_token — the subject token for ID-JAG hop 1. */
    idToken?: string;
    refreshToken?: string;
    authMethod?: "oidc" | "dev";
  }
}
