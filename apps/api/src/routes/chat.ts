import { Router } from "express";
import {
  ASSISTANT_NAME,
  CITY_NAME,
  SCOPE_DESCRIPTIONS,
  capDelegatedScopes,
  resolveSessionEntitledScopes,
} from "@resident/shared";
import { agentDisabledReason, config } from "../config.js";
import { AppError } from "../lib/errors.js";
import { getDelegatedAccessToken, isAgentExchangeEnabled } from "../lib/agent-token-exchange.js";
import { ensureFreshIdToken } from "../lib/session-id-token.js";
import { listAvailableChatModels, runChatCompletion } from "../lib/llm-proxy.js";
import { blockedToolsForScopes, runTool, toolsForScopes } from "../tools/registry.js";
import type { MunicipalContext } from "../lib/context.js";
import { requireSession } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

export const chatRouter = Router();

chatRouter.get("/models", (_req, res) => {
  res.json({ data: listAvailableChatModels() });
});

function buildSystemPrompt(ctx: MunicipalContext, allowedTools: string[], blocked: string[]): string {
  const scopeLines = ctx.scopes.map(
    (s) => `  - ${s}: ${SCOPE_DESCRIPTIONS[s as keyof typeof SCOPE_DESCRIPTIONS] ?? s}`
  );

  return [
    `You are the ${ASSISTANT_NAME}, the AI assistant embedded in the ${CITY_NAME} resident portal.`,
    `You are helping ${ctx.actorName} (${ctx.actorEmail}), signed in as: ${ctx.personaLabel ?? "Resident"}.`,
    "",
    "HOW YOUR AUTHORITY WORKS",
    "Every tool call you make is authorized by a delegated OAuth token that Okta issued for this",
    "specific person via Cross App Access (ID-JAG). You hold no standing credentials of your own and",
    "cannot widen your own access. The token expires with their session.",
    "",
    "Scopes on this session's delegated token:",
    ...(scopeLines.length ? scopeLines : ["  (none — every tool will be refused)"]),
    "",
    `Tools you can call: ${allowedTools.join(", ") || "(none)"}`,
    blocked.length
      ? `Tools withheld for this session: ${blocked.join(", ")}. They exist, but this operator's Okta groups do not authorize them.`
      : "",
    "",
    "RULES",
    "1. Use tools for every fact about accounts, bills, permits, requests, citations, and programs.",
    "   Never invent an amount, a date, a case number, or a status.",
    "2. If a tool returns error=insufficient_scope, relay its userMessage to the person. Keep the scope",
    "   name and the department that holds it. Do not apologise at length, do not retry, and never try",
    "   another tool to get the same data by a side route.",
    "3. Money: call quote_payment first and show the amount and what it pays. quote_payment never moves",
    "   money — it returns a confirmation token the person must approve in the portal. Only call",
    "   settle_payment after they tell you they approved it. Never imply a payment is done until",
    "   settle_payment returns a confirmation code.",
    "4. To contest a citation you need the resident's own account of what happened. Ask for it in their",
    "   words. Do not draft facts you were not told.",
    "5. Emergencies (gas smell, active water main break, downed power line, anyone in danger) are not a",
    "   portal task: tell them to call 911, or Public Works dispatch at (555) 010-3111 after hours.",
    "6. Be brief and concrete. Quote reference numbers (SR-, PM-, RB-) so the person can follow up.",
    "7. You may not change anyone's Okta group, scope, or role, and you cannot approve payments on the",
    "   person's behalf. If asked, say so plainly.",
  ]
    .filter(Boolean)
    .join("\n");
}

