import { randomBytes } from "node:crypto";
import { OAuthScopes, formatCents, type PaymentKind } from "@resident/shared";
import { config } from "../config.js";
import { prisma } from "../lib/prisma.js";
import { ScopeError, canReachResident, type MunicipalContext } from "../lib/context.js";

const INTENT_TTL_MS = 15 * 60 * 1000;

function newToken(prefix: string): string {
  return `${prefix}_${randomBytes(18).toString("base64url")}`;
}

function confirmationCode(): string {
  return `RB${randomBytes(4).toString("hex").toUpperCase()}`;
}

type Payable = {
  residentId: string;
  referenceId: string;
  referenceLabel: string;
  balanceCents: number;
};

/** Resolve what "pay statement X" actually refers to, and what is still owed. */
async function resolvePayable(kind: PaymentKind, referenceId: string): Promise<Payable> {
  if (kind === "utility") {
    const statement = await prisma.utilityStatement.findFirst({
      where: { OR: [{ id: referenceId }, { statementNumber: referenceId }] },
      include: { utilityAccount: true },
    });
    if (!statement) throw new ScopeError([], `No utility statement matches ${referenceId}.`);
    return {
      residentId: statement.utilityAccount.residentId,
      referenceId: statement.id,
      referenceLabel: `Utility statement ${statement.statementNumber}`,
      balanceCents: Math.max(statement.amountCents - statement.paidCents, 0),
    };
  }
  if (kind === "tax") {
    const bill = await prisma.taxBill.findFirst({
      where: { OR: [{ id: referenceId }, { billNumber: referenceId }] },
    });
    if (!bill) throw new ScopeError([], `No property-tax bill matches ${referenceId}.`);
    return {
      residentId: bill.residentId,
      referenceId: bill.id,
      referenceLabel: `Property tax ${bill.billNumber} (${bill.taxYear})`,
      balanceCents: Math.max(bill.amountCents - bill.paidCents, 0),
    };
  }
  if (kind === "citation") {
    const citation = await prisma.citation.findFirst({
      where: { OR: [{ id: referenceId }, { citationNumber: referenceId }] },
    });
    if (!citation) throw new ScopeError([], `No citation matches ${referenceId}.`);
    if (!citation.residentId) throw new ScopeError([], "That citation is not linked to a resident account.");
    return {
      residentId: citation.residentId,
      referenceId: citation.id,
      referenceLabel: `Citation ${citation.citationNumber} — ${citation.description}`,
      balanceCents: Math.max(citation.amountCents - citation.paidCents, 0),
    };
  }
  if (kind === "permit") {
    const permit = await prisma.permit.findFirst({
      where: { OR: [{ id: referenceId }, { permitNumber: referenceId }] },
    });
    if (!permit) throw new ScopeError([], `No permit matches ${referenceId}.`);
    return {
      residentId: permit.residentId,
      referenceId: permit.id,
      referenceLabel: `Permit fee ${permit.permitNumber}`,
      balanceCents: permit.feePaid ? 0 : permit.feeCents,
    };
  }

  const registration = await prisma.programRegistration.findFirst({
    where: { OR: [{ id: referenceId }, { confirmationRef: referenceId }] },
    include: { program: true },
  });
  if (!registration) throw new ScopeError([], `No program registration matches ${referenceId}.`);
  return {
    residentId: registration.residentId,
    referenceId: registration.id,
    referenceLabel: `Program fee — ${registration.program.name}`,
    balanceCents: registration.feeCents,
  };
}

function payScopesFor(kind: PaymentKind) {
  return kind === "citation"
    ? ([OAuthScopes.CITATIONS_PAY] as const)
    : ([OAuthScopes.BILLING_PAY] as const);
}

/**
 * Phase 1. Price the payment and mint a single-use token — no money moves.
 *
 * The assistant is allowed to reach this on its own; it is not allowed to reach
 * phase 2 without a token a human approved in the portal UI. Keeping the
 * approval outside the model's reach is the point: a delegated token proves who
 * asked, not that they meant to spend.
 */
