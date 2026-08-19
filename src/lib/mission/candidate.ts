import type { HotelOption, MissionCandidate, MissionConstraints, TransportOption } from "./schema";

const MAX_OPTIONS_PER_DIRECTION = 80;

export function createCandidate(outbound: TransportOption, returnOption: TransportOption | null, hotel: HotelOption | null = null): MissionCandidate {
  return {
    id: `${outbound.id}:${returnOption?.id ?? "one-way"}`,
    outbound,
    return: returnOption,
    hotel,
    totalPrice: outbound.price + (returnOption?.price ?? 0) + (hotel?.price ?? 0),
    totalDurationMin: outbound.durationMin + (returnOption?.durationMin ?? 0),
    transfers: outbound.transfers + (returnOption?.transfers ?? 0),
    score: 0,
  };
}

export function createCandidatePool(
  outbound: TransportOption[],
  returns: TransportOption[],
  needsReturn: boolean,
  hotels: HotelOption[] = [],
  needsHotel = false,
) {
  const boundedOutbound = keepBest(outbound);
  const stays = needsHotel ? keepBestHotels(hotels) : [null];
  if (needsHotel && stays.length === 0) return [];
  if (!needsReturn) return boundedOutbound.flatMap((option) => stays.map((hotel) => createCandidate(option, null, hotel)));
  const boundedReturns = keepBest(returns);
  return boundedOutbound.flatMap((out) => boundedReturns.flatMap((back) => stays.map((hotel) => createCandidate(out, back, hotel))));
}

export function candidatePassesTransport(candidate: MissionCandidate, constraints: MissionConstraints) {
  return [candidate.outbound, candidate.return].filter(Boolean).every((option) => {
    const mode = option!.mode;
    return constraints.allowedTransport.includes(mode) && !constraints.excludedTransport.includes(mode);
  });
}

function keepBest(options: TransportOption[]) {
  return [...options]
    .sort((a, b) => a.price - b.price || a.durationMin - b.durationMin || a.transfers - b.transfers)
    .slice(0, MAX_OPTIONS_PER_DIRECTION);
}

function keepBestHotels(options: HotelOption[]) {
  return [...options]
    .sort((a, b) => a.price - b.price || (b.rating ?? 0) - (a.rating ?? 0))
    .slice(0, 8);
}
