import {
  formatDisplayName,
  primaryPersona,
  resolveRoleFromGroups,
  resolveScopesFromGroups,
  type AuthUser,
} from "@resident/shared";

/** Build the session user from verified OIDC claims + the local record. */
export function sessionUserFromIdentity(input: {
  id: string;
  email: string;
  oktaId: string | null;
  residentId: string | null;
  name?: string;
  firstName?: string;
  lastName?: string;
  groups: string[];
}): AuthUser {
  const persona = primaryPersona(input.groups);
  return {
    id: input.id,
    email: input.email,
    displayName: formatDisplayName({
      email: input.email,
      name: input.name,
      firstName: input.firstName,
      lastName: input.lastName,
    }),
    role: resolveRoleFromGroups(input.groups),
    oktaId: input.oktaId,
    residentId: input.residentId,
    groups: input.groups,
    scopes: resolveScopesFromGroups(input.groups),
    persona: persona?.label,
    personaId: persona?.id,
  };
}
