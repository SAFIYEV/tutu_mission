import { formatDuration, formatMoney, modeLabel } from "./format";
import type { MissionCandidate, MissionConstraints, VerificationCheck, VerificationResult } from "./schema";

function minutesBetween(later: string, earlier: string) {
  return Math.floor((new Date(later).getTime() - new Date(earlier).getTime()) / 60_000);
}

export function verifyMission(candidate: MissionCandidate, constraints: MissionConstraints): VerificationResult {
  const actualBuffer = minutesBetween(constraints.eventAt, candidate.outbound.arrivalAt);
  const modes = [candidate.outbound.mode, candidate.return?.mode].filter(Boolean);
  const transportPassed = modes.every((mode) => mode && constraints.allowedTransport.includes(mode) && !constraints.excludedTransport.includes(mode));
  const checks: VerificationCheck[] = [
    {
      key: "chronology",
      label: "Этапы поездки идут в правильном порядке",
      passed: new Date(candidate.outbound.departureAt) < new Date(candidate.outbound.arrivalAt) && Boolean(
        !candidate.return || (
          new Date(candidate.return.departureAt) < new Date(candidate.return.arrivalAt) &&
          new Date(candidate.return.departureAt) >= new Date(candidate.outbound.arrivalAt)
        ),
      ),
    },
    {
      key: "arrival",
      label: "Прибытие до допустимого времени",
      passed: new Date(candidate.outbound.arrivalAt) <= new Date(constraints.latestArrivalAt),
      actual: candidate.outbound.arrivalAt,
      limit: constraints.latestArrivalAt,
    },
    {
      key: "buffer",
      label: `Запас до события: ${formatDuration(Math.max(0, actualBuffer))}`,
      passed: actualBuffer >= constraints.arrivalBufferMin,
      actual: String(actualBuffer),
      limit: String(constraints.arrivalBufferMin),
    },
    {
      key: "budget",
      label: constraints.maxBudget ? `Бюджет: ${formatMoney(candidate.totalPrice)} / ${formatMoney(constraints.maxBudget)}` : `Стоимость: ${formatMoney(candidate.totalPrice)}`,
      passed: constraints.maxBudget == null || candidate.totalPrice <= constraints.maxBudget,
      actual: String(candidate.totalPrice),
      limit: constraints.maxBudget == null ? undefined : String(constraints.maxBudget),
    },
    {
      key: "transport",
      label: `Транспорт: ${modes.map((mode) => mode && modeLabel[mode]).join(" + ")}`,
      passed: transportPassed,
    },
    {
      key: "transfers",
      label: `Пересадок: ${candidate.transfers}`,
      passed: candidate.transfers <= constraints.maxTransfers,
      actual: String(candidate.transfers),
      limit: String(constraints.maxTransfers),
    },
    {
      key: "duration",
      label: `В пути: ${formatDuration(candidate.totalDurationMin)}`,
      passed: constraints.maxTripDurationMin == null || candidate.totalDurationMin <= constraints.maxTripDurationMin,
    },
  ];

  if (constraints.accommodation) {
    const hotel = candidate.hotel;
    const preferencesPassed = Boolean(hotel)
      && (!constraints.accommodation.stars || constraints.accommodation.stars.includes(hotel!.stars ?? -1))
      && (constraints.accommodation.minRating == null || (hotel!.rating ?? -1) >= constraints.accommodation.minRating)
      && (constraints.accommodation.breakfastIncluded !== true || hotel!.breakfastIncluded === true)
      && (constraints.accommodation.freeCancellation !== true || hotel!.freeCancellation === true);
    const stayFitsTrip = Boolean(
      hotel
      && new Date(candidate.outbound.arrivalAt).getTime() < new Date(`${hotel.checkOut}T23:59:59Z`).getTime()
      && (!candidate.return || candidate.return.departureAt.slice(0, 10) >= hotel.checkOut),
    );
    checks.push({
      key: "hotel",
      label: hotel ? `Отель: ${hotel.name} · ${hotel.nights} ноч.` : "Отель найден",
      passed: Boolean(
        hotel
        && hotel.checkIn === constraints.accommodation.checkIn
        && hotel.checkOut === constraints.accommodation.checkOut
        && preferencesPassed
        && stayFitsTrip
      ),
      actual: hotel ? `${hotel.checkIn} — ${hotel.checkOut}` : undefined,
      limit: `${constraints.accommodation.checkIn} — ${constraints.accommodation.checkOut}`,
    });
  }

  if (constraints.returnArrivalDeadline) {
    checks.push({
      key: "return",
      label: candidate.return ? "Возвращение в срок" : "Обратный маршрут найден",
      passed: Boolean(
        candidate.return &&
          new Date(candidate.return.arrivalAt) <= new Date(constraints.returnArrivalDeadline) &&
          (!constraints.returnEarliestDepartureAt || new Date(candidate.return.departureAt) >= new Date(constraints.returnEarliestDepartureAt)),
      ),
      actual: candidate.return?.arrivalAt,
      limit: constraints.returnArrivalDeadline,
    });
  }

  return { verified: checks.every((check) => check.passed), checks };
}
