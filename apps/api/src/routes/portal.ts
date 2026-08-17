import { Router } from "express";
import {
  ContactUpdateSchema,
  PermitApplySchema,
  ProgramRegisterSchema,
  ServiceRequestCreateSchema,
  ServiceRequestUpdateSchema,
} from "@resident/shared";
import { AppError } from "../lib/errors.js";
import { ScopeError } from "../lib/context.js";
import { buildContext, requireSession } from "../middleware/auth.js";
import { getResidentProfile, lookupResidents, resolveResidentId, updateOwnContactInfo } from "../services/residents.js";
import { getTaxBills, getUtilityAccount, listStatements } from "../services/billing.js";
import {
  approvePaymentIntent,
  cancelPaymentIntent,
  listPayments,
  listPendingIntents,
  quotePayment,
  settlePayment,
} from "../services/payments.js";
import {
  createServiceRequest,
  getServiceRequest,
  listServiceRequests,
  serviceRequestStats,
  updateServiceRequest,
} from "../services/requests.js";
import { applyForPermit, getPermit, listPermits, reviewPermit } from "../services/permits.js";
import { contestCitation, citationQueue, listCitations } from "../services/citations.js";
import { listRegistrations, registerForProgram, searchPrograms } from "../services/programs.js";
import { getAssistanceCases, getCodeCases, getOwnCodeCaseSummary } from "../services/sensitive.js";
import { listAuditEvents } from "../lib/audit.js";

export const portalRouter = Router();

portalRouter.use(requireSession);

/** ScopeError is an authorization outcome, not a crash — map it to 403. */
function wrap(handler: (req: import("express").Request) => Promise<unknown>) {
  return async (
    req: import("express").Request,
    res: import("express").Response,
    next: import("express").NextFunction
  ) => {
    try {
      res.json({ data: await handler(req) });
    } catch (err) {
      if (err instanceof ScopeError) {
        return next(new AppError(403, "INSUFFICIENT_SCOPE", err.message, { requiredScopes: err.required }));
      }
      next(err);
    }
  };
}

// ── Overview ────────────────────────────────────────────────────────────────

portalRouter.get(
  "/overview",
  wrap(async (req) => {
    const ctx = await buildContext(req, "ui");
    if (!ctx.residentId) {
      return { kind: "staff" as const, persona: ctx.personaLabel, scopes: ctx.scopes };
    }
    const [profile, utility, requests, permits, citations, registrations, intents, codeCases] =
      await Promise.all([
        getResidentProfile(ctx, ctx.residentId),
        getUtilityAccount(ctx, ctx.residentId).catch(() => null),
        listServiceRequests(ctx, { limit: 5 }).catch(() => null),
        listPermits(ctx, { limit: 5 }).catch(() => null),
        listCitations(ctx, { limit: 5 }).catch(() => null),
        listRegistrations(ctx).catch(() => null),
        listPendingIntents(ctx),
        getOwnCodeCaseSummary(ctx).catch(() => null),
      ]);
    return {
      kind: "resident" as const,
      profile,
      utility,
      requests,
      permits,
      citations,
      registrations,
      pendingPayments: intents.intents,
      codeCases,
    };
  })
);

// ── Household ───────────────────────────────────────────────────────────────

portalRouter.get(
  "/me/profile",
  wrap(async (req) => {
    const ctx = await buildContext(req, "ui");
    return getResidentProfile(ctx, await resolveResidentId(ctx));
  })
);

portalRouter.patch(
  "/me/profile",
  wrap(async (req) => {
    const ctx = await buildContext(req, "ui");
    return updateOwnContactInfo(ctx, ContactUpdateSchema.parse(req.body));
  })
);

// ── Billing & payments ──────────────────────────────────────────────────────

portalRouter.get(
  "/billing/utility",
  wrap(async (req) => {
    const ctx = await buildContext(req, "ui");
    return getUtilityAccount(ctx, await resolveResidentId(ctx, { accountNumber: req.query.accountNumber as string }));
  })
);

