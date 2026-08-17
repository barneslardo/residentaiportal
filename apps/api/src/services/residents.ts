import { OAuthScopes, type ContactUpdateInput } from "@resident/shared";
import { prisma } from "../lib/prisma.js";
import { ScopeError, canReachResident, isAdmin, type MunicipalContext } from "../lib/context.js";

const STAFF_READ = [OAuthScopes.RECORDS_READ] as const;

export function requireOwnResident(ctx: MunicipalContext): string {
  if (!ctx.residentId) {
    throw new ScopeError(
      [OAuthScopes.RECORDS_READ],
      "This account is not linked to a Riverbend household record, so there is no 'my account' to read. Staff accounts must look a resident up by name, address, or account number instead."
    );
  }
  return ctx.residentId;
}

/** Resolve the resident a tool call is about, defaulting to the actor's own. */
export async function resolveResidentId(
  ctx: MunicipalContext,
  ref?: { residentId?: string; accountNumber?: string; email?: string }
): Promise<string> {
  if (!ref || (!ref.residentId && !ref.accountNumber && !ref.email)) {
    return requireOwnResident(ctx);
  }

  const resident = await prisma.resident.findFirst({
    where: {
      OR: [
        ref.residentId ? { id: ref.residentId } : undefined,
        ref.accountNumber ? { accountNumber: ref.accountNumber } : undefined,
        ref.email ? { email: ref.email.toLowerCase() } : undefined,
      ].filter(Boolean) as object[],
    },
    select: { id: true },
  });
  if (!resident) throw new ScopeError([], "No Riverbend resident matches that identifier.");

  if (!canReachResident(ctx, resident.id, STAFF_READ)) {
    throw new ScopeError(
      [OAuthScopes.RECORDS_READ],
      "That record belongs to another household. Reading it needs resident.records.read, which is granted to city staff — your session only carries self-service scopes."
    );
  }
  return resident.id;
}

export async function getResidentProfile(ctx: MunicipalContext, residentId: string) {
  if (!canReachResident(ctx, residentId, STAFF_READ)) {
    throw new ScopeError([OAuthScopes.RECORDS_READ], "That household record is not yours to read.");
  }
  const resident = await prisma.resident.findUnique({
    where: { id: residentId },
    include: {
      utilityAccounts: { select: { accountNumber: true, serviceAddress: true, services: true, status: true, autopayEnabled: true } },
    },
  });
  if (!resident) throw new ScopeError([], "Resident not found.");

  return {
    id: resident.id,
    accountNumber: resident.accountNumber,
    name: `${resident.firstName} ${resident.lastName}`,
    email: resident.email,
    phone: resident.phone,
    serviceAddress: `${resident.serviceAddress}, ${resident.serviceCity}, ${resident.serviceState} ${resident.serviceZip}`,
    mailingAddress: resident.mailingAddress
      ? `${resident.mailingAddress}, ${resident.mailingCity}, ${resident.mailingState} ${resident.mailingZip}`
      : null,
    parcelId: resident.parcelId,
    ward: resident.ward,
    householdSize: resident.householdSize,
    moveInDate: resident.moveInDate?.toISOString().slice(0, 10) ?? null,
    alerts: {
      email: resident.alertEmail,
      sms: resident.alertSms,
      topics: resident.alertTopics,
    },
    utilityAccounts: resident.utilityAccounts,
  };
}

export async function updateOwnContactInfo(ctx: MunicipalContext, input: ContactUpdateInput) {
  const residentId = requireOwnResident(ctx);
  const updated = await prisma.resident.update({
    where: { id: residentId },
    data: {
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.mailingAddress !== undefined ? { mailingAddress: input.mailingAddress } : {}),
      ...(input.mailingCity !== undefined ? { mailingCity: input.mailingCity } : {}),
      ...(input.mailingState !== undefined ? { mailingState: input.mailingState } : {}),
      ...(input.mailingZip !== undefined ? { mailingZip: input.mailingZip } : {}),
      ...(input.alertEmail !== undefined ? { alertEmail: input.alertEmail } : {}),
      ...(input.alertSms !== undefined ? { alertSms: input.alertSms } : {}),
      ...(input.alertTopics !== undefined ? { alertTopics: input.alertTopics } : {}),
    },
  });
  return {
    updated: true,
    phone: updated.phone,
    mailingAddress: updated.mailingAddress,
    alerts: { email: updated.alertEmail, sms: updated.alertSms, topics: updated.alertTopics },
  };
}

/** Staff lookup across the resident roll. */
export async function lookupResidents(
  ctx: MunicipalContext,
  input: { query?: string; limit?: number }
) {
  if (!isAdmin(ctx) && !ctx.scopes.includes(OAuthScopes.RECORDS_READ)) {
    throw new ScopeError(
      [OAuthScopes.RECORDS_READ],
      "Searching the resident roll needs resident.records.read (city staff). Residents can only read their own record."
    );
  }
  const q = input.query?.trim();
  const residents = await prisma.resident.findMany({
    where: q
      ? {
          OR: [
            { firstName: { contains: q, mode: "insensitive" } },
            { lastName: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            { serviceAddress: { contains: q, mode: "insensitive" } },
            { accountNumber: { contains: q, mode: "insensitive" } },
            { parcelId: { contains: q, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: Math.min(input.limit ?? 20, 100),
    select: {
      id: true,
      accountNumber: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      serviceAddress: true,
      serviceZip: true,
      ward: true,
      parcelId: true,
    },
  });
  return {
    count: residents.length,
    residents: residents.map((r) => ({
      ...r,
      name: `${r.firstName} ${r.lastName}`,
    })),
  };
}
