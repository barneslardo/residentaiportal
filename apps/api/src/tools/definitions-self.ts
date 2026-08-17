import { OAuthScopes, ContactUpdateSchema, ServiceRequestCreateSchema } from "@resident/shared";
import type { ToolDef } from "./types.js";
import {
  getResidentProfile,
  resolveResidentId,
  updateOwnContactInfo,
} from "../services/residents.js";
import { getTaxBills, getUtilityAccount, listStatements, setAutopay } from "../services/billing.js";
import { listPayments, quotePayment, settlePayment } from "../services/payments.js";
import { createServiceRequest, getServiceRequest, listServiceRequests } from "../services/requests.js";
import { applyForPermit, getPermit, listPermits } from "../services/permits.js";
import { contestCitation, getCitation, listCitations } from "../services/citations.js";
import { listRegistrations, registerForProgram, searchPrograms } from "../services/programs.js";
import { getOwnCodeCaseSummary, screenAssistanceEligibility } from "../services/sensitive.js";

const noArgs = { type: "object" as const, properties: {}, additionalProperties: false };

/** Resident-facing tools. Every one is scoped to the signed-in household. */
export const SELF_SERVICE_TOOLS: ToolDef[] = [
  {
    name: "get_my_account",
    description:
      "Read the signed-in resident's household record: service address, mailing address, parcel, ward, household size, and alert preferences.",
    requiredScopes: [OAuthScopes.PROFILE_READ_SELF],
    resourceType: "resident",
    input_schema: noArgs,
    handler: async (ctx) => getResidentProfile(ctx, await resolveResidentId(ctx)),
  },
  {
    name: "update_my_contact_info",
    description:
      "Update the signed-in resident's phone, mailing address, or emergency-alert preferences. Only fields you pass are changed.",
    requiredScopes: [OAuthScopes.PROFILE_WRITE_SELF],
    resourceType: "resident",
    writes: true,
    input_schema: {
      type: "object",
      properties: {
        phone: { type: "string", description: "Contact phone number" },
        mailingAddress: { type: "string" },
        mailingCity: { type: "string" },
        mailingState: { type: "string", description: "Two-letter state code" },
        mailingZip: { type: "string" },
        alertEmail: { type: "boolean", description: "Receive emergency alerts by email" },
        alertSms: { type: "boolean", description: "Receive emergency alerts by SMS" },
        alertTopics: {
          type: "array",
          items: { type: "string" },
          description: "Alert topics, e.g. water_main, snow_emergency, boil_order",
        },
      },
      additionalProperties: false,
    },
    handler: (ctx, input) => updateOwnContactInfo(ctx, ContactUpdateSchema.parse(input)),
  },
  {
    name: "get_utility_account",
    description:
      "Read utility accounts (water, sewer, trash, stormwater) with recent statements and the current balance. Defaults to the signed-in resident.",
    requiredScopes: [OAuthScopes.BILLING_READ_SELF, OAuthScopes.BILLING_READ],
    resourceType: "utility_account",
    input_schema: {
      type: "object",
      properties: {
        accountNumber: { type: "string", description: "Staff only: look up another household" },
        email: { type: "string", description: "Staff only: look up another household by email" },
      },
      additionalProperties: false,
    },
    handler: async (ctx, input) =>
      getUtilityAccount(
        ctx,
        await resolveResidentId(ctx, {
          accountNumber: input.accountNumber as string | undefined,
          email: input.email as string | undefined,
        })
      ),
  },
  {
    name: "list_utility_statements",
    description: "List utility statements with line items. Use unpaidOnly to show what is still owed.",
    requiredScopes: [OAuthScopes.BILLING_READ_SELF, OAuthScopes.BILLING_READ],
    resourceType: "utility_statement",
    input_schema: {
      type: "object",
      properties: {
        unpaidOnly: { type: "boolean" },
        limit: { type: "number" },
        accountNumber: { type: "string", description: "Staff only" },
      },
      additionalProperties: false,
    },
    handler: async (ctx, input) =>
      listStatements(
        ctx,
        await resolveResidentId(ctx, { accountNumber: input.accountNumber as string | undefined }),
        { unpaidOnly: input.unpaidOnly as boolean | undefined, limit: input.limit as number | undefined }
      ),
  },
  {
    name: "get_property_tax",
    description: "Read property-tax bills for a parcel: assessed value, amount, exemptions, balance.",
    requiredScopes: [OAuthScopes.BILLING_READ_SELF, OAuthScopes.TAX_READ],
    resourceType: "tax_bill",
    input_schema: {
      type: "object",
      properties: { accountNumber: { type: "string", description: "Staff only" } },
      additionalProperties: false,
    },
    handler: async (ctx, input) =>
      getTaxBills(
        ctx,
        await resolveResidentId(ctx, { accountNumber: input.accountNumber as string | undefined })
      ),
  },
  {
    name: "quote_payment",
    description:
      "Price a payment and create a confirmation token. This does NOT charge anything — the resident must approve the payment in the portal before it settles. Always call this before settle_payment.",
    requiredScopes: [OAuthScopes.BILLING_PAY, OAuthScopes.CITATIONS_PAY],
    resourceType: "payment_intent",
    writes: true,
    input_schema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["utility", "tax", "citation", "permit", "program"],
          description: "What is being paid",
        },
        referenceId: {
          type: "string",
          description: "Statement number, bill number, citation number, permit number, or registration ref",
        },
        amountCents: {
          type: "number",
          description: "Partial payment amount in cents. Omit to pay the full balance.",
        },
      },
      required: ["kind", "referenceId"],
      additionalProperties: false,
    },
    handler: (ctx, input) =>
      quotePayment(ctx, {
        kind: input.kind as never,
        referenceId: String(input.referenceId),
        amountCents: input.amountCents as number | undefined,
      }),
  },
  {
    name: "settle_payment",
    description:
      "Complete a payment using a confirmation token the resident already approved in the portal. Fails if the token is unapproved, expired, or already used.",
    requiredScopes: [OAuthScopes.BILLING_PAY, OAuthScopes.CITATIONS_PAY],
    resourceType: "payment",
    writes: true,
    input_schema: {
      type: "object",
      properties: { confirmationToken: { type: "string" } },
      required: ["confirmationToken"],
      additionalProperties: false,
    },
    handler: (ctx, input) => settlePayment(ctx, String(input.confirmationToken)),
  },
  {
    name: "list_payments",
    description: "Payment history for the household, including whether each payment was made by the resident or the assistant.",
    requiredScopes: [OAuthScopes.BILLING_READ_SELF, OAuthScopes.BILLING_READ],
    resourceType: "payment",
    input_schema: {
      type: "object",
      properties: { limit: { type: "number" }, accountNumber: { type: "string", description: "Staff only" } },
      additionalProperties: false,
    },
    handler: async (ctx, input) =>
      listPayments(
        ctx,
        await resolveResidentId(ctx, { accountNumber: input.accountNumber as string | undefined }),
        (input.limit as number | undefined) ?? 20
      ),
  },
  {
    name: "set_autopay",
    description: "Turn autopay on or off for the household's utility accounts.",
    requiredScopes: [OAuthScopes.BILLING_PAY, OAuthScopes.BILLING_ADJUST],
    resourceType: "utility_account",
    writes: true,
    input_schema: {
      type: "object",
      properties: { enabled: { type: "boolean" } },
      required: ["enabled"],
      additionalProperties: false,
    },
    handler: async (ctx, input) =>
      setAutopay(ctx, await resolveResidentId(ctx), Boolean(input.enabled)),
  },
  {
    name: "open_service_request",
    description:
      "Open a 311 service request (pothole, streetlight out, missed collection, downed tree, water main break, etc). Returns the request number and the target response time.",
    requiredScopes: [OAuthScopes.REQUESTS_CREATE],
    resourceType: "service_request",
    writes: true,
    input_schema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: [
            "pothole",
            "streetlight_out",
            "missed_collection",
            "graffiti",
            "downed_tree",
            "water_main_break",
            "snow_removal",
            "illegal_dumping",
            "sidewalk_damage",
            "noise_complaint",
            "stray_animal",
            "other",
          ],
        },
        description: { type: "string" },
        address: { type: "string", description: "Where the problem is, not necessarily the reporter's address" },
        crossStreet: { type: "string" },
        priority: { type: "string", enum: ["low", "normal", "high", "emergency"] },
        contactPhone: { type: "string" },
      },
      required: ["category", "description", "address"],
      additionalProperties: false,
    },
    handler: (ctx, input) => createServiceRequest(ctx, ServiceRequestCreateSchema.parse(input)),
  },
  {
    name: "list_service_requests",
    description:
      "List 311 requests. scope='mine' (default) returns the caller's own; scope='all' returns the citywide queue and requires resident.requests.manage.",
    requiredScopes: [OAuthScopes.REQUESTS_READ_SELF, OAuthScopes.REQUESTS_MANAGE],
    resourceType: "service_request",
    input_schema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["mine", "all"] },
        status: { type: "string", enum: ["open", "acknowledged", "scheduled", "in_progress", "closed", "duplicate"] },
        category: { type: "string" },
        limit: { type: "number" },
      },
      additionalProperties: false,
    },
    handler: (ctx, input) =>
      listServiceRequests(ctx, {
        scope: input.scope as "mine" | "all" | undefined,
        status: input.status as string | undefined,
        category: input.category as string | undefined,
        limit: input.limit as number | undefined,
      }),
  },
  {
    name: "get_service_request",
    description: "Read one 311 request by number, including its full status history.",
    requiredScopes: [OAuthScopes.REQUESTS_READ_SELF, OAuthScopes.REQUESTS_MANAGE],
    resourceType: "service_request",
    input_schema: {
      type: "object",
      properties: { requestNumber: { type: "string" } },
      required: ["requestNumber"],
      additionalProperties: false,
    },
    handler: (ctx, input) => getServiceRequest(ctx, String(input.requestNumber)),
  },
  {
    name: "apply_for_permit",
    description:
      "Submit a permit or license application for the signed-in resident (building, electrical, plumbing, fence, driveway, business license, dog license, block party, sign, short-term rental).",
    requiredScopes: [OAuthScopes.PERMITS_APPLY],
    resourceType: "permit",
    writes: true,
    input_schema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: [
            "building",
            "electrical",
            "plumbing",
            "fence",
            "driveway",
            "business_license",
            "dog_license",
            "block_party",
            "sign",
            "short_term_rental",
          ],
        },
        address: { type: "string" },
        description: { type: "string", description: "Scope of work or purpose" },
        contractorName: { type: "string" },
        estimatedValueCents: { type: "number" },
      },
      required: ["type", "address", "description"],
      additionalProperties: false,
    },
    handler: (ctx, input) => applyForPermit(ctx, input as never),
  },
  {
    name: "list_permits",
    description: "List permits. scope='all' requires resident.permits.review; otherwise returns the caller's own.",
    requiredScopes: [OAuthScopes.PERMITS_READ_SELF, OAuthScopes.PERMITS_REVIEW],
    resourceType: "permit",
    input_schema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["mine", "all"] },
        status: { type: "string" },
        limit: { type: "number" },
      },
      additionalProperties: false,
    },
    handler: (ctx, input) =>
      listPermits(ctx, {
        scope: input.scope as "mine" | "all" | undefined,
        status: input.status as string | undefined,
        limit: input.limit as number | undefined,
      }),
  },
  {
    name: "get_permit",
    description: "Read one permit by number, with its inspection schedule.",
    requiredScopes: [OAuthScopes.PERMITS_READ_SELF, OAuthScopes.PERMITS_REVIEW],
    resourceType: "permit",
    input_schema: {
      type: "object",
      properties: { permitNumber: { type: "string" } },
      required: ["permitNumber"],
      additionalProperties: false,
    },
    handler: (ctx, input) => getPermit(ctx, String(input.permitNumber)),
  },
  {
    name: "list_citations",
    description: "List parking and code citations issued to the household, with balances.",
    requiredScopes: [OAuthScopes.CITATIONS_READ_SELF, OAuthScopes.RECORDS_READ],
    resourceType: "citation",
    input_schema: {
      type: "object",
      properties: { status: { type: "string" }, limit: { type: "number" } },
      additionalProperties: false,
    },
    handler: (ctx, input) =>
      listCitations(ctx, { status: input.status as string | undefined, limit: input.limit as number | undefined }),
  },
  {
    name: "get_citation",
    description: "Read one citation by number.",
    requiredScopes: [OAuthScopes.CITATIONS_READ_SELF, OAuthScopes.RECORDS_READ],
    resourceType: "citation",
    input_schema: {
      type: "object",
      properties: { citationNumber: { type: "string" } },
      required: ["citationNumber"],
      additionalProperties: false,
    },
    handler: (ctx, input) => getCitation(ctx, String(input.citationNumber)),
  },
  {
    name: "contest_citation",
    description:
      "File a contest for one of the caller's own citations. The statement must be the resident's own account of what happened — ask them for it, do not compose facts on their behalf.",
    requiredScopes: [OAuthScopes.CITATIONS_CONTEST],
    resourceType: "citation",
    writes: true,
    input_schema: {
      type: "object",
      properties: {
        citationId: { type: "string", description: "Citation number" },
        statement: { type: "string", description: "The resident's own contest statement (min 20 chars)" },
      },
      required: ["citationId", "statement"],
      additionalProperties: false,
    },
    handler: (ctx, input) =>
      contestCitation(ctx, { citationId: String(input.citationId), statement: String(input.statement) }),
  },
  {
    name: "search_programs",
    description:
      "Search the recreation and community program catalog (classes, camps, senior services, aquatics, sports). Public information — no scope needed beyond a signed-in session.",
    requiredScopes: [OAuthScopes.PROGRAMS_REGISTER, OAuthScopes.PROFILE_READ_SELF, OAuthScopes.RECORDS_READ],
    resourceType: "program",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        category: {
          type: "string",
          enum: ["recreation", "youth_camp", "senior", "aquatics", "arts", "sports"],
        },
        age: { type: "number", description: "Filter to programs accepting this participant age" },
        openOnly: { type: "boolean", description: "Only programs currently open for registration" },
        limit: { type: "number" },
      },
      additionalProperties: false,
    },
    handler: (_ctx, input) =>
      searchPrograms({
        query: input.query as string | undefined,
        category: input.category as string | undefined,
        age: input.age as number | undefined,
        openOnly: input.openOnly as boolean | undefined,
        limit: input.limit as number | undefined,
      }),
  },
  {
    name: "register_for_program",
    description: "Register a household member for a city program. Checks age, capacity, and the registration window.",
    requiredScopes: [OAuthScopes.PROGRAMS_REGISTER],
    resourceType: "program_registration",
    writes: true,
    input_schema: {
      type: "object",
      properties: {
        programId: { type: "string", description: "Program code or id from search_programs" },
        participantName: { type: "string" },
        participantAge: { type: "number" },
        notes: { type: "string", description: "Accommodations or notes for staff" },
      },
      required: ["programId", "participantName"],
      additionalProperties: false,
    },
    handler: (ctx, input) => registerForProgram(ctx, input as never),
  },
  {
    name: "list_my_registrations",
    description: "List the household's program registrations and whether fees are outstanding.",
    requiredScopes: [OAuthScopes.PROGRAMS_REGISTER, OAuthScopes.PROFILE_READ_SELF],
    resourceType: "program_registration",
    input_schema: noArgs,
    handler: (ctx) => listRegistrations(ctx),
  },
  {
    name: "screen_assistance_eligibility",
    description:
      "Unofficial income screening for city assistance programs using figures the resident supplies. Does not read or create any case file.",
    requiredScopes: [OAuthScopes.PROFILE_READ_SELF, OAuthScopes.RECORDS_READ],
    resourceType: "assistance_screening",
    input_schema: {
      type: "object",
      properties: {
        householdSize: { type: "number" },
        annualIncomeCents: { type: "number", description: "Gross annual household income in cents" },
        program: {
          type: "string",
          enum: [
            "utility_assistance",
            "property_tax_deferral",
            "senior_discount",
            "weatherization",
            "rental_assistance",
          ],
        },
      },
      required: ["householdSize", "annualIncomeCents"],
      additionalProperties: false,
    },
    handler: (ctx, input) =>
      screenAssistanceEligibility(ctx, {
        householdSize: Number(input.householdSize),
        annualIncomeCents: Number(input.annualIncomeCents),
        program: input.program as never,
      }),
  },
  {
    name: "get_my_code_cases",
    description:
      "Summary of code-enforcement cases on the caller's own property: case number, violation type, status, hearing date, fine. Inspector notes are not included.",
    requiredScopes: [OAuthScopes.PROFILE_READ_SELF],
    resourceType: "code_case",
    input_schema: noArgs,
    handler: (ctx) => getOwnCodeCaseSummary(ctx),
  },
];
