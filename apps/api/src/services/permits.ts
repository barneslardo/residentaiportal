import {
  OAuthScopes,
  PERMIT_FEES_CENTS,
  PERMIT_TYPE_LABELS,
  formatCents,
  formatReference,
  type PermitApplyInput,
  type PermitReviewInput,
  type PermitType,
} from "@resident/shared";
import { prisma } from "../lib/prisma.js";
import { ScopeError, canReachResident, isAdmin, type MunicipalContext } from "../lib/context.js";
import { requireOwnResident } from "./residents.js";

const STAFF_REVIEW = [OAuthScopes.PERMITS_REVIEW] as const;

type PermitRow = {
  id: string;
  permitNumber: string;
  type: string;
  status: string;
  address: string;
  description: string;
  contractorName: string | null;
  estimatedValueCents: number;
  feeCents: number;
  feePaid: boolean;
  submittedAt: Date;
  decidedAt: Date | null;
  decidedBy: string | null;
  decisionNote: string | null;
  conditions: string | null;
  issuedAt: Date | null;
  expiresAt: Date | null;
  inspections?: Array<{
    id: string;
    type: string;
    scheduledFor: Date;
    status: string;
    inspectorName: string | null;
    inspectorNotes: string | null;
    completedAt: Date | null;
  }>;
};

/**
 * Inspector notes are staff narrative, not resident-facing record — they are
 * redacted unless the caller holds permits.review or code.enforcement.
 */
function permitView(ctx: MunicipalContext, p: PermitRow) {
  const canSeeNotes =
    isAdmin(ctx) ||
    ctx.scopes.includes(OAuthScopes.PERMITS_REVIEW) ||
    ctx.scopes.includes(OAuthScopes.CODE_ENFORCEMENT);

  return {
    id: p.id,
    permitNumber: p.permitNumber,
    type: p.type,
    typeLabel: PERMIT_TYPE_LABELS[p.type as PermitType] ?? p.type,
    status: p.status,
    address: p.address,
    description: p.description,
    contractorName: p.contractorName,
    estimatedValue: formatCents(p.estimatedValueCents),
    fee: formatCents(p.feeCents),
    feeCents: p.feeCents,
    feePaid: p.feePaid,
    submittedAt: p.submittedAt.toISOString(),
    decidedAt: p.decidedAt?.toISOString() ?? null,
    decidedBy: p.decidedBy,
    decisionNote: p.decisionNote,
    conditions: p.conditions,
    issuedAt: p.issuedAt?.toISOString() ?? null,
    expiresAt: p.expiresAt?.toISOString().slice(0, 10) ?? null,
    ...(p.inspections
      ? {
          inspections: p.inspections.map((i) => ({
            id: i.id,
            type: i.type,
            scheduledFor: i.scheduledFor.toISOString().slice(0, 10),
            status: i.status,
            inspectorName: i.inspectorName,
            inspectorNotes: canSeeNotes ? i.inspectorNotes : undefined,
            notesRedacted: !canSeeNotes && Boolean(i.inspectorNotes),
            completedAt: i.completedAt?.toISOString() ?? null,
          })),
        }
      : {}),
  };
}

export async function applyForPermit(ctx: MunicipalContext, input: PermitApplyInput) {
  const residentId = requireOwnResident(ctx);
  const count = await prisma.permit.count();
  const feeCents = PERMIT_FEES_CENTS[input.type] ?? 5000;

  const permit = await prisma.permit.create({
    data: {
      permitNumber: formatReference("PM", count + 1),
      residentId,
      type: input.type,
      status: "submitted",
      address: input.address,
      description: input.description,
      contractorName: input.contractorName ?? null,
      estimatedValueCents: input.estimatedValueCents ?? 0,
      feeCents,
    },
  });

  return {
    ...permitView(ctx, permit),
    message:
      `Application ${permit.permitNumber} (${PERMIT_TYPE_LABELS[input.type]}) submitted. ` +
      `The ${formatCents(feeCents)} fee is due when the permit is issued; Building & Permits reviews new applications within 10 business days.`,
  };
}