export async function quotePayment(
  ctx: MunicipalContext,
  input: { kind: PaymentKind; referenceId: string; amountCents?: number }
) {
  const payable = await resolvePayable(input.kind, input.referenceId);

  if (!canReachResident(ctx, payable.residentId, [OAuthScopes.BILLING_ADJUST])) {
    throw new ScopeError(
      [OAuthScopes.BILLING_PAY],
      "That charge belongs to another household. You can only pay your own balances."
    );
  }
  const required = payScopesFor(input.kind);
  if (!ctx.scopes.includes(OAuthScopes.ADMIN) && !required.some((s) => ctx.scopes.includes(s))) {
    throw new ScopeError(
      [...required],
      `Submitting this payment needs ${required.join(" or ")}, which your session does not carry.`
    );
  }
  if (payable.balanceCents <= 0) {
    return {
      status: "nothing_due" as const,
      referenceLabel: payable.referenceLabel,
      message: `${payable.referenceLabel} has no outstanding balance.`,
    };
  }

  const amountCents = Math.min(input.amountCents ?? payable.balanceCents, payable.balanceCents);
  if (amountCents <= 0) throw new ScopeError([], "Payment amount must be greater than zero.");

  const intent = await prisma.paymentIntent.create({
    data: {
      token: newToken("pi"),
      residentId: payable.residentId,
      kind: input.kind,
      referenceId: payable.referenceId,
      referenceLabel: payable.referenceLabel,
      amountCents,
      createdBy: ctx.actorEmail,
      createdVia: ctx.channel,
      expiresAt: new Date(Date.now() + INTENT_TTL_MS),
    },
  });

  return {
    status: "awaiting_confirmation" as const,
    confirmationToken: intent.token,
    referenceLabel: payable.referenceLabel,
    amount: formatCents(amountCents),
    amountCents,
    balanceAfter: formatCents(payable.balanceCents - amountCents),
    expiresAt: intent.expiresAt.toISOString(),
    message:
      `Ready to pay ${formatCents(amountCents)} toward ${payable.referenceLabel}. ` +
      "Nothing has been charged yet — approve the payment in the portal to complete it.",
  };
}

/** Phase 1.5 — the human approves. Only ever reachable from an authenticated UI action. */
export async function approvePaymentIntent(ctx: MunicipalContext, token: string) {
  const intent = await prisma.paymentIntent.findUnique({ where: { token } });
  if (!intent) throw new ScopeError([], "That payment request no longer exists.");
  if (intent.consumedAt) throw new ScopeError([], "That payment was already completed.");
  if (intent.cancelledAt) throw new ScopeError([], "That payment request was cancelled.");
  if (intent.expiresAt < new Date()) throw new ScopeError([], "That payment request expired. Ask for a new quote.");
  if (ctx.residentId !== intent.residentId && !ctx.scopes.includes(OAuthScopes.ADMIN)) {
    throw new ScopeError([], "Only the account holder can approve this payment.");
  }

  const approved = await prisma.paymentIntent.update({
    where: { id: intent.id },
    data: { approvedAt: new Date(), approvedBy: ctx.actorEmail },
  });
  return {
    approved: true,
    confirmationToken: approved.token,
    referenceLabel: approved.referenceLabel,
    amount: formatCents(approved.amountCents),
  };
}

export async function cancelPaymentIntent(ctx: MunicipalContext, token: string) {
  const intent = await prisma.paymentIntent.findUnique({ where: { token } });
  if (!intent) throw new ScopeError([], "That payment request no longer exists.");
  if (ctx.residentId !== intent.residentId && !ctx.scopes.includes(OAuthScopes.ADMIN)) {
    throw new ScopeError([], "Only the account holder can cancel this payment.");
  }
  await prisma.paymentIntent.update({ where: { id: intent.id }, data: { cancelledAt: new Date() } });
  return { cancelled: true };
}

