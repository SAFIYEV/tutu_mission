import { z } from "zod";

export const transportModeSchema = z.enum(["avia", "railway", "bus", "etrain"]);
export type TransportMode = z.infer<typeof transportModeSchema>;

export const accommodationConstraintsSchema = z.object({
  checkIn: z.string().date(),
  checkOut: z.string().date(),
  stars: z.array(z.number().int().min(0).max(5)).nullable(),
  minRating: z.number().min(0).max(10).nullable(),
  breakfastIncluded: z.boolean().nullable(),
  freeCancellation: z.boolean().nullable(),
  hotelTypes: z.array(z.string()).nullable(),
});
export type AccommodationConstraints = z.infer<typeof accommodationConstraintsSchema>;

export const missionConstraintsSchema = z.object({
  origin: z.string().min(2),
  destination: z.string().min(2),
  eventAt: z.string().datetime({ offset: true }),
  latestArrivalAt: z.string().datetime({ offset: true }),
  arrivalBufferMin: z.number().int().min(0).max(24 * 60),
  returnEarliestDepartureAt: z.string().datetime({ offset: true }).nullable(),
  returnArrivalDeadline: z.string().datetime({ offset: true }).nullable(),
  maxBudget: z.number().positive().nullable(),
  budgetConversion: z.object({
    originalAmount: z.number().positive(),
    originalCurrency: z.string().length(3),
    rubAmount: z.number().positive(),
    rateRubPerUnit: z.number().positive(),
    rateDate: z.string(),
    sourceUrl: z.string().url(),
  }).nullable().optional(),
  allowedTransport: z.array(transportModeSchema).min(1),
  excludedTransport: z.array(transportModeSchema),
  maxTransfers: z.number().int().min(0).max(6),
  maxTripDurationMin: z.number().int().positive().nullable(),
  passengers: z.object({ adults: z.number().int().min(1).max(9) }),
  timezone: z.string(),
  accommodation: accommodationConstraintsSchema.nullable().optional(),
});

export type MissionConstraints = z.infer<typeof missionConstraintsSchema>;

export const transportOptionSchema = z.object({
  id: z.string(),
  mode: transportModeSchema,
  price: z.number().nonnegative(),
  currency: z.string(),
  departureAt: z.string(),
  arrivalAt: z.string(),
  durationMin: z.number().nonnegative(),
  transfers: z.number().int().nonnegative(),
  carrier: z.string().nullable(),
  from: z.string(),
  to: z.string(),
  checkoutUrl: z.string().url().nullable(),
  searchResultsUrl: z.string().url().nullable(),
  source: z.literal("tutu-mcp"),
});

export type TransportOption = z.infer<typeof transportOptionSchema>;

export const hotelOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  stars: z.number().int().min(0).max(5).nullable(),
  rating: z.number().min(0).max(10).nullable(),
  reviewCount: z.number().int().nonnegative().nullable(),
  address: z.string().nullable(),
  checkIn: z.string().date(),
  checkOut: z.string().date(),
  nights: z.number().int().positive(),
  price: z.number().nonnegative(),
  currency: z.string(),
  breakfastIncluded: z.boolean().nullable(),
  freeCancellation: z.boolean().nullable(),
  checkoutUrl: z.string().url(),
  photoUrl: z.string().url().nullable(),
  source: z.literal("tutu-mcp"),
});
export type HotelOption = z.infer<typeof hotelOptionSchema>;

export const missionCandidateSchema = z.object({
  id: z.string(),
  outbound: transportOptionSchema,
  return: transportOptionSchema.nullable(),
  hotel: hotelOptionSchema.nullable().optional(),
  totalPrice: z.number().nonnegative(),
  totalDurationMin: z.number().nonnegative(),
  transfers: z.number().int().nonnegative(),
  score: z.number(),
});
export type MissionCandidate = z.infer<typeof missionCandidateSchema>;

export const verificationCheckSchema = z.object({
  key: z.enum(["arrival", "buffer", "budget", "transport", "transfers", "duration", "return", "chronology", "hotel"]),
  label: z.string(),
  passed: z.boolean(),
  actual: z.string().optional(),
  limit: z.string().optional(),
});
export type VerificationCheck = z.infer<typeof verificationCheckSchema>;

export const verificationResultSchema = z.object({
  verified: z.boolean(),
  checks: z.array(verificationCheckSchema),
});
export type VerificationResult = z.infer<typeof verificationResultSchema>;

export const solverStatsSchema = z.object({
  offersByMode: z.record(transportModeSchema, z.number().int().nonnegative()),
  unavailableModes: z.array(transportModeSchema),
  outboundOffers: z.number().int().nonnegative(),
  returnOffers: z.number().int().nonnegative(),
  rawOffers: z.number().int().nonnegative(),
  hotelOffers: z.number().int().nonnegative().optional(),
  combinations: z.number().int().nonnegative(),
  afterDeadline: z.number().int().nonnegative(),
  afterBudget: z.number().int().nonnegative(),
  feasible: z.number().int().nonnegative(),
  rejected: z.object({
    deadline: z.number().int().nonnegative(),
    budget: z.number().int().nonnegative(),
    otherConstraints: z.number().int().nonnegative(),
  }),
});
export type SolverStats = z.infer<typeof solverStatsSchema>;

export const missionTraceSchema = z.object({
  requestId: z.string().min(1),
  durationMs: z.number().nonnegative(),
  parserFallbackReason: z.string().nullable(),
  search: z.object({
    jobsAttempted: z.number().int().nonnegative(),
    jobsSucceeded: z.number().int().nonnegative(),
    outboundOffers: z.number().int().nonnegative(),
    returnOffers: z.number().int().nonnegative(),
    hotelOffers: z.number().int().nonnegative().optional(),
  }),
  adjustmentRounds: z.number().int().nonnegative(),
  appliedChanges: z.array(z.string()),
});
export type MissionTrace = z.infer<typeof missionTraceSchema>;

export const relaxationSuggestionSchema = z.object({
  constraint: z.enum(["budget", "arrival", "arrivalBuffer", "transport", "transfers", "duration", "return", "multiple"]),
  title: z.string(),
  detail: z.string(),
  delta: z.number(),
  candidate: missionCandidateSchema,
  adjustedConstraints: missionConstraintsSchema,
  changes: z.array(z.object({ key: z.string(), label: z.string() })).optional(),
});
export type RelaxationSuggestion = z.infer<typeof relaxationSuggestionSchema>;

export const missionResponseSchema = z.object({
  status: z.enum(["complete", "impossible"]),
  constraints: missionConstraintsSchema,
  parserSource: z.enum(["bedrock-claude", "deterministic-fallback", "agent-adjustment"]),
  stats: solverStatsSchema,
  winner: missionCandidateSchema.nullable(),
  planB: missionCandidateSchema.nullable(),
  verification: verificationResultSchema.nullable(),
  suggestion: relaxationSuggestionSchema.nullable(),
  explanation: z.string(),
  warnings: z.array(z.string()),
  trace: missionTraceSchema,
});
export type MissionResponse = z.infer<typeof missionResponseSchema>;
