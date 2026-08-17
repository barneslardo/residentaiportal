import { OAuthScopes, type OAuthScope } from "./scopes.js";

/**
 * Okta groups → municipal personas → OAuth scopes.
 *
 * This table is the single source of truth for three things that must agree:
 *   1. the groups `scripts/setup_okta.py` creates in the Okta org,
 *   2. the scopes the app will accept on a delegated token (see capDelegatedScopes),
 *   3. the persona label and explanation text the assistant uses when it refuses.
 *
 * `groupNames` are matched case-insensitively against the `groups` claim, and
 * `groupId` (filled in after setup_okta.py runs, or via OKTA_GROUP_* env vars)
 * is matched exactly so the demo still works if the claim carries group IDs.
 */
export type PersonaId =
  | "resident"
  | "clerk"
  | "utility_billing"
  | "public_works"
  | "building_permits"
  | "code_enforcement"
  | "treasurer"
  | "social_services"
  | "administrator";

export type PersonaDef = {
  id: PersonaId;
  label: string;
  /** Okta group display name created by scripts/setup_okta.py. */
  oktaGroup: string;
  /** Additional lowercase tokens accepted from the `groups` claim. */
  groupNames: string[];
  /** Portal role — drives which UI surfaces render. */
  role: "resident" | "staff" | "admin";
  scopes: OAuthScope[];
  /** One-line description used in the trust panel and in refusal messages. */
  blurb: string;
};

const RESIDENT_SELF_SCOPES: OAuthScope[] = [
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
];

export const PERSONAS: PersonaDef[] = [
  {
    id: "resident",
    label: "Resident",
    oktaGroup: "Riverbend Residents",
    // "Riverbend Users" is accepted as an umbrella app-assignment group: anyone
    // who can open the portal at all is at least a resident. Staff who are in
    // both it and a departmental group get the union of the two scope sets,
    // which is correct — staff have their own household too.
    groupNames: ["riverbend residents", "riverbend users", "residents"],
    role: "resident",
    scopes: RESIDENT_SELF_SCOPES,
    blurb: "A Riverbend household — can act only on their own account.",
  },
  {
    id: "clerk",
    label: "City Clerk",
    oktaGroup: "Riverbend City Clerk",
    groupNames: ["riverbend city clerk", "city clerk"],
    role: "staff",
    scopes: [OAuthScopes.RECORDS_READ, OAuthScopes.RECORDS_WRITE, OAuthScopes.PROGRAMS_REGISTER],
    blurb: "Maintains the resident roll and registers households for city programs.",
  },
  {
    id: "utility_billing",
    label: "Utility Billing",
    oktaGroup: "Riverbend Utility Billing",
    groupNames: ["riverbend utility billing", "utility billing"],
    role: "staff",
    scopes: [OAuthScopes.RECORDS_READ, OAuthScopes.BILLING_READ, OAuthScopes.BILLING_ADJUST],
    blurb: "Reads any utility account and can issue credits or waive late fees.",
  },
  {
    id: "public_works",
    label: "Public Works Dispatch",
    oktaGroup: "Riverbend Public Works",
    groupNames: ["riverbend public works", "public works"],
    role: "staff",
    scopes: [OAuthScopes.RECORDS_READ, OAuthScopes.REQUESTS_MANAGE],
    blurb: "Triages and closes 311 service requests; no billing or case-file access.",
  },
  {
    id: "building_permits",
    label: "Building & Permits",
    oktaGroup: "Riverbend Building Permits",
    groupNames: ["riverbend building permits", "building permits", "building and permits"],
    role: "staff",
    scopes: [OAuthScopes.RECORDS_READ, OAuthScopes.PERMITS_REVIEW],
    blurb: "Reviews permit applications and schedules inspections.",
  },
  {
    id: "code_enforcement",
    label: "Code Enforcement",
    oktaGroup: "Riverbend Code Enforcement",
    groupNames: ["riverbend code enforcement", "code enforcement"],
    role: "staff",
    scopes: [
      OAuthScopes.RECORDS_READ,
      OAuthScopes.CODE_ENFORCEMENT,
      OAuthScopes.REQUESTS_MANAGE,
    ],
    blurb: "Works code cases and inspector notes — the only staff role that reads them.",
  },
  {
    id: "treasurer",
    label: "Treasurer",
    oktaGroup: "Riverbend Treasurer",
    groupNames: ["riverbend treasurer", "treasurer"],
    role: "staff",
    scopes: [OAuthScopes.RECORDS_READ, OAuthScopes.TAX_READ, OAuthScopes.BILLING_READ],
    blurb: "Reads property-tax assessments and bills across every parcel.",
  },
  {
    id: "social_services",
    label: "Social Services",
    oktaGroup: "Riverbend Social Services",
    groupNames: ["riverbend social services", "social services"],
    role: "staff",
    scopes: [OAuthScopes.RECORDS_READ, OAuthScopes.ASSISTANCE],
    blurb:
      "Handles income-qualified assistance cases — the most sensitive dataset in the portal.",
  },
  {
    id: "administrator",
    label: "City Administrator",
    oktaGroup: "Riverbend City Administrator",
    groupNames: ["riverbend city administrator", "city administrator"],
    role: "admin",
    scopes: [OAuthScopes.ADMIN],
    blurb: "Full access, including the agent audit log.",
  },
];

