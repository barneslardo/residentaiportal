import {
  OAuthScopes,
  PROGRAM_CATEGORY_LABELS,
  formatCents,
  formatReference,
  type ProgramCategory,
  type ProgramRegisterInput,
} from "@resident/shared";
import { prisma } from "../lib/prisma.js";
import { ScopeError, isAdmin, type MunicipalContext } from "../lib/context.js";
import { requireOwnResident } from "./residents.js";

/** Program catalog is public information — no scope needed to browse it. */
export async function searchPrograms(input: {
  query?: string;
  category?: string;
  age?: number;
  openOnly?: boolean;
  limit?: number;
}) {
  const now = new Date();
  const programs = await prisma.program.findMany({
    where: {
      ...(input.category ? { category: input.category } : {}),
      ...(input.query
        ? {
            OR: [
              { name: { contains: input.query, mode: "insensitive" } },
              { description: { contains: input.query, mode: "insensitive" } },
              { location: { contains: input.query, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(typeof input.age === "number" ? { ageMin: { lte: input.age }, ageMax: { gte: input.age } } : {}),
      ...(input.openOnly ? { registrationOpens: { lte: now }, registrationCloses: { gte: now } } : {}),
    },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    take: Math.min(input.limit ?? 25, 100),
  });

  return {
    count: programs.length,
    programs: programs.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      category: p.category,
      categoryLabel: PROGRAM_CATEGORY_LABELS[p.category as ProgramCategory] ?? p.category,
      season: p.season,
      description: p.description,
      location: p.location,
      schedule: p.schedule,
      ages: `${p.ageMin}–${p.ageMax}`,
      fee: formatCents(p.feeCents),
      feeCents: p.feeCents,
      spotsRemaining: Math.max(p.capacity - p.enrolled, 0),
      registrationOpen: p.registrationOpens <= now && p.registrationCloses >= now,
      registrationCloses: p.registrationCloses.toISOString().slice(0, 10),
    })),
  };
}

export async function registerForProgram(ctx: MunicipalContext, input: ProgramRegisterInput) {
  const residentId = requireOwnResident(ctx);
  const program = await prisma.program.findFirst({
    where: { OR: [{ id: input.programId }, { code: input.programId }] },
  });
  if (!program) throw new ScopeError([], `No program matches ${input.programId}.`);

  const now = new Date();
  if (program.registrationOpens > now) {
    throw new ScopeError(
      [],
      `Registration for ${program.name} opens ${program.registrationOpens.toISOString().slice(0, 10)}.`
    );
  }
  if (program.registrationCloses < now) {
    throw new ScopeError([], `Registration for ${program.name} closed ${program.registrationCloses.toISOString().slice(0, 10)}.`);
  }
  if (program.enrolled >= program.capacity) {
    throw new ScopeError([], `${program.name} is full (${program.capacity} spots). Ask about the waitlist at the Rec Center.`);
  }
  if (
    typeof input.participantAge === "number" &&
    (input.participantAge < program.ageMin || input.participantAge > program.ageMax)
  ) {
    throw new ScopeError(
      [],
      `${program.name} is for ages ${program.ageMin}–${program.ageMax}; the participant is ${input.participantAge}.`
    );
  }

  const count = await prisma.programRegistration.count();
  const registration = await prisma.$transaction(async (tx) => {
    await tx.program.update({ where: { id: program.id }, data: { enrolled: { increment: 1 } } });
    return tx.programRegistration.create({
      data: {
        confirmationRef: formatReference("REG", count + 1),
        programId: program.id,
        residentId,
        participantName: input.participantName,
        participantAge: input.participantAge ?? null,
        notes: input.notes ?? null,
        feeCents: program.feeCents,
        status: program.feeCents > 0 ? "registered_unpaid" : "registered",
      },
    });
  });

  return {
    confirmationRef: registration.confirmationRef,
    program: program.name,
    participantName: registration.participantName,
    schedule: program.schedule,
    location: program.location,
    fee: formatCents(program.feeCents),
    status: registration.status,
    message:
      program.feeCents > 0
        ? `${input.participantName} is registered for ${program.name}. The ${formatCents(program.feeCents)} fee is still outstanding — reference ${registration.confirmationRef}.`
        : `${input.participantName} is registered for ${program.name}. No fee is due.`,
  };
}

export async function listRegistrations(ctx: MunicipalContext, residentId?: string) {
  const target = residentId ?? requireOwnResident(ctx);
  if (target !== ctx.residentId && !isAdmin(ctx) && !ctx.scopes.includes(OAuthScopes.RECORDS_READ)) {
    throw new ScopeError(
      [OAuthScopes.RECORDS_READ],
      "Reading another household's registrations needs resident.records.read."
    );
  }
  const registrations = await prisma.programRegistration.findMany({
    where: { residentId: target },
    orderBy: { createdAt: "desc" },
    include: { program: true },
  });
  return {
    count: registrations.length,
    registrations: registrations.map((r) => ({
      confirmationRef: r.confirmationRef,
      program: r.program.name,
      season: r.program.season,
      participantName: r.participantName,
      participantAge: r.participantAge,
      schedule: r.program.schedule,
      location: r.program.location,
      fee: formatCents(r.feeCents),
      status: r.status,
      registeredAt: r.createdAt.toISOString(),
    })),
  };
}