chatRouter.post("/", requireSession, async (req, res, next) => {
  const started = Date.now();
  try {
    if (!listAvailableChatModels().length) {
      throw new AppError(
        503,
        "LLM_DISABLED",
        "No model is configured. Set GROK_API_KEY (or OPENAI_API_KEY / ANTHROPIC_API_KEY) in .env and restart."
      );
    }
    if (!isAgentExchangeEnabled()) {
      throw new AppError(
        503,
        "AGENT_NOT_CONFIGURED",
        `The assistant runs on delegated Okta tokens and is not configured yet: ${agentDisabledReason()}`
      );
    }

    const user = req.user!;
    const { messages = [], model, provider } = req.body ?? {};

    const idToken = await ensureFreshIdToken(req);
    const entitled = resolveSessionEntitledScopes(user.groups ?? [], user.scopes ?? []);

    let delegated;
    try {
      delegated = await getDelegatedAccessToken(idToken, entitled.join(" "));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("JWKSet") || msg.includes("kid")) {
        throw new AppError(
          502,
          "AGENT_JWK_MISMATCH",
          "Okta rejected the agent's client assertion. Register the public JWK from secrets/agent-private-key.json on the AI agent registration."
        );
      }
      if (msg.includes("Policy evaluation failed")) {
        throw new AppError(
          502,
          "DELEGATION_POLICY_DENIED",
          "Okta denied the delegated token for your group. Check the municipal authorization server's jwt-bearer rule (scripts/setup_okta.py)."
        );
      }
      if (msg.includes("subject_token")) {
        throw new AppError(
          401,
          "ID_TOKEN_EXPIRED",
          "Your Okta sign-in is no longer valid for delegation. Sign out and sign in again."
        );
      }
      throw new AppError(502, "DELEGATION_FAILED", msg);
    }

    const effectiveScopes = capDelegatedScopes(delegated.grantedScopes, entitled);
    if (effectiveScopes.length !== delegated.grantedScopes.length) {
      console.log(
        `[chat] capped scopes user=${user.email} okta=${delegated.grantedScopes.length} effective=${effectiveScopes.length}`
      );
    }

    const ctx: MunicipalContext = {
      actorEmail: user.email,
      actorName: user.displayName,
      role: user.role,
      personaId: user.personaId,
      personaLabel: user.persona,
      scopes: effectiveScopes,
      residentId: user.residentId ?? null,
      channel: "chat",
      requestId: req.headers["x-request-id"] as string | undefined,
      delegation: {
        mode: "id-jag",
        issuedScopes: delegated.grantedScopes,
        jti: delegated.idJagJti,
        aud: delegated.idJagAud,
        expiresIn: delegated.expiresIn,
      },
    };

    const allowed = toolsForScopes(effectiveScopes);
    const blocked = blockedToolsForScopes(effectiveScopes);

    const result = await runChatCompletion({
      systemPrompt: buildSystemPrompt(
        ctx,
        allowed.map((t) => t.name),
        blocked.map((t) => t.name)
      ),
      messages,
      model,
      provider,
      tools: allowed,
      runTool: async (name, input) => {
        const outcome = await runTool(name, input, ctx);
        return {
          result: outcome.result,
          allowed: outcome.allowed,
          requiredScopes: outcome.requiredScopes,
          durationMs: outcome.durationMs,
        };
      },
    });

    console.log(
      `[chat] ok user=${user.email} persona=${user.persona} provider=${result.provider} tools=${result.toolTrace.length} ms=${Date.now() - started}`
    );

    res.json({
      data: {
        content: result.content,
        provider: result.provider,
        model: result.model,
        toolTrace: result.toolTrace,
        delegation: {
          mode: "id-jag",
          issuedScopes: delegated.grantedScopes,
          effectiveScopes,
          cappedBy: effectiveScopes.length !== delegated.grantedScopes.length ? "persona" : null,
          expiresIn: delegated.expiresIn,
          idJagJti: delegated.idJagJti,
          audience: delegated.idJagAud,
        },
      },
    });
  } catch (err) {
    console.error(`[chat] error user=${req.user?.email} ms=${Date.now() - started}`, err);
    if (err instanceof AppError) return next(err);
    return next(
      new AppError(502, "CHAT_FAILED", err instanceof Error ? err.message : "Assistant request failed")
    );
  }
});

/** Recent tool decisions for the signed-in user — powers the trust panel history. */
chatRouter.get("/activity", requireSession, async (req, res, next) => {
  try {
    const events = await prisma.auditEvent.findMany({
      where: { actorEmail: req.user!.email },
      orderBy: { createdAt: "desc" },
      take: 40,
    });
    res.json({
      data: events.map((e) => ({
        at: e.createdAt.toISOString(),
        tool: e.tool,
        channel: e.channel,
        allowed: e.allowed,
        denyReason: e.denyReason,
        requiredScopes: e.requiredScopes,
        summary: e.summary,
      })),
      meta: { paymentsRequireConfirmation: config.paymentsRequireConfirmation },
    });
  } catch (err) {
    next(err);
  }
});
