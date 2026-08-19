import type { MissionCandidate, MissionConstraints } from "./schema";

/** Deterministic soft ranking applied only after every hard constraint passes. */
export function scoreCandidate(candidate: MissionCandidate, constraints: MissionConstraints) {
  const budgetBase = constraints.maxBudget ?? Math.max(candidate.totalPrice, 1);
  const pricePenalty = Math.min(35, (candidate.totalPrice / budgetBase) * 30);
  const durationPenalty = Math.min(30, (candidate.totalDurationMin / 1440) * 30);
  const transferPenalty = candidate.transfers * 12;
  const extraBufferHours = Math.max(0, (new Date(constraints.latestArrivalAt).getTime() - new Date(candidate.outbound.arrivalAt).getTime()) / 3_600_000);
  const earlyPenalty = Math.min(32, extraBufferHours * 2.4);
  const comfortPenalty = candidate.outbound.mode === "bus" ? 10 : candidate.outbound.mode === "etrain" ? 3 : 0;
  const hotelQualityBonus = candidate.hotel ? Math.min(8, Math.max(0, (candidate.hotel.rating ?? 7) - 7) * 2) : 0;
  return Math.round((100 - pricePenalty - durationPenalty - transferPenalty - earlyPenalty - comfortPenalty + hotelQualityBonus) * 10) / 10;
}
