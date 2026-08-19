import type { HotelOption, MissionConstraints, SolverStats, TransportMode, TransportOption } from "./schema";
import { verifyMission } from "./verifier";
import { createCandidatePool } from "./candidate";
import { scoreCandidate } from "./scoring";

const MODES: TransportMode[] = ["avia", "railway", "bus", "etrain"];

export function solveMission(
  constraints: MissionConstraints,
  outbound: TransportOption[],
  returns: TransportOption[],
  unavailableModes: TransportMode[] = [],
  hotels: HotelOption[] = [],
) {
  const all = createCandidatePool(outbound, returns, Boolean(constraints.returnArrivalDeadline), hotels, Boolean(constraints.accommodation));
  const afterDeadline = all.filter((candidate) => new Date(candidate.outbound.arrivalAt) <= new Date(constraints.latestArrivalAt));
  const afterBudget = afterDeadline.filter((candidate) => constraints.maxBudget == null || candidate.totalPrice <= constraints.maxBudget);
  const feasible = afterBudget.filter((candidate) => verifyMission(candidate, constraints).verified);
  const ranked = feasible
    .map((candidate) => ({ ...candidate, score: scoreCandidate(candidate, constraints) }))
    .sort((a, b) => b.score - a.score);
  const offersByMode = Object.fromEntries(
    MODES.map((mode) => [mode, [...outbound, ...returns].filter((option) => option.mode === mode).length]),
  ) as Record<TransportMode, number>;
  const stats: SolverStats = {
    offersByMode,
    unavailableModes,
    outboundOffers: outbound.length,
    returnOffers: returns.length,
    rawOffers: outbound.length + returns.length,
    hotelOffers: hotels.length,
    combinations: all.length,
    afterDeadline: afterDeadline.length,
    afterBudget: afterBudget.length,
    feasible: ranked.length,
    rejected: {
      deadline: all.length - afterDeadline.length,
      budget: afterDeadline.length - afterBudget.length,
      otherConstraints: afterBudget.length - ranked.length,
    },
  };
  return { ranked, all, stats };
}

export { findMinimalRelaxation } from "./relaxation";
export { explainWinner } from "./explanation";
