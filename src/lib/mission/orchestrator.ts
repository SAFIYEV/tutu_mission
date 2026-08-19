import type { MissionConstraints, MissionResponse } from "./schema";
import type { MissionParser, MissionSearchProvider } from "./ports";
import { explainWinner, findMinimalRelaxation, solveMission } from "./solver";
import { groundMissionTimezones } from "./timezone";
import { verifyMission } from "./verifier";

export type MissionExecutionOptions = {
  mode?: "solve" | "auto-adjust";
  signal?: AbortSignal;
  requestId?: string;
  maxAdjustmentRounds?: number;
  provider: MissionSearchProvider;
  parser: MissionParser;
};

export async function executeMission(text: string, options: MissionExecutionOptions): Promise<MissionResponse> {
  const startedAt = Date.now();
  const requestId = options.requestId ?? crypto.randomUUID();
  const parsed = await options.parser(text);
  const maxRounds = options.mode === "auto-adjust"
    ? Math.max(1, Math.min(3, options.maxAdjustmentRounds ?? 3))
    : 0;
  let constraints = parsed.constraints;
  let parserSource: MissionResponse["parserSource"] = parsed.source;
  let adjustmentRounds = 0;
  const appliedChanges: string[] = [];
  const aggregateSearch = { jobsAttempted: 0, jobsSucceeded: 0, outboundOffers: 0, returnOffers: 0, hotelOffers: 0 };

  while (true) {
    options.signal?.throwIfAborted();
    const search = await options.provider.searchForMission(constraints, options.signal);
    constraints = groundMissionTimezones(constraints, search);
    aggregateSearch.jobsAttempted += search.outbound.attempts + search.returns.attempts + (search.hotels?.attempts ?? 0);
    aggregateSearch.jobsSucceeded += search.outbound.successfulSearches + search.returns.successfulSearches + (search.hotels?.successfulSearches ?? 0);
    aggregateSearch.outboundOffers = search.outbound.options.length;
    aggregateSearch.returnOffers = search.returns.options.length;
    aggregateSearch.hotelOffers = search.hotels?.options.length ?? 0;

    const unavailableModes = [...new Set([...search.outbound.unavailableModes, ...search.returns.unavailableModes])];
    const warnings = [...search.outbound.warnings, ...search.returns.warnings, ...(search.hotels?.warnings ?? [])];
    const solved = solveMission(constraints, search.outbound.options, search.returns.options, unavailableModes, search.hotels?.options ?? []);
    const winner = solved.ranked[0] ?? null;
    const suggestion = winner ? null : findMinimalRelaxation(solved.all, constraints, search.outbound.options);
    const shared = responseBase({
      constraints,
      parserSource,
      stats: solved.stats,
      warnings,
      requestId,
      startedAt,
      parserWarning: parsed.warning,
      aggregateSearch,
      adjustmentRounds,
      appliedChanges,
    });

    if (winner) {
      const verification = verifyMission(winner, constraints);
      if (!verification.verified) throw new Error("Invariant violation: solver returned an unverified mission");
      return {
        ...shared,
        status: "complete",
        winner,
        planB: solved.ranked[1] ?? null,
        verification,
        suggestion: null,
        explanation: explainWinner(winner, constraints),
      };
    }

    const impossible: MissionResponse = {
      ...shared,
      status: "impossible",
      winner: null,
      planB: null,
      verification: null,
      suggestion,
      explanation: suggestion
        ? `${suggestion.title} — ${suggestion.detail}.`
        : diagnosticExplanation(solved.stats.outboundOffers, solved.stats.returnOffers, Boolean(constraints.returnArrivalDeadline), Boolean(constraints.accommodation), solved.stats.hotelOffers ?? 0),
    };

    if (!suggestion || adjustmentRounds >= maxRounds) return impossible;
    appliedChanges.push(...suggestionLabels(impossible));
    constraints = suggestion.adjustedConstraints;
    parserSource = "agent-adjustment";
    adjustmentRounds += 1;
  }
}

type ResponseBaseInput = {
  constraints: MissionConstraints;
  parserSource: MissionResponse["parserSource"];
  stats: MissionResponse["stats"];
  warnings: string[];
  requestId: string;
  startedAt: number;
  parserWarning?: string | null;
  aggregateSearch: MissionResponse["trace"]["search"];
  adjustmentRounds: number;
  appliedChanges: string[];
};

function responseBase(input: ResponseBaseInput): Pick<MissionResponse, "constraints" | "parserSource" | "stats" | "warnings" | "trace"> {
  return {
    constraints: input.constraints,
    parserSource: input.parserSource,
    stats: input.stats,
    warnings: input.warnings,
    trace: {
      requestId: input.requestId,
      durationMs: Date.now() - input.startedAt,
      parserFallbackReason: input.parserWarning ?? null,
      search: { ...input.aggregateSearch },
      adjustmentRounds: input.adjustmentRounds,
      appliedChanges: [...input.appliedChanges],
    },
  };
}

function suggestionLabels(response: MissionResponse) {
  const suggestion = response.suggestion;
  if (!suggestion) return [];
  return suggestion.changes?.map((change) => change.label) ?? [suggestion.title];
}

function diagnosticExplanation(outboundOffers: number, returnOffers: number, needsReturn: boolean, needsHotel: boolean, hotelOffers: number) {
  if (outboundOffers === 0) return "Туту не вернул предложений в направлении туда для выбранных дат.";
  if (needsReturn && returnOffers === 0) return "Предложения туда найдены, но Туту не вернул обратных вариантов в заданное окно.";
  if (needsHotel && hotelOffers === 0) return "Транспорт найден, но Туту не вернул отелей, соответствующих датам и предпочтениям.";
  return "Предложения в обе стороны найдены, но ни одна комбинация не выполняет все ограничения одновременно.";
}
