import {
  OAuthScopes,
  REQUEST_CATEGORY_LABELS,
  REQUEST_SLA_DAYS,
  formatReference,
  type RequestCategory,
  type ServiceRequestCreateInput,
  type ServiceRequestUpdateInput,
} from "@resident/shared";
import { prisma } from "../lib/prisma.js";
import { ScopeError, canReachResident, isAdmin, type MunicipalContext } from "../lib/context.js";

const STAFF_MANAGE = [OAuthScopes.REQUESTS_MANAGE] as const;

function businessDaysFromNow(days: number): Date {
  const date = new Date();
  let remaining = days;
  while (remaining > 0) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return date;
}

function requestView(r: {
  id: string;
  requestNumber: string;
  category: string;
  description: string;
  address: string;
  crossStreet: string | null;
  status: string;
  priority: string;
  assignedCrew: string | null;
  openedAt: Date;
  dueBy: Date | null;
  closedAt: Date | null;
  closureNote: string | null;
  updates?: Array<{ note: string; author: string; createdAt: Date; statusTo: string | null }>;
}) {
  return {
    id: r.id,
    requestNumber: r.requestNumber,
    category: r.category,
    categoryLabel: REQUEST_CATEGORY_LABELS[r.category as RequestCategory] ?? r.category,
    description: r.description,
    address: r.address,
    crossStreet: r.crossStreet,
    status: r.status,
    priority: r.priority,
    assignedCrew: r.assignedCrew,
    openedAt: r.openedAt.toISOString(),
    dueBy: r.dueBy?.toISOString().slice(0, 10) ?? null,
    closedAt: r.closedAt?.toISOString() ?? null,
    closureNote: r.closureNote,
    ...(r.updates
      ? {
          updates: r.updates.map((u) => ({
            note: u.note,
            author: u.author,
            status: u.statusTo,
            at: u.createdAt.toISOString(),
          })),
        }
      : {}),
  };
}

export async function createServiceRequest(
  ctx: MunicipalContext,
  input: ServiceRequestCreateInput
) {
  const count = await prisma.serviceRequest.count();
  const slaDays = REQUEST_SLA_DAYS[input.category] ?? 10;

  const created = await prisma.serviceRequest.create({
    data: {
      requestNumber: formatReference("SR", count + 1),
      residentId: ctx.residentId,
      reportedBy: ctx.actorEmail,
      category: input.category,
      description: input.description,
      address: input.address,
      crossStreet: input.crossStreet ?? null,
      priority: input.priority ?? (input.category === "water_main_break" ? "emergency" : "normal"),
      contactPhone: input.contactPhone ?? null,
      dueBy: businessDaysFromNow(slaDays),
      updates: {
        create: {
          note: `Reported via ${ctx.channel === "chat" ? "the Riverbend Assistant" : "the resident portal"}.`,
          author: ctx.actorEmail,
          statusTo: "open",
        },
      },
    },
  });

  return {
    ...requestView(created),
    slaBusinessDays: slaDays,
    message: `Service request ${created.requestNumber} opened. Target response is ${slaDays} business day(s).`,
  };
}

export async function listServiceRequests(
  ctx: MunicipalContext,
  input: { scope?: "mine" | "all"; status?: string; category?: string; limit?: number } = {}
) {
  const wantsAll = input.scope === "all";
  const canSeeAll = isAdmin(ctx) || ctx.scopes.includes(OAuthScopes.REQUESTS_MANAGE);

  if (wantsAll && !canSeeAll) {
    throw new ScopeError(
      [OAuthScopes.REQUESTS_MANAGE],
      "Listing the whole 311 queue needs resident.requests.manage (Public Works or Code Enforcement). You can still list the requests you reported."
    );
  }

  const where = {
    ...(wantsAll && canSeeAll
      ? {}
      : ctx.residentId
        ? { OR: [{ residentId: ctx.residentId }, { reportedBy: ctx.actorEmail }] }
        : { reportedBy: ctx.actorEmail }),
    ...(input.status ? { status: input.status } : {}),
    ...(input.category ? { category: input.category } : {}),
  };

  const requests = await prisma.serviceRequest.findMany({
    where,
    orderBy: [{ status: "asc" }, { openedAt: "desc" }],
    take: Math.min(input.limit ?? 25, 100),
  });
  return {
    scope: wantsAll && canSeeAll ? "all" : "mine",
    count: requests.length,
    requests: requests.map((r) => requestView(r)),
  };
}

