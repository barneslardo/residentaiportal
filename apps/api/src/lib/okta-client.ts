import { config } from "../config.js";

type OktaGroup = { id: string; profile?: { name?: string } };

async function oktaGet<T>(path: string): Promise<T> {
  const res = await fetch(`${config.okta.orgUrl}${path}`, {
    headers: {
      Authorization: `SSWS ${config.okta.apiToken}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`Okta API ${path} failed (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as T;
}

export function isOktaManagementConfigured(): boolean {
  return config.okta.managementEnabled;
}

/** Group names + ids for a user — both forms are accepted by the persona matcher. */
export async function listOktaUserGroupNames(userId: string): Promise<string[]> {
  const groups = await oktaGet<OktaGroup[]>(`/api/v1/users/${encodeURIComponent(userId)}/groups`);
  const out: string[] = [];
  for (const group of groups) {
    if (group.profile?.name) out.push(group.profile.name);
    if (group.id) out.push(group.id);
  }
  return out;
}
