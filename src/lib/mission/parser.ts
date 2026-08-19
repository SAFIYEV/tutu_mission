import { missionConstraintsSchema, type MissionConstraints } from "./schema";
import { extractMissionWithClaude, isBedrockConfigured } from "@/lib/ai/bedrock";
import { convertBudgetToRub, extractBudgetIntent } from "@/lib/currency/cbr";
import {
  MissionClarificationError,
  MissionUnsupportedError,
  parseMissionDeterministically,
} from "./deterministic-parser";

export {
  MissionClarificationError,
  MissionUnsupportedError,
  parseMissionDeterministically,
} from "./deterministic-parser";

export async function parseMission(text: string, now = new Date()) {
  if (!isBedrockConfigured()) {
    return {
      constraints: await applyBudgetConversion(text, parseMissionDeterministically(text, now)),
      source: "deterministic-fallback" as const,
      warning: "AWS Bedrock credentials are not configured",
    };
  }

  let fallback: MissionConstraints | null = null;
  let fallbackError: unknown = null;
  try {
    fallback = parseMissionDeterministically(text, now);
  } catch (error) {
    if (error instanceof MissionUnsupportedError) throw error;
    fallbackError = error;
  }

  try {
    const extraction = await extractMissionWithClaude(text, fallback, now);
    if (extraction.status === "clarification") throw new MissionClarificationError(extraction.questions);
    if (extraction.status === "unsupported") throw new MissionUnsupportedError(extraction.details);

    const constraints = extraction.constraints;
    const eventAt = new Date(constraints.eventAt).getTime();
    const latestArrivalAt = new Date(constraints.latestArrivalAt).getTime();
    const expectedLatestArrival = eventAt - constraints.arrivalBufferMin * 60_000;
    const conflictingModes = constraints.allowedTransport.filter((mode) => constraints.excludedTransport.includes(mode));
    const returnPairIsConsistent = (constraints.returnEarliestDepartureAt === null) === (constraints.returnArrivalDeadline === null);
    const returnOrderIsValid = constraints.returnEarliestDepartureAt === null || constraints.returnArrivalDeadline === null
      || new Date(constraints.returnArrivalDeadline).getTime() >= new Date(constraints.returnEarliestDepartureAt).getTime();
    const hotelDatesAreValid = !constraints.accommodation
      || constraints.accommodation.checkOut > constraints.accommodation.checkIn;

    if (
      constraints.origin.toLocaleLowerCase("ru") === constraints.destination.toLocaleLowerCase("ru")
      || eventAt <= now.getTime()
      || Math.abs(latestArrivalAt - expectedLatestArrival) > 60_000
      || conflictingModes.length > 0
      || !returnPairIsConsistent
      || !returnOrderIsValid
      || !hotelDatesAreValid
    ) {
      throw new Error("Claude returned semantically inconsistent constraints");
    }

    return { constraints: await applyBudgetConversion(text, constraints), source: "bedrock-claude" as const, warning: null };
  } catch (error) {
    if (error instanceof MissionClarificationError || error instanceof MissionUnsupportedError) throw error;
    if (fallback) return {
      constraints: await applyBudgetConversion(text, fallback),
      source: "deterministic-fallback" as const,
      warning: bedrockFallbackReason(error),
    };
    if (fallbackError) throw fallbackError;
    throw error;
  }
}

function bedrockFallbackReason(error: unknown) {
  const message = error instanceof Error ? error.message : "unknown Bedrock error";
  if (/expired|reauthenticate|credentials?/i.test(message)) return "AWS Bedrock session is unavailable or expired";
  if (/timeout|aborted/i.test(message)) return "AWS Bedrock request timed out";
  if (/accessdenied|not authorized|permission/i.test(message)) return "AWS Bedrock access was denied";
  if (/structured|schema|json|inconsistent/i.test(message)) return "Claude response failed structural validation";
  return "AWS Bedrock request failed; deterministic parser was used";
}

async function applyBudgetConversion(text: string, constraints: MissionConstraints): Promise<MissionConstraints> {
  const intent = extractBudgetIntent(text);
  if (!intent) return constraints;
  const conversion = await convertBudgetToRub(intent);
  return missionConstraintsSchema.parse({
    ...constraints,
    maxBudget: conversion.rubAmount,
    budgetConversion: intent.currency === "RUB" ? null : conversion,
  });
}
