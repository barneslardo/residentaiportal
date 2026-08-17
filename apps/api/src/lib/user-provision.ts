import {
  formatReference,
  primaryPersona,
  resolveRoleFromGroups,
  resolveScopesFromGroups,
} from "@resident/shared";
import { prisma } from "./prisma.js";

/**
 * JIT-provision the signed-in Okta user.
 *
 * Anyone in a resident-facing group who has no household record yet gets one
 * created with a fresh account number and a starter utility account, so a brand
 * new demo user has something to look at on first sign-in.
 */
export async function upsertUserFromIdentity(input: {
  email: string;
  oktaId: string | null;
  displayName: string;
  firstName?: string;
  lastName?: string;
  groups: string[];
}) {
  const role = resolveRoleFromGroups(input.groups);
  const scopes = resolveScopesFromGroups(input.groups);
  const persona = primaryPersona(input.groups);

  const resident = await prisma.resident.findUnique({ where: { email: input.email } });
  let residentId = resident?.id ?? null;

  if (!residentId && role === "resident") {
    const created = await provisionResident({
      email: input.email,
      firstName: input.firstName ?? input.displayName.split(" ")[0] ?? "Riverbend",
      lastName: input.lastName ?? input.displayName.split(" ").slice(1).join(" ") ?? "Resident",
    });
    residentId = created.id;
  }

  return prisma.user.upsert({
    where: { email: input.email },
    update: {
      oktaId: input.oktaId,
      displayName: input.displayName,
      role,
      personaId: persona?.id ?? null,
      groups: input.groups,
      scopes,
      residentId,
      lastLoginAt: new Date(),
    },
    create: {
      email: input.email,
      oktaId: input.oktaId,
      displayName: input.displayName,
      role,
      personaId: persona?.id ?? null,
      groups: input.groups,
      scopes,
      residentId,
      lastLoginAt: new Date(),
    },
  });
}

/** A minimal but non-empty household so first sign-in is not a blank portal. */
async function provisionResident(input: { email: string; firstName: string; lastName: string }) {
  const count = await prisma.resident.count();
  const accountNumber = formatReference("RB", count + 1001);
  const serviceAddress = `${100 + count} Riverbend Way`;

  const resident = await prisma.resident.create({
    data: {
      accountNumber,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      serviceAddress,
      mailingAddress: serviceAddress,
      mailingCity: "Riverbend",
      mailingState: "MN",
      mailingZip: "55044",
      parcelId: `27-${String(100000 + count).slice(0, 6)}`,
      moveInDate: new Date(),
      alertTopics: ["water_main", "snow_emergency"],
    },
  });

  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - 30 * 24 * 60 * 60 * 1000);
  const dueDate = new Date(periodEnd.getTime() + 21 * 24 * 60 * 60 * 1000);

  await prisma.utilityAccount.create({
    data: {
      accountNumber: `${accountNumber}-U1`,
      residentId: resident.id,
      serviceAddress,
      services: ["water", "sewer", "trash", "recycling"],
      meterId: `M${100000 + count}`,
      statements: {
        create: {
          statementNumber: formatReference("ST", count + 5001),
          periodStart,
          periodEnd,
          dueDate,
          waterGallons: 3400,
          waterCents: 4210,
          sewerCents: 3180,
          trashCents: 2400,
          stormwaterCents: 850,
          amountCents: 10640,
          status: "due",
        },
      },
    },
  });

  return resident;
}
