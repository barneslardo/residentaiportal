import { OAuthScopes, formatCents, type CitationContestInput } from "@resident/shared";
import { prisma } from "../lib/prisma.js";
import { ScopeError, canReachResident, isAdmin, type MunicipalContext } from "../lib/context.js";
import { requireOwnResident } from "./residents.js";

const STAFF_CITATIONS = [OAuthScopes.CODE_ENFORCEMENT, OAuthScopes.RECORDS_READ] as const;

function citationView(c: {
  id: string;
  citationNumber: string;
  plate: string | null;
  violationCode: string;
  description: string;
  location: string;
  issuedAt: Date;
  dueDate: Date;
  amountCents: number;
  paidCents: number;
  status: string;
  contestStatement: string | null;
  contestFiledAt: Date | null;
  contestOutcome: string | null;
}) {
  return {
    id: c.id,
    citationNumber: c.citationNumber,
    plate: c.plate,
    violationCode: c.violationCode,
    description: c.description,
    location: c.location,
    issuedAt: c.issuedAt.toISOString().slice(0, 10),
    dueDate: c.dueDate.toISOString().slice(0, 10),
    amount: formatCents(c.amountCents),
    paid: formatCents(c.paidCents),
    balance: formatCents(Math.max(c.amountCents - c.paidCents, 0)),
    balanceCents: Math.max(c.amountCents - c.paidCents, 0),
    status: c.status,
    contestFiledAt: c.contestFiledAt?.toISOString() ?? null,
    contestOutcome: c.contestOutcome,
    hasContestStatement: Boolean(c.contestStatement),
  };
}

export async function listCitations(
  ctx: MunicipalContext,
  input: { residentId?: string; status?: string; limit?: number } = {}
) {
  const residentId = input.residentId ?? requireOwnResident(ctx);
  if (!canReachResident(ctx, residentId, STAFF_CITATIONS)) {
    throw new ScopeError(
      [OAuthScopes.RECORDS_READ],
      "Those citations belong to another resident. Reading them needs city staff scopes."
    );
  }
  const citations = await prisma.citation.findMany({
    where: { residentId, ...(input.status ? { status: input.status } : {}) },
    orderBy: { issuedAt: "desc" },
    take: Math.min(input.limit ?? 25, 100),
  });
  const outstandingCents = citations.reduce(
    (sum, c) => sum + (c.status === "unpaid" ? Math.max(c.amountCents - c.paidCents, 0) : 0),
    0
  );
  return {
    count: citations.length,
    outstanding: formatCents(outstandingCents),
    outstandingCents,
    citations: citations.map(citationView),
  };
}

export async function getCitation(ctx: MunicipalContext, ref: string) {
  const citation = await prisma.citation.findFirst({
    where: { OR: [{ id: ref }, { citationNumber: ref }] },
  });
  if (!citation) throw new ScopeError([], `No citation matches ${ref}.`);
  if (!canReachResident(ctx, citation.residentId, STAFF_CITATIONS)) {
    throw new ScopeError([OAuthScopes.RECORDS_READ], "That citation was issued to someone else.");
  }
  return citationView(citation);
}

/**
 * File a contest. Deliberately requires the resident's own words — the assistant
 * may format and submit a statement, but the statement has to come from the
 * person, not be invented on their behalf.
 */
export async function contestCitation(ctx: MunicipalContext, input: CitationContestInput) {
  const citation = await prisma.citation.findFirst({
    where: { OR: [{ id: input.citationId }, { citationNumber: input.citationId }] },
  });
  if (!citation) throw new ScopeError([], `No citation matches ${input.citationId}.`);

  if (!isAdmin(ctx) && citation.residentId !== ctx.residentId) {
    throw new ScopeError(
      [OAuthScopes.CITATIONS_CONTEST],
      "You can only contest a citation issued to you."
    );
  }
  if (citation.status === "paid") {
    throw new ScopeError([], "That citation is already paid and can no longer be contested.");
  }
  if (citation.status === "contested") {
    throw new ScopeError([], `A contest for ${citation.citationNumber} is already on file.`);
  }
  if (citation.dueDate < new Date()) {
    throw new ScopeError(
      [],
      `The contest window for ${citation.citationNumber} closed on ${citation.dueDate
        .toISOString()
        .slice(0, 10)}. Contact the Clerk's office about a late hearing request.`
    );
  }

  const updated = await prisma.citation.update({
    where: { id: citation.id },
    data: {
      status: "contested",
      contestStatement: input.statement,
      contestFiledAt: new Date(),
    },
  });
  return {
    ...citationView(updated),
    message: `Contest filed for ${updated.citationNumber}. The hearing officer will respond by mail within 30 days; the balance is on hold until then.`,
  };
}

/** Staff view: outstanding citations across the city. */
export async function citationQueue(ctx: MunicipalContext, limit = 50) {
  if (!isAdmin(ctx) && !ctx.scopes.includes(OAuthScopes.CODE_ENFORCEMENT)) {
    throw new ScopeError(
      [OAuthScopes.CODE_ENFORCEMENT],
      "The citywide citation queue needs resident.code.enforcement."
    );
  }
  const citations = await prisma.citation.findMany({
    where: { status: { in: ["unpaid", "contested"] } },
    orderBy: { issuedAt: "asc" },
    take: Math.min(limit, 200),
    include: { resident: { select: { firstName: true, lastName: true, accountNumber: true } } },
  });
  return {
    count: citations.length,
    citations: citations.map((c) => ({
      ...citationView(c),
      resident: c.resident ? `${c.resident.firstName} ${c.resident.lastName}` : null,
      accountNumber: c.resident?.accountNumber ?? null,
      contestStatement: c.contestStatement,
    })),
  };
}
