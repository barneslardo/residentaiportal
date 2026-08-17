import {
  ASSISTANCE_PROGRAM_LABELS,
  OAuthScopes,
  formatCents,
  type AssistanceProgram,
} from "@resident/shared";
import { prisma } from "../lib/prisma.js";
import { ScopeError, isAdmin, type MunicipalContext } from "../lib/context.js";

/**
 * The two datasets in the portal that are *not* self-service.
 *
 * A resident cannot read their own caseworker notes or code-enforcement
 * narrative here, and neither can their agent: these are staff work product with
 * their own disclosure process. That asymmetry is deliberate — it is the
 * cleanest way to show that "the user is signed in" is not the same question as
 * "this data may be shown to the user's agent".
 */

export async function getAssistanceCases(
  ctx: MunicipalContext,
  input: { residentId?: string; status?: string; limit?: number } = {}
) {
  if (!isAdmin(ctx) && !ctx.scopes.includes(OAuthScopes.ASSISTANCE)) {
    throw new ScopeError(
      [OAuthScopes.ASSISTANCE],
      "Assistance case files carry household income and caseworker notes. Reading them needs resident.assistance, held by Social Services — not by residents or their assistants, even for their own case."
    );
  }
  const cases = await prisma.assistanceCase.findMany({
    where: {
      ...(input.residentId ? { residentId: input.residentId } : {}),
      ...(input.status ? { status: input.status } : {}),
    },
    orderBy: { openedAt: "desc" },
    take: Math.min(input.limit ?? 25, 100),
    include: { resident: { select: { firstName: true, lastName: true, accountNumber: true } } },
  });

  return {
    count: cases.length,
    cases: cases.map((c) => ({
      caseNumber: c.caseNumber,
      resident: `${c.resident.firstName} ${c.resident.lastName}`,
      accountNumber: c.resident.accountNumber,
      program: c.program,
      programLabel: ASSISTANCE_PROGRAM_LABELS[c.program as AssistanceProgram] ?? c.program,
      status: c.status,
      householdIncome: formatCents(c.householdIncomeCents),
      householdSize: c.householdSize,
      benefit: formatCents(c.benefitCents),
      caseworkerName: c.caseworkerName,
      caseworkerNotes: c.caseworkerNotes,
      openedAt: c.openedAt.toISOString().slice(0, 10),
      reviewDate: c.reviewDate?.toISOString().slice(0, 10) ?? null,
    })),
  };
}

/**
 * Eligibility screening a resident *can* run for themselves — no income figures
 * leave the building, only a yes/no and what to do next.
 */
export async function screenAssistanceEligibility(
  ctx: MunicipalContext,
  input: { householdSize: number; annualIncomeCents: number; program?: AssistanceProgram }
) {
  // 2026 demo thresholds: 60% of area median income, +$8,400 per extra person.
  const baseThresholdCents = 4_920_000;
  const perPersonCents = 840_000;
  const thresholdCents = baseThresholdCents + Math.max(input.householdSize - 1, 0) * perPersonCents;
  const eligible = input.annualIncomeCents <= thresholdCents;

  return {
    program: input.program ?? "utility_assistance",
    programLabel: ASSISTANCE_PROGRAM_LABELS[input.program ?? "utility_assistance"],
    householdSize: input.householdSize,
    incomeThreshold: formatCents(thresholdCents),
    likelyEligible: eligible,
    message: eligible
      ? "Based on the numbers you gave me, this household likely qualifies. Social Services confirms eligibility with documentation — call (555) 010-4400 or stop by City Hall, Room 210."
      : "Based on the numbers you gave me, this household is above the income threshold for that program. The senior utility discount and payment plans have different criteria and may still apply.",
    disclaimer:
      "This is an unofficial screening based only on what you told me. It does not create or change a case file.",
  };
}

export async function getCodeCases(
  ctx: MunicipalContext,
  input: { residentId?: string; address?: string; status?: string; limit?: number } = {}
) {
  if (!isAdmin(ctx) && !ctx.scopes.includes(OAuthScopes.CODE_ENFORCEMENT)) {
    throw new ScopeError(
      [OAuthScopes.CODE_ENFORCEMENT],
      "Code-enforcement case files include inspector narrative and pending hearing detail. Reading them needs resident.code.enforcement (Code Enforcement staff)."
    );
  }
  const cases = await prisma.codeCase.findMany({
    where: {
      ...(input.residentId ? { residentId: input.residentId } : {}),
      ...(input.address ? { address: { contains: input.address, mode: "insensitive" } } : {}),
      ...(input.status ? { status: input.status } : {}),
    },
    orderBy: { openedAt: "desc" },
    take: Math.min(input.limit ?? 25, 100),
  });

  return {
    count: cases.length,
    cases: cases.map((c) => ({
      caseNumber: c.caseNumber,
      address: c.address,
      violationType: c.violationType,
      description: c.description,
      status: c.status,
      openedAt: c.openedAt.toISOString().slice(0, 10),
      inspectorName: c.inspectorName,
      inspectorNotes: c.inspectorNotes,
      hearingDate: c.hearingDate?.toISOString().slice(0, 10) ?? null,
      fine: formatCents(c.fineCents),
    })),
  };
}

/** What a resident is allowed to know about a case on their own property. */
export async function getOwnCodeCaseSummary(ctx: MunicipalContext) {
  if (!ctx.residentId) return { count: 0, cases: [] };
  const cases = await prisma.codeCase.findMany({
    where: { residentId: ctx.residentId },
    orderBy: { openedAt: "desc" },
    take: 20,
  });
  return {
    count: cases.length,
    cases: cases.map((c) => ({
      caseNumber: c.caseNumber,
      address: c.address,
      violationType: c.violationType,
      status: c.status,
      openedAt: c.openedAt.toISOString().slice(0, 10),
      hearingDate: c.hearingDate?.toISOString().slice(0, 10) ?? null,
      fine: formatCents(c.fineCents),
      note: "Inspector notes are not released through the portal. Request the full file from the Clerk's office.",
    })),
  };
}
