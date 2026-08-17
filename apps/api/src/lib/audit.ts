import type { MunicipalContext } from "./context.js";
import { prisma } from "./prisma.js";

export type AuditInput = {
  tool: string;
  allowed: boolean;
  denyReason?: string;
  requiredScopes?: string[];
  resourceType?: string;
  resourceId?: string;
  summary?: string;
};

/**
 * Record one tool decision.
 *
 * Denials are logged as loudly as successes — a demo that only shows what the
 * agent *did* misses the more interesting half, which is what Okta stopped it
 * from doing and why.
 */
export async function recordAudit(ctx: MunicipalContext, input: AuditInput): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        requestId: ctx.requestId ?? null,
        actorEmail: ctx.actorEmail,
        actorPersona: ctx.personaLabel ?? ctx.personaId ?? null,
        channel: ctx.channel,
        tool: input.tool,
        resourceType: input.resourceType ?? null,
        resourceId: input.resourceId ?? null,
        allowed: input.allowed,
        denyReason: input.denyReason ?? null,
        requiredScopes: input.requiredScopes ?? [],
        presentedScopes: ctx.scopes,
        delegationMode: ctx.delegation.mode,
        delegationJti: ctx.delegation.jti ?? null,
        delegationAud: ctx.delegation.aud ?? null,
        summary: input.summary ?? null,
      },
    });
  } catch (err) {
    // Never let an audit write failure take down the tool call it describes.
    console.error("[audit] write failed:", err instanceof Error ? err.message : err);
  }
}

export async function listAuditEvents(opts: {
  limit?: number;
  actorEmail?: string;
  allowed?: boolean;
  tool?: string;
}) {
  return prisma.auditEvent.findMany({
    where: {
      ...(opts.actorEmail ? { actorEmail: opts.actorEmail } : {}),
      ...(typeof opts.allowed === "boolean" ? { allowed: opts.allowed } : {}),
      ...(opts.tool ? { tool: opts.tool } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(opts.limit ?? 100, 500),
  });
}
