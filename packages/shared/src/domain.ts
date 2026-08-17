import { z } from "zod";

export const CITY_NAME = "City of Riverbend";
export const PORTAL_NAME = "Riverbend Resident Portal";
export const ASSISTANT_NAME = "Riverbend Assistant";

// ── Enumerations ────────────────────────────────────────────────────────────

export const UserRole = z.enum(["resident", "staff", "admin"]);
export type UserRole = z.infer<typeof UserRole>;

export const UtilityService = z.enum(["water", "sewer", "trash", "recycling", "stormwater"]);
export type UtilityService = z.infer<typeof UtilityService>;

export const StatementStatus = z.enum(["due", "paid", "overdue", "partial"]);
export type StatementStatus = z.infer<typeof StatementStatus>;

export const PaymentKind = z.enum(["utility", "tax", "citation", "permit", "program"]);
export type PaymentKind = z.infer<typeof PaymentKind>;

export const PermitType = z.enum([
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
]);
export type PermitType = z.infer<typeof PermitType>;

export const PermitStatus = z.enum([
  "draft",
  "submitted",
  "under_review",
  "needs_info",
  "approved",
  "denied",
  "issued",
  "expired",
]);
export type PermitStatus = z.infer<typeof PermitStatus>;

export const InspectionStatus = z.enum(["scheduled", "passed", "failed", "cancelled"]);
export type InspectionStatus = z.infer<typeof InspectionStatus>;

export const RequestCategory = z.enum([
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
]);
export type RequestCategory = z.infer<typeof RequestCategory>;

export const RequestStatus = z.enum(["open", "acknowledged", "scheduled", "in_progress", "closed", "duplicate"]);
export type RequestStatus = z.infer<typeof RequestStatus>;

export const RequestPriority = z.enum(["low", "normal", "high", "emergency"]);
export type RequestPriority = z.infer<typeof RequestPriority>;

export const CitationStatus = z.enum(["unpaid", "paid", "contested", "dismissed", "in_collections"]);
export type CitationStatus = z.infer<typeof CitationStatus>;

export const ProgramCategory = z.enum(["recreation", "youth_camp", "senior", "aquatics", "arts", "sports"]);
export type ProgramCategory = z.infer<typeof ProgramCategory>;

export const AssistanceProgram = z.enum([
  "utility_assistance",
  "property_tax_deferral",
  "senior_discount",
  "weatherization",
  "rental_assistance",
]);
export type AssistanceProgram = z.infer<typeof AssistanceProgram>;

export const CodeCaseStatus = z.enum(["open", "notice_sent", "hearing_scheduled", "abated", "closed"]);
export type CodeCaseStatus = z.infer<typeof CodeCaseStatus>;

// ── Human labels ────────────────────────────────────────────────────────────

export const PERMIT_TYPE_LABELS: Record<PermitType, string> = {
  building: "Building permit",
  electrical: "Electrical permit",
  plumbing: "Plumbing permit",
  fence: "Fence permit",
  driveway: "Driveway / curb cut permit",
  business_license: "Business license",
  dog_license: "Dog license",
  block_party: "Block party permit",
  sign: "Sign permit",
  short_term_rental: "Short-term rental permit",
};

export const PERMIT_FEES_CENTS: Record<PermitType, number> = {
  building: 24500,
  electrical: 11000,
  plumbing: 11000,
  fence: 6500,
  driveway: 9000,
  business_license: 15000,
  dog_license: 2500,
  block_party: 3500,
  sign: 7500,
  short_term_rental: 30000,
};

export const REQUEST_CATEGORY_LABELS: Record<RequestCategory, string> = {
  pothole: "Pothole",
  streetlight_out: "Streetlight out",
  missed_collection: "Missed trash or recycling collection",
  graffiti: "Graffiti removal",
  downed_tree: "Downed tree or limb",
  water_main_break: "Water main break",
  snow_removal: "Snow or ice removal",
  illegal_dumping: "Illegal dumping",
  sidewalk_damage: "Damaged sidewalk",
  noise_complaint: "Noise complaint",
  stray_animal: "Stray or injured animal",
  other: "Other",
};

/** Target response time in business days, quoted back to residents. */
export const REQUEST_SLA_DAYS: Record<RequestCategory, number> = {
  pothole: 5,
  streetlight_out: 7,
  missed_collection: 2,
  graffiti: 10,
  downed_tree: 3,
  water_main_break: 1,
  snow_removal: 1,
  illegal_dumping: 5,
  sidewalk_damage: 20,
  noise_complaint: 3,
  stray_animal: 1,
  other: 10,
};

