/**
 * OAuth scopes published by the Riverbend municipal custom authorization server.
 *
 * Every scope is dot-separated and prefixed `resident.` so it never collides with
 * the `sis.*` scopes on the SIS demo's authorization server in the same Okta org.
 *
 * `.self` scopes are resident-facing: they authorize access to the signed-in
 * person's own records only, and the API enforces the ownership check on top of
 * the scope check. Scopes without `.self` are staff-facing and read across
 * residents — those are what make the "same agent, different operator" contrast
 * land in the demo.
 */
export const OAuthScopes = {
  // ── Resident self-service ────────────────────────────────────────────────
  PROFILE_READ_SELF: "resident.profile.read.self",
  PROFILE_WRITE_SELF: "resident.profile.write.self",
  BILLING_READ_SELF: "resident.billing.read.self",
  BILLING_PAY: "resident.billing.pay",
  PERMITS_READ_SELF: "resident.permits.read.self",
  PERMITS_APPLY: "resident.permits.apply",
  REQUESTS_READ_SELF: "resident.requests.read.self",
  REQUESTS_CREATE: "resident.requests.create",
  CITATIONS_READ_SELF: "resident.citations.read.self",
  CITATIONS_PAY: "resident.citations.pay",
  CITATIONS_CONTEST: "resident.citations.contest",
  PROGRAMS_REGISTER: "resident.programs.register",

  // ── Staff / departmental ─────────────────────────────────────────────────
  RECORDS_READ: "resident.records.read",
  RECORDS_WRITE: "resident.records.write",
  BILLING_READ: "resident.billing.read",
  BILLING_ADJUST: "resident.billing.adjust",
  REQUESTS_MANAGE: "resident.requests.manage",
  PERMITS_REVIEW: "resident.permits.review",
  CODE_ENFORCEMENT: "resident.code.enforcement",
  TAX_READ: "resident.tax.read",
  ASSISTANCE: "resident.assistance",

  // ── City administrator ───────────────────────────────────────────────────
  ADMIN: "resident.admin",
} as const;

export type OAuthScope = (typeof OAuthScopes)[keyof typeof OAuthScopes];

export const ALL_SCOPES: OAuthScope[] = Object.values(OAuthScopes);

/** Human-readable copy for the trust panel, Okta AS setup, and refusal messages. */
export const SCOPE_DESCRIPTIONS: Record<OAuthScope, string> = {
  [OAuthScopes.PROFILE_READ_SELF]: "Read your own resident profile and household record",
  [OAuthScopes.PROFILE_WRITE_SELF]: "Update your own contact information and alert preferences",
  [OAuthScopes.BILLING_READ_SELF]: "Read your own utility account, statements, and payment history",
  [OAuthScopes.BILLING_PAY]: "Submit a payment against your own utility or tax balance",
  [OAuthScopes.PERMITS_READ_SELF]: "Read permits and licenses you hold or applied for",
  [OAuthScopes.PERMITS_APPLY]: "Submit a new permit or license application on your own behalf",
  [OAuthScopes.REQUESTS_READ_SELF]: "Read the 311 service requests you reported",
  [OAuthScopes.REQUESTS_CREATE]: "Open a new 311 service request",
  [OAuthScopes.CITATIONS_READ_SELF]: "Read citations issued to you or your vehicles",
  [OAuthScopes.CITATIONS_PAY]: "Pay one of your own citations",
  [OAuthScopes.CITATIONS_CONTEST]: "File a contest statement for one of your own citations",
  [OAuthScopes.PROGRAMS_REGISTER]: "Register a household member for a city program",
  [OAuthScopes.RECORDS_READ]: "Look up any resident's core record (staff)",
  [OAuthScopes.RECORDS_WRITE]: "Create or amend any resident's core record (staff)",
  [OAuthScopes.BILLING_READ]: "Read any utility account and statement history (staff)",
  [OAuthScopes.BILLING_ADJUST]: "Apply credits, waive fees, or reverse charges (staff)",
  [OAuthScopes.REQUESTS_MANAGE]: "Triage, assign, and close any 311 service request (staff)",
  [OAuthScopes.PERMITS_REVIEW]: "Review, approve, deny, and schedule inspections on any permit (staff)",
  [OAuthScopes.CODE_ENFORCEMENT]: "Read and update code-enforcement cases and inspector notes (staff)",
  [OAuthScopes.TAX_READ]: "Read any parcel's property-tax assessment and bills (staff)",
  [OAuthScopes.ASSISTANCE]: "Read income-qualified assistance cases and caseworker notes (staff)",
  [OAuthScopes.ADMIN]: "Full administrative access to every municipal dataset",
};

/** Scope groupings used by the UI trust panel. */
export const SCOPE_CATEGORIES: Array<{ id: string; label: string; scopes: OAuthScope[] }> = [
  {
    id: "self",
    label: "Self-service",
    scopes: [
      OAuthScopes.PROFILE_READ_SELF,
      OAuthScopes.PROFILE_WRITE_SELF,
      OAuthScopes.BILLING_READ_SELF,
      OAuthScopes.BILLING_PAY,
      OAuthScopes.PERMITS_READ_SELF,
      OAuthScopes.PERMITS_APPLY,
      OAuthScopes.REQUESTS_READ_SELF,
      OAuthScopes.REQUESTS_CREATE,
      OAuthScopes.CITATIONS_READ_SELF,
      OAuthScopes.CITATIONS_PAY,
      OAuthScopes.CITATIONS_CONTEST,
      OAuthScopes.PROGRAMS_REGISTER,
    ],
  },
  {
    id: "staff",
    label: "Departmental",
    scopes: [
      OAuthScopes.RECORDS_READ,
      OAuthScopes.RECORDS_WRITE,
      OAuthScopes.BILLING_READ,
      OAuthScopes.BILLING_ADJUST,
      OAuthScopes.REQUESTS_MANAGE,
      OAuthScopes.PERMITS_REVIEW,
      OAuthScopes.CODE_ENFORCEMENT,
      OAuthScopes.TAX_READ,
      OAuthScopes.ASSISTANCE,
    ],
  },
  { id: "admin", label: "Administrative", scopes: [OAuthScopes.ADMIN] },
];

export function isOAuthScope(value: string): value is OAuthScope {
  return (ALL_SCOPES as string[]).includes(value);
}

/** True when `granted` satisfies at least one of `required`; `resident.admin` satisfies everything. */
export function hasAnyScope(granted: string[], required: readonly OAuthScope[]): boolean {
  if (granted.includes(OAuthScopes.ADMIN)) return true;
  return required.some((scope) => granted.includes(scope));
}

/**
 * Intersect what Okta granted with what this operator's persona is entitled to.
 *
 * Okta policy is the authority, but the AS grants at the client level: if the
 * agent registration is allowed to request every scope, a permissive rule can
 * hand back more than the signed-in operator should wield. Capping here keeps
 * the app's answer correct even if the AS policy drifts, and the delta is
 * logged so the demo can show defence-in-depth rather than hide it.
 */
export function capDelegatedScopes(oktaGranted: string[], entitled: string[]): string[] {
  const entitledSet = new Set(entitled);
  if (entitledSet.has(OAuthScopes.ADMIN)) return oktaGranted.filter(isOAuthScope);
  return oktaGranted.filter((scope) => entitledSet.has(scope));
}