/** Phase 2. Settle an approved intent (simulated funds movement). */
export async function settlePayment(ctx: MunicipalContext, token: string) {
  const intent = await prisma.paymentIntent.findUnique({ where: { token } });
  if (!intent) throw new ScopeError([], "That confirmation token is not valid.");
  if (intent.consumedAt) throw new ScopeError([], "That payment was already completed.");
  if (intent.cancelledAt) throw new ScopeError([], "That payment request was cancelled.");
  if (intent.expiresAt < new Date()) throw new ScopeError([], "That payment request expired. Ask for a new quote.");

  if (config.paymentsRequireConfirmation && !intent.approvedAt) {
    throw new ScopeError(
      [],
      "This payment has not been approved yet. The account holder has to approve it in the portal before it can be charged — the assistant cannot approve on their behalf."
    );
  }
  if (!canReachResident(ctx, intent.residentId, [OAuthScopes.BILLING_ADJUST])) {
    throw new ScopeError([OAuthScopes.BILLING_PAY], "That payment belongs to another household.");
  }

  const payment = await prisma.$transaction(async (tx) => {
    await tx.paymentIntent.update({ where: { id: intent.id }, data: { consumedAt: new Date() } });

    if (intent.kind === "utility") {
      const statement = await tx.utilityStatement.findUnique({ where: { id: intent.referenceId } });
      if (statement) {
        const paidCents = statement.paidCents + intent.amountCents;
        await tx.utilityStatement.update({
          where: { id: statement.id },
          data: {
            paidCents,
            status: paidCents >= statement.amountCents ? "paid" : "partial",
            paidAt: paidCents >= statement.amountCents ? new Date() : null,
          },
        });
      }
    } else if (intent.kind === "tax") {
      const bill = await tx.taxBill.findUnique({ where: { id: intent.referenceId } });
      if (bill) {
        const paidCents = bill.paidCents + intent.amountCents;
        await tx.taxBill.update({
          where: { id: bill.id },
          data: { paidCents, status: paidCents >= bill.amountCents ? "paid" : "partial" },
        });
      }
    } else if (intent.kind === "citation") {
      const citation = await tx.citation.findUnique({ where: { id: intent.referenceId } });
      if (citation) {
        const paidCents = citation.paidCents + intent.amountCents;
        await tx.citation.update({
          where: { id: citation.id },
          data: { paidCents, status: paidCents >= citation.amountCents ? "paid" : citation.status },
        });
      }
    } else if (intent.kind === "permit") {
      await tx.permit.update({ where: { id: intent.referenceId }, data: { feePaid: true } });
    } else if (intent.kind === "program") {
      await tx.programRegistration.update({
        where: { id: intent.referenceId },
        data: { status: "paid" },
      });
    }

    return tx.payment.create({
      data: {
        confirmationCode: confirmationCode(),
        residentId: intent.residentId,
        kind: intent.kind,
        referenceId: intent.referenceId,
        referenceLabel: intent.referenceLabel,
        amountCents: intent.amountCents,
        initiatedBy: ctx.channel === "chat" || ctx.channel === "mcp" ? "agent" : "user",
        actorEmail: ctx.actorEmail,
      },
    });
  });

  return {
    status: "settled" as const,
    confirmationCode: payment.confirmationCode,
    referenceLabel: payment.referenceLabel,
    amount: formatCents(payment.amountCents),
    paidAt: payment.createdAt.toISOString(),
    approvedBy: intent.approvedBy,
  };
}

export async function listPayments(ctx: MunicipalContext, residentId: string, limit = 20) {
  if (!canReachResident(ctx, residentId, [OAuthScopes.BILLING_READ])) {
    throw new ScopeError([OAuthScopes.BILLING_READ], "That payment history is not yours to read.");
  }
  const payments = await prisma.payment.findMany({
    where: { residentId },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 100),
  });
  return {
    count: payments.length,
    payments: payments.map((p) => ({
      confirmationCode: p.confirmationCode,
      kind: p.kind,
      reference: p.referenceLabel,
      amount: formatCents(p.amountCents),
      status: p.status,
      initiatedBy: p.initiatedBy,
      paidAt: p.createdAt.toISOString(),
    })),
  };
}

/** Pending approvals for the signed-in resident — drives the UI confirm card. */
export async function listPendingIntents(ctx: MunicipalContext) {
  if (!ctx.residentId) return { intents: [] };
  const intents = await prisma.paymentIntent.findMany({
    where: {
      residentId: ctx.residentId,
      consumedAt: null,
      cancelledAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  return {
    intents: intents.map((i) => ({
      token: i.token,
      kind: i.kind,
      referenceLabel: i.referenceLabel,
      amount: formatCents(i.amountCents),
      amountCents: i.amountCents,
      createdVia: i.createdVia,
      approvedAt: i.approvedAt?.toISOString() ?? null,
      expiresAt: i.expiresAt.toISOString(),
    })),
  };
}