export const PROGRAM_CATEGORY_LABELS: Record<ProgramCategory, string> = {
  recreation: "Recreation",
  youth_camp: "Youth camp",
  senior: "Senior services",
  aquatics: "Aquatics",
  arts: "Arts & culture",
  sports: "Youth sports",
};

export const ASSISTANCE_PROGRAM_LABELS: Record<AssistanceProgram, string> = {
  utility_assistance: "Utility bill assistance",
  property_tax_deferral: "Property tax deferral",
  senior_discount: "Senior utility discount",
  weatherization: "Home weatherization",
  rental_assistance: "Emergency rental assistance",
};

// ── Request payload schemas ─────────────────────────────────────────────────

export const ContactUpdateSchema = z.object({
  phone: z.string().max(32).optional(),
  mailingAddress: z.string().max(200).optional(),
  mailingCity: z.string().max(80).optional(),
  mailingState: z.string().max(2).optional(),
  mailingZip: z.string().max(10).optional(),
  alertEmail: z.boolean().optional(),
  alertSms: z.boolean().optional(),
  alertTopics: z.array(z.string()).optional(),
});
export type ContactUpdateInput = z.infer<typeof ContactUpdateSchema>;

export const ServiceRequestCreateSchema = z.object({
  category: RequestCategory,
  description: z.string().min(5).max(2000),
  address: z.string().min(3).max(200),
  crossStreet: z.string().max(120).optional(),
  priority: RequestPriority.optional(),
  contactPhone: z.string().max(32).optional(),
});
export type ServiceRequestCreateInput = z.infer<typeof ServiceRequestCreateSchema>;

export const ServiceRequestUpdateSchema = z.object({
  status: RequestStatus.optional(),
  priority: RequestPriority.optional(),
  assignedCrew: z.string().max(120).optional(),
  note: z.string().max(2000).optional(),
});
export type ServiceRequestUpdateInput = z.infer<typeof ServiceRequestUpdateSchema>;

export const PermitApplySchema = z.object({
  type: PermitType,
  address: z.string().min(3).max(200),
  description: z.string().min(5).max(2000),
  contractorName: z.string().max(120).optional(),
  estimatedValueCents: z.number().int().min(0).optional(),
});
export type PermitApplyInput = z.infer<typeof PermitApplySchema>;

export const PermitReviewSchema = z.object({
  decision: z.enum(["approve", "deny", "request_info", "issue"]),
  note: z.string().max(2000).optional(),
  conditions: z.string().max(2000).optional(),
});
export type PermitReviewInput = z.infer<typeof PermitReviewSchema>;

export const PaymentQuoteSchema = z.object({
  kind: PaymentKind,
  referenceId: z.string().min(1),
  amountCents: z.number().int().positive().optional(),
});
export type PaymentQuoteInput = z.infer<typeof PaymentQuoteSchema>;

export const PaymentSettleSchema = z.object({
  confirmationToken: z.string().min(10),
});
export type PaymentSettleInput = z.infer<typeof PaymentSettleSchema>;

export const CitationContestSchema = z.object({
  citationId: z.string().min(1),
  statement: z.string().min(20).max(4000),
});
export type CitationContestInput = z.infer<typeof CitationContestSchema>;

export const ProgramRegisterSchema = z.object({
  programId: z.string().min(1),
  participantName: z.string().min(2).max(120),
  participantAge: z.number().int().min(0).max(120).optional(),
  notes: z.string().max(500).optional(),
});
export type ProgramRegisterInput = z.infer<typeof ProgramRegisterSchema>;

export const BillingAdjustSchema = z.object({
  statementId: z.string().min(1),
  amountCents: z.number().int().positive(),
  reason: z.string().min(5).max(500),
});
export type BillingAdjustInput = z.infer<typeof BillingAdjustSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const AuthUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  displayName: z.string().min(1),
  role: UserRole,
  oktaId: z.string().nullable(),
  residentId: z.string().nullable(),
  groups: z.array(z.string()).default([]),
  scopes: z.array(z.string()).default([]),
  persona: z.string().optional(),
  personaId: z.string().optional(),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

// ── Formatting helpers shared by API prompts and the UI ─────────────────────

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function formatDisplayName(opts: {
  email: string;
  name?: string;
  firstName?: string;
  lastName?: string;
}): string {
  const fromName = opts.name?.trim();
  if (fromName) return fromName;
  const fromParts = [opts.firstName, opts.lastName].filter(Boolean).join(" ").trim();
  if (fromParts) return fromParts;
  return opts.email.split("@")[0] ?? opts.email;
}

/** Deterministic, human-quotable reference numbers (SR-2026-000123 etc). */
export function formatReference(prefix: string, seq: number, year = new Date().getFullYear()): string {
  return `${prefix}-${year}-${String(seq).padStart(6, "0")}`;
}
