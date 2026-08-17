import type { OAuthScope } from "@resident/shared";
import type { MunicipalContext } from "../lib/context.js";

export type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export type ToolDef = {
  name: string;
  description: string;
  /** Any one of these satisfies the gate; `resident.admin` always satisfies it. */
  requiredScopes: OAuthScope[];
  input_schema: JsonSchema;
  handler: (ctx: MunicipalContext, input: Record<string, unknown>) => Promise<unknown>;
  resourceType?: string;
  /** Mutating tools are labelled in the UI trace and in the MCP tool list. */
  writes?: boolean;
};

export type InsufficientScopeResult = {
  error: "insufficient_scope";
  tool: string;
  requiredScopes: string[];
  presentedScopes: string[];
  userMessage: string;
};

export type ToolFailureResult = {
  error: "tool_error";
  tool: string;
  userMessage: string;
};
