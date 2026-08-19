import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { missionConstraintsSchema, type MissionConstraints } from "@/lib/mission/schema";
import { integerEnv } from "@/lib/runtime-config";

const BEDROCK_MODEL_ID = "global.anthropic.claude-sonnet-4-6";

// Bedrock Structured Outputs supports a subset of JSON Schema Draft 2020-12.
// Numeric/string limits remain enforced by Zod after inference.
const missionConstraintsOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    origin: { type: "string" },
    destination: { type: "string" },
    eventAt: { type: "string", format: "date-time" },
    latestArrivalAt: { type: "string", format: "date-time" },
    arrivalBufferMin: { type: "integer" },
    returnEarliestDepartureAt: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
    returnArrivalDeadline: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
    maxBudget: { anyOf: [{ type: "number" }, { type: "null" }] },
    allowedTransport: { type: "array", minItems: 1, items: { type: "string", enum: ["avia", "railway", "bus", "etrain"] } },
    excludedTransport: { type: "array", items: { type: "string", enum: ["avia", "railway", "bus", "etrain"] } },
    maxTransfers: { type: "integer" },
    maxTripDurationMin: { anyOf: [{ type: "integer" }, { type: "null" }] },
    passengers: {
      type: "object",
      additionalProperties: false,
      properties: { adults: { type: "integer" } },
      required: ["adults"],
    },
    timezone: { type: "string" },
    accommodation: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          properties: {
            checkIn: { type: "string", format: "date" },
            checkOut: { type: "string", format: "date" },
            stars: { anyOf: [{ type: "array", items: { type: "integer" } }, { type: "null" }] },
            minRating: { anyOf: [{ type: "number" }, { type: "null" }] },
            breakfastIncluded: { anyOf: [{ type: "boolean" }, { type: "null" }] },
            freeCancellation: { anyOf: [{ type: "boolean" }, { type: "null" }] },
            hotelTypes: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] },
          },
          required: ["checkIn", "checkOut", "stars", "minRating", "breakfastIncluded", "freeCancellation", "hotelTypes"],
        },
        { type: "null" },
      ],
    },
  },
  required: [
    "origin",
    "destination",
    "eventAt",
    "latestArrivalAt",
    "arrivalBufferMin",
    "returnEarliestDepartureAt",
    "returnArrivalDeadline",
    "maxBudget",
    "allowedTransport",
    "excludedTransport",
    "maxTransfers",
    "maxTripDurationMin",
    "passengers",
    "timezone",
    "accommodation",
  ],
};

const missionOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["ready", "clarification", "unsupported"] },
    constraints: { anyOf: [missionConstraintsOutputSchema, { type: "null" }] },
    questions: { type: "array", items: { type: "string" } },
    details: { type: "array", items: { type: "string" } },
  },
  required: ["status", "constraints", "questions", "details"],
};

export type ClaudeMissionExtraction =
  | { status: "ready"; constraints: MissionConstraints }
  | { status: "clarification"; questions: string[] }
  | { status: "unsupported"; details: string[] };

let client: BedrockRuntimeClient | null = null;

export function isBedrockConfigured() {
  if (process.env.AWS_BEDROCK_ENABLED === "false") return false;
  const hasAwsLogin = existsSync(join(homedir(), ".aws", "login", "cache"));
  const hasSharedCredentials = existsSync(join(homedir(), ".aws", "credentials"));
  return Boolean(
    process.env.AWS_BEARER_TOKEN_BEDROCK ||
      process.env.AWS_ACCESS_KEY_ID ||
      process.env.AWS_PROFILE ||
      process.env.AWS_WEB_IDENTITY_TOKEN_FILE ||
      process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
      process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI ||
      hasAwsLogin ||
      hasSharedCredentials,
  );
}

function getClient() {
  client ??= new BedrockRuntimeClient({
    region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1",
  });
  return client;
}

