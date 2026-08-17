import { ZodError } from "zod";
import { hasAnyScope, personasGranting, SCOPE_DESCRIPTIONS, type OAuthScope } from "@resident/shared";
import { recordAudit } from "../lib/audit.js";
import { ScopeError, type MunicipalContext } from "../lib/context.js";
import { SELF_SERVICE_TOOLS } from "./definitions-self.js";
import { STAFF_TOOLS } from "./definitions-staff.js";
import type { InsufficientScopeResult, ToolDef, ToolFailureResult } from "./types.js";

export const ALL_TOOLS: ToolDef[] = [...SELF_SERVICE_TOOLS, ...STAFF_TOOLS];

const TOOLS_BY_NAME = new Map(ALL_TOOLS.map((tool) => [tool.name, tool]));

export function getTool(name: string): ToolDef | undefined {
  return TOOLS_BY_NAME.get(name);
}

/** Only the tools this session's scopes can actually invoke. */
export function toolsForScopes(scopes: string[]): ToolDef[] {
  return ALL_TOOLS.filter((tool) => hasAnyScope(scopes, tool.requiredScopes));
}

export function blockedToolsForScopes(scopes: string[]): ToolDef[] {
  return ALL_TOOLS.filter((tool) => !hasAnyScope(scopes, tool.requiredScopes));
}

/**
 * Explain a denial in terms of Okta, not HTTP.
 *
 * "403 Forbidden" teaches the audience nothing; naming the missing scope and the
 * department that holds it is the whole lesson of the demo.
 */
export function explainMissingScope(tool: ToolDef, presented: string[]): string {
  const missing = tool.requiredScopes.filter((scope) => !presented.includes(scope));
  const primary = missing[0] ?? tool.requiredScopes[0];
  const holders = personasGranting(primary)
    .filter((p) => p.id !== "administrator")
    .map((p) => p.label);

  const holderText = holders.length
    ? ` In this org that scope is granted to ${holders.join(", ")}.`
    : "";

  return (
    `I can't run ${tool.name} — this session's delegated token doesn't carry ${missing.join(" or ")}. ` +
    `That scope authorizes: ${SCOPE_DESCRIPTIONS[primary] ?? primary}.${holderText} ` +
    "Okta issues the token from your group membership, so nothing I do here can widen it."
  );
}

function toolErrorMessage(err: unknown): string {
  if (err instanceof ZodError) {
    const first = err.errors[0];
    return `That request was missing or malformed: ${first?.path.join(".") || "input"} — ${first?.message ?? "invalid"}.`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

export type ToolRunResult = {
  ok: boolean;
  tool: string;
  result: unknown;
  allowed: boolean;
  requiredScopes: string[];
  durationMs: number;
};

/**
 * The single enforcement point for every tool call, whatever the entry point.
 *
 * Scope check → audit → execute → audit failures. Denials return a structured
 * result rather than throwing so the model can relay the explanation to the
 * user instead of surfacing a stack trace.
 */
export async function runTool(
  name: string,
  input: Record<string, unknown>,
  ctx: MunicipalContext
): Promise<ToolRunResult> {
  const started = Date.now();
  const tool = getTool(name);

  if (!tool) {
    await recordAudit(ctx, {
      tool: name,
      allowed: false,
      denyReason: "unknown_tool",
      summary: `Unknown tool ${name}`,
    });
    return {
      ok: false,
      tool: name,
      allowed: false,
      requiredScopes: [],
      durationMs: Date.now() - started,
      result: { error: "unknown_tool", tool: name, userMessage: `There is no municipal tool named ${name}.` },
    };
  }

  if (!hasAnyScope(ctx.scopes, tool.requiredScopes)) {
    const userMessage = explainMissingScope(tool, ctx.scopes);
    await recordAudit(ctx, {
      tool: tool.name,
      allowed: false,
      denyReason: "insufficient_scope",
      requiredScopes: tool.requiredScopes,
      resourceType: tool.resourceType,
      summary: userMessage,
    });
    const denial: InsufficientScopeResult = {
      error: "insufficient_scope",
      tool: tool.name,
      requiredScopes: tool.requiredScopes,
      presentedScopes: ctx.scopes,
      userMessage,
    };
    return {
      ok: false,
      tool: tool.name,
      allowed: false,
      requiredScopes: tool.requiredScopes,
      durationMs: Date.now() - started,
      result: denial,
    };
  }

  try {
    const result = await tool.handler(ctx, input ?? {});
    await recordAudit(ctx, {
      tool: tool.name,
      allowed: true,
      requiredScopes: tool.requiredScopes,
      resourceType: tool.resourceType,
      summary: tool.writes ? `${tool.name} (write) succeeded` : `${tool.name} succeeded`,
    });
    return {
      ok: true,
      tool: tool.name,
      allowed: true,
      requiredScopes: tool.requiredScopes,
      durationMs: Date.now() - started,
      result,
    };
  } catch (err) {
    // A ScopeError from the service layer is a row-level denial: the verb was
    // authorized, the specific record was not.
    const isScope = err instanceof ScopeError;
    const userMessage = toolErrorMessage(err);
    await recordAudit(ctx, {
      tool: tool.name,
      allowed: false,
      denyReason: isScope ? "resource_forbidden" : "tool_error",
      requiredScopes: isScope && err.required.length ? (err.required as OAuthScope[]) : tool.requiredScopes,
      resourceType: tool.resourceType,
      summary: userMessage,
    });
    const failure: ToolFailureResult | InsufficientScopeResult = isScope
      ? {
          error: "insufficient_scope",
          tool: tool.name,
          requiredScopes: err.required,
          presentedScopes: ctx.scopes,
          userMessage,
        }
      : { error: "tool_error", tool: tool.name, userMessage };
    return {
      ok: false,
      tool: tool.name,
      allowed: false,
      requiredScopes: tool.requiredScopes,
      durationMs: Date.now() - started,
      result: failure,
    };
  }
}