portalRouter.get(
  "/billing/statements",
  wrap(async (req) => {
    const ctx = await buildContext(req, "ui");
    return listStatements(ctx, await resolveResidentId(ctx), {
      unpaidOnly: req.query.unpaidOnly === "true",
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
  })
);

portalRouter.get(
  "/billing/tax",
  wrap(async (req) => {
    const ctx = await buildContext(req, "ui");
    return getTaxBills(ctx, await resolveResidentId(ctx));
  })
);

portalRouter.get(
  "/payments",
  wrap(async (req) => {
    const ctx = await buildContext(req, "ui");
    return listPayments(ctx, await resolveResidentId(ctx));
  })
);

portalRouter.get(
  "/payments/pending",
  wrap(async (req) => listPendingIntents(await buildContext(req, "ui")))
);

portalRouter.post(
  "/payments/quote",
  wrap(async (req) => {
    const ctx = await buildContext(req, "ui");
    return quotePayment(ctx, {
      kind: req.body?.kind,
      referenceId: String(req.body?.referenceId ?? ""),
      amountCents: req.body?.amountCents,
    });
  })
);

/** The human approval step. Deliberately session-only — no bearer path. */
portalRouter.post(
  "/payments/approve",
  wrap(async (req) => {
    const ctx = await buildContext(req, "ui");
    const approved = await approvePaymentIntent(ctx, String(req.body?.confirmationToken ?? ""));
    // Approving from the portal settles immediately; the agent path stops at approval.
    const settled = await settlePayment(ctx, approved.confirmationToken);
    return { ...approved, ...settled };
  })
);

portalRouter.post(
  "/payments/cancel",
  wrap(async (req) => {
    const ctx = await buildContext(req, "ui");
    return cancelPaymentIntent(ctx, String(req.body?.confirmationToken ?? ""));
  })
);

// ── 311 ─────────────────────────────────────────────────────────────────────

portalRouter.get(
  "/requests",
  wrap(async (req) => {
    const ctx = await buildContext(req, "ui");
    return listServiceRequests(ctx, {
      scope: req.query.scope === "all" ? "all" : "mine",
      status: req.query.status as string | undefined,
      category: req.query.category as string | undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
  })
);

portalRouter.get(
  "/requests/stats",
  wrap(async (req) => serviceRequestStats(await buildContext(req, "ui")))
);

portalRouter.get(
  "/requests/:ref",
  wrap(async (req) => getServiceRequest(await buildContext(req, "ui"), req.params.ref))
);

portalRouter.post(
  "/requests",
  wrap(async (req) =>
    createServiceRequest(await buildContext(req, "ui"), ServiceRequestCreateSchema.parse(req.body))
  )
);

portalRouter.patch(
  "/requests/:ref",
  wrap(async (req) =>
    updateServiceRequest(
      await buildContext(req, "ui"),
      req.params.ref,
      ServiceRequestUpdateSchema.parse(req.body)
    )
  )
);

// ── Permits ─────────────────────────────────────────────────────────────────

portalRouter.get(
  "/permits",
  wrap(async (req) => {
    const ctx = await buildContext(req, "ui");
    return listPermits(ctx, {
      scope: req.query.scope === "all" ? "all" : "mine",
      status: req.query.status as string | undefined,
    });
  })
);

portalRouter.get(
  "/permits/:ref",
  wrap(async (req) => getPermit(await buildContext(req, "ui"), req.params.ref))
);

portalRouter.post(
  "/permits",
  wrap(async (req) => applyForPermit(await buildContext(req, "ui"), PermitApplySchema.parse(req.body)))
);

portalRouter.post(
  "/permits/:ref/review",
  wrap(async (req) =>
    reviewPermit(await buildContext(req, "ui"), req.params.ref, {
      decision: req.body?.decision,
      note: req.body?.note,
      conditions: req.body?.conditions,
    })
  )
);

// ── Citations ───────────────────────────────────────────────────────────────

portalRouter.get(
  "/citations",
  wrap(async (req) => listCitations(await buildContext(req, "ui"), { status: req.query.status as string }))
);

portalRouter.get(
  "/citations/queue",
  wrap(async (req) => citationQueue(await buildContext(req, "ui")))
);

portalRouter.post(
  "/citations/contest",
  wrap(async (req) =>
    contestCitation(await buildContext(req, "ui"), {
      citationId: String(req.body?.citationId ?? ""),
      statement: String(req.body?.statement ?? ""),
    })
  )
);

// ── Programs ────────────────────────────────────────────────────────────────

portalRouter.get(
  "/programs",
  wrap(async (req) =>
    searchPrograms({
      query: req.query.query as string | undefined,
      category: req.query.category as string | undefined,
      age: req.query.age ? Number(req.query.age) : undefined,
      openOnly: req.query.openOnly === "true",
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    })
  )
);

portalRouter.get(
  "/programs/registrations",
  wrap(async (req) => listRegistrations(await buildContext(req, "ui")))
);

portalRouter.post(
  "/programs/register",
  wrap(async (req) =>
    registerForProgram(await buildContext(req, "ui"), ProgramRegisterSchema.parse(req.body))
  )
);

// ── Staff surfaces ──────────────────────────────────────────────────────────

portalRouter.get(
  "/staff/residents",
  wrap(async (req) =>
    lookupResidents(await buildContext(req, "ui"), {
      query: req.query.query as string | undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    })
  )
);

portalRouter.get(
  "/staff/code-cases",
  wrap(async (req) =>
    getCodeCases(await buildContext(req, "ui"), {
      address: req.query.address as string | undefined,
      status: req.query.status as string | undefined,
    })
  )
);

portalRouter.get(
  "/staff/assistance-cases",
  wrap(async (req) =>
    getAssistanceCases(await buildContext(req, "ui"), { status: req.query.status as string | undefined })
  )
);

// ── Audit (City Administrator) ──────────────────────────────────────────────

portalRouter.get(
  "/audit",
  wrap(async (req) => {
    const ctx = await buildContext(req, "ui");
    if (ctx.role !== "admin") {
      throw new ScopeError([], "The agent audit log is restricted to the City Administrator.");
    }
    const events = await listAuditEvents({
      limit: req.query.limit ? Number(req.query.limit) : 100,
      actorEmail: req.query.actorEmail as string | undefined,
      allowed: req.query.deniedOnly === "true" ? false : undefined,
      tool: req.query.tool as string | undefined,
    });
    return {
      count: events.length,
      events: events.map((e) => ({
        id: e.id,
        at: e.createdAt.toISOString(),
        actor: e.actorEmail,
        persona: e.actorPersona,
        channel: e.channel,
        tool: e.tool,
        allowed: e.allowed,
        denyReason: e.denyReason,
        requiredScopes: e.requiredScopes,
        presentedScopes: e.presentedScopes,
        delegationMode: e.delegationMode,
        delegationJti: e.delegationJti,
        summary: e.summary,
      })),
    };
  })
);