export async function listPermits(
  ctx: MunicipalContext,
  input: { scope?: "mine" | "all"; status?: string; limit?: number } = {}
) {
  const wantsAll = input.scope === "all";
  const canSeeAll = isAdmin(ctx) || ctx.scopes.includes(OAuthScopes.PERMITS_REVIEW);
  if (wantsAll && !canSeeAll) {
    throw new ScopeError(
      [OAuthScopes.PERMITS_REVIEW],
      "Listing every permit application needs resident.permits.review (Building & Permits). You can list your own applications without it."
    );
  }

  const permits = await prisma.permit.findMany({
    where: {
      ...(wantsAll && canSeeAll ? {} : { residentId: requireOwnResident(ctx) }),
      ...(input.status ? { status: input.status } : {}),
    },
    orderBy: { submittedAt: "desc" },
    take: Math.min(input.limit ?? 25, 100),
    include: { inspections: true },
  });

  return {
    scope: wantsAll && canSeeAll ? "all" : "mine",
    count: permits.length,
    permits: permits.map((p) => permitView(ctx, p)),
  };
}

export async function getPermit(ctx: MunicipalContext, ref: string) {
  const permit = await prisma.permit.findFirst({
    where: { OR: [{ id: ref }, { permitNumber: ref }] },
    include: { inspections: { orderBy: { scheduledFor: "asc" } } },
  });
  if (!permit) throw new ScopeError([], `No permit matches ${ref}.`);
  if (!canReachResident(ctx, permit.residentId, STAFF_REVIEW)) {
    throw new ScopeError(
      [OAuthScopes.PERMITS_REVIEW],
      "That permit belongs to another property owner. Reading it needs resident.permits.review."
    );
  }
  return permitView(ctx, permit);
}

export async function reviewPermit(ctx: MunicipalContext, ref: string, input: PermitReviewInput) {
  if (!isAdmin(ctx) && !ctx.scopes.includes(OAuthScopes.PERMITS_REVIEW)) {
    throw new ScopeError(
      [OAuthScopes.PERMITS_REVIEW],
      "Approving, denying, or issuing a permit needs resident.permits.review — held by Building & Permits staff, not by applicants."
    );
  }
  const permit = await prisma.permit.findFirst({
    where: { OR: [{ id: ref }, { permitNumber: ref }] },
  });
  if (!permit) throw new ScopeError([], `No permit matches ${ref}.`);

  const statusByDecision: Record<PermitReviewInput["decision"], string> = {
    approve: "approved",
    deny: "denied",
    request_info: "needs_info",
    issue: "issued",
  };
  const status = statusByDecision[input.decision];
  const issuing = input.decision === "issue";

  const updated = await prisma.permit.update({
    where: { id: permit.id },
    data: {
      status,
      decidedAt: new Date(),
      decidedBy: ctx.actorEmail,
      decisionNote: input.note ?? null,
      conditions: input.conditions ?? permit.conditions,
      ...(issuing
        ? {
            issuedAt: new Date(),
            expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          }
        : {}),
    },
    include: { inspections: true },
  });
  return permitView(ctx, updated);
}

export async function scheduleInspection(
  ctx: MunicipalContext,
  input: { permitRef: string; type: string; scheduledFor: string; inspectorName?: string }
) {
  if (!isAdmin(ctx) && !ctx.scopes.includes(OAuthScopes.PERMITS_REVIEW)) {
    throw new ScopeError(
      [OAuthScopes.PERMITS_REVIEW],
      "Scheduling an inspection needs resident.permits.review (Building & Permits)."
    );
  }
  const permit = await prisma.permit.findFirst({
    where: { OR: [{ id: input.permitRef }, { permitNumber: input.permitRef }] },
  });
  if (!permit) throw new ScopeError([], `No permit matches ${input.permitRef}.`);

  const scheduledFor = new Date(input.scheduledFor);
  if (Number.isNaN(scheduledFor.getTime())) {
    throw new ScopeError([], "scheduledFor must be an ISO date such as 2026-09-14.");
  }

  const inspection = await prisma.inspection.create({
    data: {
      permitId: permit.id,
      type: input.type,
      scheduledFor,
      inspectorName: input.inspectorName ?? null,
    },
  });
  return {
    permitNumber: permit.permitNumber,
    inspectionId: inspection.id,
    type: inspection.type,
    scheduledFor: inspection.scheduledFor.toISOString().slice(0, 10),
    inspectorName: inspection.inspectorName,
    status: inspection.status,
  };
}