export const PERSONA_BY_ID: Record<PersonaId, PersonaDef> = Object.fromEntries(
  PERSONAS.map((p) => [p.id, p])
) as Record<PersonaId, PersonaDef>;

/** Optional exact group-ID matching, populated from OKTA_GROUP_IDS env at runtime. */
let groupIdIndex: Record<string, PersonaId> = {};

/** `OKTA_GROUP_IDS="resident=00g...,clerk=00g..."` → exact-match index. */
export function configurePersonaGroupIds(raw: string | undefined): void {
  if (!raw) return;
  const next: Record<string, PersonaId> = {};
  for (const pair of raw.split(",")) {
    const [personaId, groupId] = pair.split("=").map((s) => s.trim());
    if (!personaId || !groupId) continue;
    if (personaId in PERSONA_BY_ID) next[groupId.toLowerCase()] = personaId as PersonaId;
  }
  groupIdIndex = next;
}

function matchesPersona(persona: PersonaDef, token: string): boolean {
  const t = token.trim().toLowerCase();
  if (!t) return false;
  if (groupIdIndex[t] === persona.id) return true;
  return persona.groupNames.some((name) => t === name || t.includes(name));
}

/** Every persona implied by the Okta groups on the session. */
export function resolvePersonas(groups: string[] = []): PersonaDef[] {
  return PERSONAS.filter((persona) => groups.some((g) => matchesPersona(persona, g)));
}

/** The persona shown in the UI — the widest one the operator holds. */
export function primaryPersona(groups: string[] = []): PersonaDef | undefined {
  const matched = resolvePersonas(groups);
  if (!matched.length) return undefined;
  const rank: Record<PersonaDef["role"], number> = { admin: 3, staff: 2, resident: 1 };
  return matched.slice().sort((a, b) => rank[b.role] - rank[a.role])[0];
}

/** Union of scopes granted by every matched persona. */
export function resolveScopesFromGroups(groups: string[] = []): OAuthScope[] {
  const matched = resolvePersonas(groups);
  const scopes = new Set<OAuthScope>();
  for (const persona of matched) for (const scope of persona.scopes) scopes.add(scope);
  return [...scopes];
}

export function resolveRoleFromGroups(groups: string[] = []): "resident" | "staff" | "admin" {
  return primaryPersona(groups)?.role ?? "resident";
}

/**
 * Session-entitled scopes: the ceiling this operator can ever delegate to the
 * agent, regardless of what Okta returns. Falls back to the scopes already
 * stored on the session (dev login) when no groups resolve.
 */
export function resolveSessionEntitledScopes(
  groups: string[] = [],
  fallbackScopes: string[] = []
): string[] {
  const fromGroups = resolveScopesFromGroups(groups);
  if (fromGroups.length) return fromGroups;
  return fallbackScopes;
}

/** Which personas could satisfy a scope — used to say "ask the Treasurer" in refusals. */
export function personasGranting(scope: OAuthScope): PersonaDef[] {
  return PERSONAS.filter(
    (p) => p.scopes.includes(scope) || p.scopes.includes(OAuthScopes.ADMIN)
  );
}
