import type { MissionConstraints } from "./schema";
import type { MissionSearchResult } from "./ports";

function offsetFromIso(iso: string | undefined) {
  return iso?.match(/([+-]\d{2}:\d{2}|Z)$/)?.[1] ?? null;
}

function mostFrequentOffset(values: Array<string | undefined>) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const offset = offsetFromIso(value);
    if (offset) counts.set(offset, (counts.get(offset) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function withOffset(localIso: string, offset: string) {
  return `${localIso.slice(0, 19)}${offset}`;
}

function shiftKeepingOffset(iso: string, minutes: number) {
  const offset = offsetFromIso(iso);
  if (!offset || offset === "Z") return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
  const match = offset.match(/([+-])(\d{2}):(\d{2})/)!;
  const offsetMinutes = (match[1] === "+" ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3]));
  const absolute = new Date(iso).getTime() + minutes * 60_000;
  const local = new Date(absolute + offsetMinutes * 60_000).toISOString().slice(0, 19);
  return `${local}${offset}`;
}

/** Uses normalized Tutu offer timestamps as the authority for route UTC offsets. */
export function groundMissionTimezones(constraints: MissionConstraints, search: MissionSearchResult): MissionConstraints {
  const destinationOffset = mostFrequentOffset(search.outbound.options.map((option) => option.arrivalAt));
  const originOffset = mostFrequentOffset([
    ...search.returns.options.map((option) => option.arrivalAt),
    ...search.outbound.options.map((option) => option.departureAt),
  ]);
  if (!destinationOffset) return constraints;

  const eventAt = withOffset(constraints.eventAt, destinationOffset);
  return {
    ...constraints,
    eventAt,
    latestArrivalAt: shiftKeepingOffset(eventAt, -constraints.arrivalBufferMin),
    returnEarliestDepartureAt: constraints.returnEarliestDepartureAt
      ? withOffset(constraints.returnEarliestDepartureAt, destinationOffset)
      : null,
    returnArrivalDeadline: constraints.returnArrivalDeadline && originOffset
      ? withOffset(constraints.returnArrivalDeadline, originOffset)
      : constraints.returnArrivalDeadline,
    timezone: `UTC${destinationOffset}`,
  };
}