export async function extractMissionWithClaude(
  text: string,
  validatedDraft: MissionConstraints | null,
  now = new Date(),
): Promise<ClaudeMissionExtraction> {
  const response = await getClient().send(
    new ConverseCommand({
      modelId: process.env.AWS_BEDROCK_MODEL_ID ?? BEDROCK_MODEL_ID,
      system: [
        {
          text: "You extract strict travel constraints from Russian natural language. Never invent a city, date, deadline, return deadline, passenger count, budget, transport preference, timezone or hotel preference. Resolve relative dates deterministically: a return phrase such as 'вернуться через N дней' is N calendar days after the stated arrival/event date; only when no trip date is stated may it be based on the user's local current date. A relative return date without a clock means by 23:59 local time on that date and is sufficiently precise; never ask for a return time in that case. If a required fact is missing or contradictory, return clarification. Child fares, multi-city routes, special assistance and pets are unsupported. Hotels are supported: accommodation must be null unless requested; when requested it must contain exact check-in/check-out dates and explicit stars/rating/breakfast/free-cancellation/type preferences. Wording such as 'отель тоже найди' delegates the hotel choice to the agent and must not trigger preference questions. If hotel preferences are broad and the user did not delegate the choice, return 2-4 short clarification questions. Foreign-currency budgets are supported by a deterministic exchange-rate adapter after extraction: set maxBudget to null for them instead of rejecting them. A missing budget, return, arrival buffer or duration limit is valid and must use null/zero as specified. Transport modes are avia, railway, bus, etrain. Unless the user explicitly requests only one mode, allowedTransport must contain every supported mode except modes explicitly forbidden by the user; excludedTransport must contain exactly the explicitly forbidden modes. Default adults to 1 and maxTransfers to 6 only when unstated.",
        },
      ],
      messages: [
        {
          role: "user",
          content: [
            {
              text: `Extract a mission outcome. Current instant: ${now.toISOString()}.\nFor status=ready, constraints must be non-null, questions/details empty, eventAt must be a future ISO date-time with the destination's UTC offset, latestArrivalAt = eventAt - explicit arrivalBufferMin, allowed/excluded transport must not conflict, and return fields must both be null unless the user explicitly asks to return with a sufficiently precise deadline.\nFor status=clarification, constraints must be null and questions must list only information needed to search safely.\nFor status=unsupported, constraints must be null and details must explain the unsupported requirement.\nUse the deterministic draft as grounded help when present, but do not copy a value that conflicts with the request.\n\nRequest:\n${text}\n\nDeterministic draft:\n${JSON.stringify(validatedDraft)}`,
            },
          ],
        },
      ],
      inferenceConfig: { maxTokens: 2_500, temperature: 0 },
      outputConfig: {
        textFormat: {
          type: "json_schema",
          structure: {
            jsonSchema: {
              name: "mission_constraints",
              description: "Validated constraints for the deterministic Tutu Mission solver",
              schema: JSON.stringify(missionOutputSchema),
            },
          },
        },
      },
    }),
    { abortSignal: AbortSignal.timeout(integerEnv("AWS_BEDROCK_TIMEOUT_MS", 15_000, { min: 1_000, max: 60_000 })) },
  );

  const output = response.output?.message?.content?.find((block) => "text" in block)?.text;
  if (!output) throw new Error("Claude returned no structured output");
  const parsed = JSON.parse(output) as {
    status?: string;
    constraints?: unknown;
    questions?: unknown;
    details?: unknown;
  };
  if (parsed.status === "ready") {
    return { status: "ready", constraints: missionConstraintsSchema.parse(parsed.constraints) };
  }
  if (parsed.status === "clarification" && Array.isArray(parsed.questions) && parsed.questions.every((item) => typeof item === "string") && parsed.questions.length) {
    return { status: "clarification", questions: parsed.questions };
  }
  if (parsed.status === "unsupported" && Array.isArray(parsed.details) && parsed.details.every((item) => typeof item === "string") && parsed.details.length) {
    return { status: "unsupported", details: parsed.details };
  }
  throw new Error("Claude returned an inconsistent mission outcome");
}
