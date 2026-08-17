import { OAuthScopes, BillingAdjustSchema, ServiceRequestUpdateSchema } from "@resident/shared";
import type { ToolDef } from "./types.js";
import { lookupResidents } from "../services/residents.js";
import { adjustStatement } from "../services/billing.js";
import { serviceRequestStats, updateServiceRequest } from "../services/requests.js";
import { reviewPermit, scheduleInspection } from "../services/permits.js";
import { citationQueue } from "../services/citations.js";
import { getAssistanceCases, getCodeCases } from "../services/sensitive.js";
import { listAuditEvents } from "../lib/audit.js";
import { isAdmin, ScopeError } from "../lib/context.js";

/** Departmental tools. Each maps to exactly one staff scope in the persona matrix. */
export const STAFF_TOOLS: ToolDef[] = [
  {
    name: "lookup_resident",
    description:
      "Search the resident roll by name, address, email, account number, or parcel id. City staff only.",
    requiredScopes: [OAuthScopes.RECORDS_READ],
    resourceType: "resident",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "number" } },
      additionalProperties: false,
    },
    handler: (ctx, input) =>
      lookupResidents(ctx, {
        query: input.query as string | undefined,
        limit: input.limit as number | undefined,
      }),
  },
  {
    name: "adjust_utility_statement",
    description:
      "Apply a credit to a utility statement (waive a late fee, correct a misread meter). Requires a written reason, which is recorded with the adjustment.",
    requiredScopes: [OAuthScopes.BILLING_ADJUST],
    resourceType: "utility_statement",
    writes: true,
    input_schema: {
      type: "object",
      properties: {
        statementId: { type: "string", description: "Statement id or number" },
        amountCents: { type: "number", description: "Credit amount in cents" },
        reason: { type: "string" },
      },
      required: ["statementId", "amountCents", "reason"],
      additionalProperties: false,
    },
    handler: (ctx, input) => adjustStatement(ctx, BillingAdjustSchema.parse(input)),
  },
  {
    name: "update_service_request",
    description:
      "Triage a 311 request: change status, set priority, assign a crew, or close it with a note. Public Works and Code Enforcement only.",
    requiredScopes: [OAuthScopes.REQUESTS_MANAGE],
    resourceType: "service_request",
    writes: true,
    input_schema: {
      type: "object",
      properties: {
        requestNumber: { type: "string" },
        status: {
          type: "string",
          enum: ["open", "acknowledged", "scheduled", "in_progress", "closed", "duplicate"],
        },
        priority: { type: "string", enum: ["low", "normal", "high", "emergency"] },
        assignedCrew: { type: "string" },
        note: { type: "string" },
      },
      required: ["requestNumber"],
      additionalProperties: false,
    },
    handler: (ctx, input) => {
      const { requestNumber, ...rest } = input;
      return updateServiceRequest(ctx, String(requestNumber), ServiceRequestUpdateSchema.parse(rest));
    },
  },
  {
    name: "service_request_stats",
    description: "Citywide 311 rollup: counts by status and category, plus how many are past their SLA.",
    requiredScopes: [OAuthScopes.REQUESTS_MANAGE],
    resourceType: "service_request",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    handler: (ctx) => serviceRequestStats(ctx),
  },
  {
    name: "review_permit",
    description:
      "Approve, deny, request more information on, or issue a permit application. Building & Permits only.",
    requiredScopes: [OAuthScopes.PERMITS_REVIEW],
    resourceType: "permit",
    writes: true,
    input_schema: {
      type: "object",
      properties: {
        permitNumber: { type: "string" },
        decision: { type: "string", enum: ["approve", "deny", "request_info", "issue"] },
        note: { type: "string" },
        conditions: { type: "string", description: "Conditions attached to an approval" },
      },
      required: ["permitNumber", "decision"],
      additionalProperties: false,
    },
    handler: (ctx, input) =>
      reviewPermit(ctx, String(input.permitNumber), {
        decision: input.decision as never,
        note: input.note as string | undefined,
        conditions: input.conditions as string | undefined,
      }),
  },
  {
    name: "schedule_inspection",
    description: "Schedule an inspection against a permit. Building & Permits only.",
    requiredScopes: [OAuthScopes.PERMITS_REVIEW],
    resourceType: "inspection",
    writes: true,
    input_schema: {
      type: "object",
      properties: {
        permitNumber: { type: "string" },
        type: { type: "string", description: "e.g. footing, rough-in, final" },
        scheduledFor: { type: "string", description: "ISO date, e.g. 2026-09-14" },
        inspectorName: { type: "string" },
      },
      required: ["permitNumber", "type", "scheduledFor"],
      additionalProperties: false,
    },
    handler: (ctx, input) =>
      scheduleInspection(ctx, {
        permitRef: String(input.permitNumber),
        type: String(input.type),
        scheduledFor: String(input.scheduledFor),
        inspectorName: input.inspectorName as string | undefined,
      }),
  },
  {
    name: "citation_queue",
    description: "Citywide outstanding and contested citations, including contest statements. Code Enforcement only.",
    requiredScopes: [OAuthScopes.CODE_ENFORCEMENT],
    resourceType: "citation",
    input_schema: {
      type: "object",
      properties: { limit: { type: "number" } },
      additionalProperties: false,
    },
    handler: (ctx, input) => citationQueue(ctx, (input.limit as number | undefined) ?? 50),
  },
  {
    name: "get_code_cases",
    description:
      "Read code-enforcement case files including inspector narrative, hearing dates, and fines. Code Enforcement only.",
    requiredScopes: [OAuthScopes.CODE_ENFORCEMENT],
    resourceType: "code_case",
    input_schema: {
      type: "object",
      properties: {
        address: { type: "string" },
        status: { type: "string" },
        limit: { type: "number" },
      },
      additionalProperties: false,
    },
    handler: (ctx, input) =>
      getCodeCases(ctx, {
        address: input.address as string | undefined,
        status: input.status as string | undefined,
        limit: input.limit as number | undefined,
      }),
  },
  {
    name: "get_assistance_cases",
    description:
      "Read income-qualified assistance case files: household income, benefit amount, caseworker notes. Social Services only — the most restricted dataset in the portal.",
    requiredScopes: [OAuthScopes.ASSISTANCE],
    resourceType: "assistance_case",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string" },
        limit: { type: "number" },
      },
      additionalProperties: false,
    },
    handler: (ctx, input) =>
      getAssistanceCases(ctx, {
        status: input.status as string | undefined,
        limit: input.limit as number | undefined,
      }),
  },
  {
    name: "list_agent_audit_log",
    description:
      "Read the agent audit log: every tool call attempted through the assistant or MCP, allowed or denied, with the scopes that decided it. City Administrator only.",
    requiredScopes: [OAuthScopes.ADMIN],
    resourceType: "audit_event",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number" },
        actorEmail: { type: "string" },
        deniedOnly: { type: "boolean" },
        tool: { type: "string" },
      },
      additionalProperties: false,
    },
    handler: async (ctx, input) => {
      if (!isAdmin(ctx)) {
        throw new ScopeError([OAuthScopes.ADMIN], "The audit log is restricted to the City Administrator.");
      }
      const events = await listAuditEvents({
        limit: (input.limit as number | undefined) ?? 50,
        actorEmail: input.actorEmail as string | undefined,
        allowed: input.deniedOnly ? false : undefined,
        tool: input.tool as string | undefined,
      });
      return {
        count: events.length,
        events: events.map((e) => ({
          at: e.createdAt.toISOString(),
          actor: e.actorEmail,
          persona: e.actorPersona,
          channel: e.channel,
          tool: e.tool,
          allowed: e.allowed,
          denyReason: e.denyReason,
          requiredScopes: e.requiredScopes,
          presentedScopes: e.presentedScopes,
          delegation: e.delegationMode,
          summary: e.summary,
        })),
      };
    },
  },
];
