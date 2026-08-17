import { OAuthScopes, formatCents, type BillingAdjustInput } from "@resident/shared";
import { prisma } from "../lib/prisma.js";
import { ScopeError, canReachResident, isAdmin, type MunicipalContext } from "../lib/context.js";

const STAFF_BILLING = [OAuthScopes.BILLING_READ] as const;

function statementView(s: {
  id: string;
  statementNumber: string;
  periodStart: Date;
  periodEnd: Date;
  dueDate: Date;
  waterGallons: number;
  waterCents: number;
  sewerCents: number;
  trashCents: number;
  stormwaterCents: number;
  lateFeeCents: number;
  adjustmentCents: number;
  amountCents: number;
  paidCents: number;
  status: string;
}) {
  const balanceCents = Math.max(s.amountCents - s.paidCents, 0);
  return {
    id: s.id,
    statementNumber: s.statementNumber,
    period: `${s.periodStart.toISOString().slice(0, 10)} → ${s.periodEnd.toISOString().slice(0, 10)}`,
    dueDate: s.dueDate.toISOString().slice(0, 10),
    status: s.status,
    waterGallons: s.waterGallons,
    lineItems: {
      water: formatCents(s.waterCents),
      sewer: formatCents(s.sewerCents),
      trash: formatCents(s.trashCents),
      stormwater: formatCents(s.stormwaterCents),
      lateFee: formatCents(s.lateFeeCents),
      adjustment: formatCents(s.adjustmentCents),
    },
    amount: formatCents(s.amountCents),
    paid: formatCents(s.paidCents),
    balance: formatCents(balanceCents),
    balanceCents,
    amountCents: s.amountCents,
  };
}

export async function getUtilityAccount(ctx: MunicipalContext, residentId: string) {
  if (!canReachResident(ctx, residentId, STAFF_BILLING)) {
    throw new ScopeError(
      [OAuthScopes.BILLING_READ],
      "Reading another household's utility account needs resident.billing.read (Utility Billing staff)."
    );
  }
  const accounts = await prisma.utilityAccount.findMany({
    where: { residentId },
    include: { statements: { orderBy: { periodEnd: "desc" }, take: 12 } },
  });
  if (!accounts.length) return { accounts: [], totalBalance: formatCents(0), totalBalanceCents: 0 };

  let totalBalanceCents = 0;
  const view = accounts.map((account) => {
    const statements = account.statements.map(statementView);
    const balanceCents = statements.reduce((sum, s) => sum + s.balanceCents, 0);
    totalBalanceCents += balanceCents;
    return {
      id: account.id,
      accountNumber: account.accountNumber,
      serviceAddress: account.serviceAddress,
      services: account.services,
      status: account.status,
      autopayEnabled: account.autopayEnabled,
      meterId: account.meterId,
      balance: formatCents(balanceCents),
      balanceCents,
      statements,
    };
  });

  return { accounts: view, totalBalance: formatCents(totalBalanceCents), totalBalanceCents };
}

export async function listStatements(
  ctx: MunicipalContext,
  residentId: string,
  opts: { limit?: number; unpaidOnly?: boolean } = {}
) {
  if (!canReachResident(ctx, residentId, STAFF_BILLING)) {
    throw new ScopeError([OAuthScopes.BILLING_READ], "That utility account is not yours to read.");
  }
  const statements = await prisma.utilityStatement.findMany({
    where: {
      utilityAccount: { residentId },
      ...(opts.unpaidOnly ? { status: { in: ["due", "overdue", "partial"] } } : {}),
    },
    orderBy: { periodEnd: "desc" },
    take: Math.min(opts.limit ?? 12, 60),
  });
  return { count: statements.length, statements: statements.map(statementView) };
}

export async function getTaxBills(ctx: MunicipalContext, residentId: string) {
  const allowed =
    isAdmin(ctx) ||
    ctx.scopes.includes(OAuthScopes.TAX_READ) ||
    (ctx.residentId === residentId && ctx.scopes.includes(OAuthScopes.BILLING_READ_SELF));
  if (!allowed) {
    throw new ScopeError(
      [OAuthScopes.TAX_READ, OAuthScopes.BILLING_READ_SELF],
      "Property-tax records need resident.tax.read (Treasurer) — or resident.billing.read.self for your own parcel."
    );
  }
  const bills = await prisma.taxBill.findMany({
    where: { residentId },
    orderBy: { taxYear: "desc" },
  });
  return {
    count: bills.length,
    bills: bills.map((b) => ({
      id: b.id,
      billNumber: b.billNumber,
      parcelId: b.parcelId,
      taxYear: b.taxYear,
      assessedValue: formatCents(b.assessedValueCents),
      amount: formatCents(b.amountCents),
      paid: formatCents(b.paidCents),
      balance: formatCents(Math.max(b.amountCents - b.paidCents, 0)),
      balanceCents: Math.max(b.amountCents - b.paidCents, 0),
      dueDate: b.dueDate.toISOString().slice(0, 10),
      status: b.status,
      exemptions: b.exemptions,
    })),
  };
}

export async function setAutopay(ctx: MunicipalContext, residentId: string, enabled: boolean) {
  if (!canReachResident(ctx, residentId, [OAuthScopes.BILLING_ADJUST])) {
    throw new ScopeError(
      [OAuthScopes.BILLING_ADJUST],
      "Changing autopay on another household's account needs resident.billing.adjust."
    );
  }
  const { count } = await prisma.utilityAccount.updateMany({
    where: { residentId },
    data: { autopayEnabled: enabled },
  });
  return { updated: count, autopayEnabled: enabled };
}

/** Utility Billing staff only: credit a statement and leave a paper trail. */
export async function adjustStatement(ctx: MunicipalContext, input: BillingAdjustInput) {
  if (!isAdmin(ctx) && !ctx.scopes.includes(OAuthScopes.BILLING_ADJUST)) {
    throw new ScopeError(
      [OAuthScopes.BILLING_ADJUST],
      "Applying a credit needs resident.billing.adjust, held by Utility Billing staff."
    );
  }
  const statement = await prisma.utilityStatement.findUnique({ where: { id: input.statementId } });
  if (!statement) throw new ScopeError([], "No statement matches that id.");

  const updated = await prisma.utilityStatement.update({
    where: { id: statement.id },
    data: {
      adjustmentCents: statement.adjustmentCents - input.amountCents,
      amountCents: Math.max(statement.amountCents - input.amountCents, 0),
    },
  });
  return {
    statementNumber: updated.statementNumber,
    creditApplied: formatCents(input.amountCents),
    newAmount: formatCents(updated.amountCents),
    reason: input.reason,
    appliedBy: ctx.actorEmail,
  };
}