export async function getServiceRequest(ctx: MunicipalContext, ref: string) {
  const request = await prisma.serviceRequest.findFirst({
    where: { OR: [{ id: ref }, { requestNumber: ref }] },
    include: { updates: { orderBy: { createdAt: "asc" } } },
  });
  if (!request) throw new ScopeError([], `No service request matches ${ref}.`);

  const isOwn =
    (request.residentId && request.residentId === ctx.residentId) ||
    request.reportedBy === ctx.actorEmail;
  if (!isOwn && !canReachResident(ctx, request.residentId, STAFF_MANAGE)) {
    throw new ScopeError(
      [OAuthScopes.REQUESTS_MANAGE],
      "That request was reported by someone else. Reading it needs resident.requests.manage."
    );
  }
  return requestView(request);
}

/** Public Works / Code Enforcement: triage, assign, close. */
export async function updateServiceRequest(
  ctx: MunicipalContext,
  ref: string,
  input: ServiceRequestUpdateInput
) {
  if (!isAdmin(ctx) && !ctx.scopes.includes(OAuthScopes.REQUESTS_MANAGE)) {
    throw new ScopeError(
      [OAuthScopes.REQUESTS_MANAGE],
      "Updating a 311 request needs resident.requests.manage, held by Public Works dispatch and Code Enforcement."
    );
  }
  const request = await prisma.serviceRequest.findFirst({
    where: { OR: [{ id: ref }, { requestNumber: ref }] },
  });
  if (!request) throw new ScopeError([], `No service request matches ${ref}.`);

  const closing = input.status === "closed" && request.status !== "closed";
  const updated = await prisma.serviceRequest.update({
    where: { id: request.id },
    data: {
      ...(input.status ? { status: input.status } : {}),
      ...(input.priority ? { priority: input.priority } : {}),
      ...(input.assignedCrew !== undefined ? { assignedCrew: input.assignedCrew } : {}),
      ...(closing ? { closedAt: new Date(), closureNote: input.note ?? null } : {}),
      updates: {
        create: {
          note: input.note ?? `Status changed to ${input.status ?? request.status}.`,
          author: ctx.actorEmail,
          statusFrom: request.status,
          statusTo: input.status ?? request.status,
        },
      },
    },
    include: { updates: { orderBy: { createdAt: "asc" } } },
  });
  return requestView(updated);
}

/** Queue rollup for the Public Works dashboard. */
export async function serviceRequestStats(ctx: MunicipalContext) {
  if (!isAdmin(ctx) && !ctx.scopes.includes(OAuthScopes.REQUESTS_MANAGE)) {
    throw new ScopeError(
      [OAuthScopes.REQUESTS_MANAGE],
      "The 311 queue summary needs resident.requests.manage."
    );
  }
  const [byStatus, byCategory, overdue] = await Promise.all([
    prisma.serviceRequest.groupBy({ by: ["status"], _count: true }),
    prisma.serviceRequest.groupBy({ by: ["category"], _count: true }),
    prisma.serviceRequest.count({
      where: { status: { notIn: ["closed", "duplicate"] }, dueBy: { lt: new Date() } },
    }),
  ]);
  return {
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count])),
    byCategory: Object.fromEntries(byCategory.map((r) => [r.category, r._count])),
    overdue,
  };
}
