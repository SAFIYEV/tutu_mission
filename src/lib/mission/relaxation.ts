import { formatDuration, formatMoney, modeLabel } from "./format";
import type {
  MissionCandidate,
  MissionConstraints,
  RelaxationSuggestion,
  TransportMode,
  TransportOption,
} from "./schema";
import { candidatePassesTransport, createCandidate } from "./candidate";
import { verifyMission } from "./verifier";

const MODES: TransportMode[] = ["avia", "railway", "bus", "etrain"];

function chronological(candidate: MissionCandidate, constraints: MissionConstraints) {
  return (
    (!candidate.return || new Date(candidate.return.departureAt) >= new Date(candidate.outbound.arrivalAt)) &&
    (!candidate.return || !constraints.returnEarliestDepartureAt || new Date(candidate.return.departureAt) >= new Date(constraints.returnEarliestDepartureAt)) &&
    (!constraints.returnArrivalDeadline || Boolean(candidate.return))
  );
}

function withAdjustedBudget(constraints: MissionConstraints, maxBudget: number): MissionConstraints {
  const conversion = constraints.budgetConversion;
  return {
    ...constraints,
    maxBudget,
    budgetConversion: conversion ? {
      ...conversion,
      originalAmount: Math.ceil((maxBudget / conversion.rateRubPerUnit) * 100) / 100,
      rubAmount: maxBudget,
    } : conversion,
  };
}

function withCandidateTransport(constraints: MissionConstraints, candidate: MissionCandidate): MissionConstraints {
  const requiredModes = [...new Set([candidate.outbound.mode, candidate.return?.mode].filter(Boolean))] as TransportMode[];
  return {
    ...constraints,
    allowedTransport: [...new Set([...constraints.allowedTransport, ...requiredModes])],
    excludedTransport: constraints.excludedTransport.filter((mode) => !requiredModes.includes(mode)),
  };
}

function shiftIsoKeepingOffset(iso: string, minutes: number) {
  const offset = iso.match(/([+-])(\d{2}):(\d{2})$/);
  if (!offset) return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
  const direction = offset[1] === "+" ? 1 : -1;
  const offsetMinutes = direction * (Number(offset[2]) * 60 + Number(offset[3]));
  const shiftedAbsolute = new Date(iso).getTime() + minutes * 60_000;
  const localClock = new Date(shiftedAbsolute + offsetMinutes * 60_000).toISOString().slice(0, 19);
  return `${localClock}${offset[1]}${offset[2]}:${offset[3]}`;
}

export function findMinimalRelaxation(all: MissionCandidate[], constraints: MissionConstraints, outboundOptions: TransportOption[] = []): RelaxationSuggestion | null {
  const candidates: RelaxationSuggestion[] = [];
  const common = all.filter((candidate) => chronological(candidate, constraints));

  if (all.length === 0 && constraints.returnArrivalDeadline && outboundOptions.length > 0) {
    const adjustedConstraints = { ...constraints, returnEarliestDepartureAt: null, returnArrivalDeadline: null };
    const oneWayOption = outboundOptions
      .map((outbound) => createCandidate(outbound, null))
      .filter((candidate) => verifyMission(candidate, adjustedConstraints).verified)
      .sort((a, b) => a.totalPrice - b.totalPrice || a.totalDurationMin - b.totalDurationMin)[0];
    if (oneWayOption) {
      candidates.push({
        constraint: "return",
        title: "Искать поездку без обязательного возврата",
        detail: `Появится маршрут в одну сторону за ${formatMoney(oneWayOption.totalPrice)}`,
        delta: 7000,
        candidate: oneWayOption,
        adjustedConstraints,
      });
    }
  }

  if (constraints.maxBudget != null) {
    const option = common
      .filter((candidate) => candidate.totalPrice > constraints.maxBudget! && verifyMission(candidate, withAdjustedBudget(constraints, candidate.totalPrice)).verified)
      .sort((a, b) => a.totalPrice - b.totalPrice)[0];
    if (option) {
      const delta = Math.ceil(option.totalPrice - constraints.maxBudget);
      candidates.push({ constraint: "budget", title: `Добавить ${formatMoney(delta)} к бюджету`, detail: `Появится маршрут за ${formatMoney(option.totalPrice)}`, delta, candidate: option, adjustedConstraints: withAdjustedBudget(constraints, option.totalPrice) });
    }
  }

  const arrivalOption = common
    .filter((candidate) => new Date(candidate.outbound.arrivalAt) > new Date(constraints.latestArrivalAt))
    .map((candidate) => ({ candidate, delta: Math.ceil((new Date(candidate.outbound.arrivalAt).getTime() - new Date(constraints.latestArrivalAt).getTime()) / 60_000) }))
    .filter(({ candidate, delta }) => verifyMission(candidate, { ...constraints, latestArrivalAt: new Date(new Date(constraints.latestArrivalAt).getTime() + delta * 60_000).toISOString(), arrivalBufferMin: Math.max(0, constraints.arrivalBufferMin - delta) }).verified)
    .sort((a, b) => a.delta - b.delta)[0];
  if (arrivalOption) {
    const adjustedConstraints = { ...constraints, latestArrivalAt: new Date(new Date(constraints.latestArrivalAt).getTime() + arrivalOption.delta * 60_000).toISOString(), arrivalBufferMin: Math.max(0, constraints.arrivalBufferMin - arrivalOption.delta) };
    candidates.push({ constraint: "arrival", title: `Разрешить прибытие на ${formatDuration(arrivalOption.delta)} позже`, detail: "Появится выполнимый маршрут", delta: arrivalOption.delta * 30, candidate: arrivalOption.candidate, adjustedConstraints });
  }

  const transportOption = common
    .filter((candidate) => !candidatePassesTransport(candidate, constraints))
    .filter((candidate) => verifyMission(candidate, withCandidateTransport(constraints, candidate)).verified)
    .sort((a, b) => a.totalPrice - b.totalPrice)[0];
  if (transportOption) {
    const blockedMode = [transportOption.outbound, transportOption.return].find((option) => option && !candidatePassesTransport(createCandidate(option, null), constraints))?.mode ?? transportOption.outbound.mode;
    candidates.push({ constraint: "transport", title: `Разрешить: ${modeLabel[blockedMode].toLowerCase()}`, detail: `Появится маршрут за ${formatMoney(transportOption.totalPrice)}`, delta: 5000, candidate: transportOption, adjustedConstraints: withCandidateTransport(constraints, transportOption) });
  }

  const transferOption = common
    .filter((candidate) => candidate.transfers > constraints.maxTransfers)
    .filter((candidate) => verifyMission(candidate, { ...constraints, maxTransfers: candidate.transfers }).verified)
    .sort((a, b) => a.transfers - b.transfers)[0];
  if (transferOption) {
    const delta = transferOption.transfers - constraints.maxTransfers;
    candidates.push({ constraint: "transfers", title: `Разрешить ещё ${delta} пересадку`, detail: `Появится маршрут за ${formatMoney(transferOption.totalPrice)}`, delta: delta * 3000, candidate: transferOption, adjustedConstraints: { ...constraints, maxTransfers: transferOption.transfers } });
  }

  if (constraints.maxTripDurationMin != null) {
    const durationOption = common
      .filter((candidate) => candidate.totalDurationMin > constraints.maxTripDurationMin!)
      .filter((candidate) => verifyMission(candidate, { ...constraints, maxTripDurationMin: candidate.totalDurationMin }).verified)
      .sort((a, b) => a.totalDurationMin - b.totalDurationMin || a.totalPrice - b.totalPrice)[0];
    if (durationOption) {
      const extraMinutes = durationOption.totalDurationMin - constraints.maxTripDurationMin;
      candidates.push({
        constraint: "duration",
        title: `Разрешить ещё ${formatDuration(extraMinutes)} в пути`,
        detail: `Появится маршрут длительностью ${formatDuration(durationOption.totalDurationMin)}`,
        delta: extraMinutes * 20,
        candidate: durationOption,
        adjustedConstraints: { ...constraints, maxTripDurationMin: durationOption.totalDurationMin },
      });
    }
  }

  if (constraints.returnArrivalDeadline) {
    const returnOption = all
      .filter((candidate) => candidate.return && new Date(candidate.return.arrivalAt) > new Date(constraints.returnArrivalDeadline!))
      .map((candidate) => ({ candidate, delta: Math.ceil((new Date(candidate.return!.arrivalAt).getTime() - new Date(constraints.returnArrivalDeadline!).getTime()) / 60_000) }))
      .filter(({ candidate }) => verifyMission(candidate, { ...constraints, returnArrivalDeadline: candidate.return!.arrivalAt }).verified)
      .sort((a, b) => a.delta - b.delta)[0];
    if (returnOption) candidates.push({ constraint: "return", title: `Вернуться на ${formatDuration(returnOption.delta)} позже`, detail: "Появится выполнимый маршрут туда и обратно", delta: returnOption.delta * 25, candidate: returnOption.candidate, adjustedConstraints: { ...constraints, returnArrivalDeadline: returnOption.candidate.return!.arrivalAt } });
  }

  const single = candidates.sort((a, b) => a.delta - b.delta)[0];
  if (single) return single;

  const missingReturnCandidates = all.length === 0 && constraints.returnArrivalDeadline
    ? outboundOptions.map((outbound) => createCandidate(outbound, null))
    : [];
  const compoundPool = all.length > 0 ? all.filter((candidate) => chronological(candidate, constraints)) : missingReturnCandidates;
  const compound = compoundPool
    .map((candidate) => {
      const adjusted: MissionConstraints = {
        ...constraints,
        allowedTransport: [...constraints.allowedTransport],
        excludedTransport: [...constraints.excludedTransport],
      };
      const changes: Array<{ key: string; label: string }> = [];
      let severity = 0;

      if (!candidate.return && constraints.returnArrivalDeadline) {
        adjusted.returnEarliestDepartureAt = null;
        adjusted.returnArrivalDeadline = null;
        changes.push({ key: "return", label: "Убрать обязательный обратный маршрут" });
        severity += 2;
      }

      const blockedModes = [...new Set(
        [candidate.outbound.mode, candidate.return?.mode].filter(
          (mode): mode is TransportMode => Boolean(mode && (!constraints.allowedTransport.includes(mode) || constraints.excludedTransport.includes(mode))),
        ),
      )];
      if (blockedModes.length) {
        adjusted.allowedTransport = MODES;
        adjusted.excludedTransport = [];
        changes.push({ key: "transport", label: `Разрешить: ${blockedModes.map((mode) => modeLabel[mode].toLowerCase()).join(" и ")}` });
        severity += 1;
      }

      if (constraints.maxBudget != null && candidate.totalPrice > constraints.maxBudget) {
        const increase = Math.ceil(candidate.totalPrice - constraints.maxBudget);
        Object.assign(adjusted, withAdjustedBudget(adjusted, candidate.totalPrice));
        changes.push({ key: "budget", label: `Увеличить бюджет на ${formatMoney(increase)}` });
        severity += increase / Math.max(constraints.maxBudget, 1);
      }

      const actualBuffer = Math.floor((new Date(constraints.eventAt).getTime() - new Date(candidate.outbound.arrivalAt).getTime()) / 60_000);
      if (actualBuffer < 0) {
        const shiftedEventAt = shiftIsoKeepingOffset(candidate.outbound.arrivalAt, constraints.arrivalBufferMin);
        const delay = Math.ceil((new Date(shiftedEventAt).getTime() - new Date(constraints.eventAt).getTime()) / 60_000);
        adjusted.eventAt = shiftedEventAt;
        adjusted.latestArrivalAt = candidate.outbound.arrivalAt;
        if (adjusted.returnEarliestDepartureAt) adjusted.returnEarliestDepartureAt = shiftedEventAt;
        changes.push({ key: "event", label: `Сдвинуть событие на ${formatDuration(delay)} позже` });
        severity += delay / 180;
      } else if (actualBuffer < constraints.arrivalBufferMin) {
        const reduction = constraints.arrivalBufferMin - actualBuffer;
        adjusted.arrivalBufferMin = actualBuffer;
        adjusted.latestArrivalAt = candidate.outbound.arrivalAt;
        changes.push({ key: "arrival", label: `Уменьшить запас до события на ${formatDuration(reduction)}` });
        severity += reduction / Math.max(constraints.arrivalBufferMin, 60);
      }

      if (candidate.transfers > constraints.maxTransfers) {
        const extra = candidate.transfers - constraints.maxTransfers;
        adjusted.maxTransfers = candidate.transfers;
        changes.push({ key: "transfers", label: `Разрешить ещё ${extra} пересадку` });
        severity += extra;
      }

      if (constraints.returnArrivalDeadline && candidate.return && new Date(candidate.return.arrivalAt) > new Date(constraints.returnArrivalDeadline)) {
        const delay = Math.ceil((new Date(candidate.return.arrivalAt).getTime() - new Date(constraints.returnArrivalDeadline).getTime()) / 60_000);
        adjusted.returnArrivalDeadline = candidate.return.arrivalAt;
        changes.push({ key: "return", label: `Сдвинуть возврат на ${formatDuration(delay)} позже` });
        severity += delay / 180;
      }

      if (constraints.maxTripDurationMin != null && candidate.totalDurationMin > constraints.maxTripDurationMin) {
        adjusted.maxTripDurationMin = candidate.totalDurationMin;
        changes.push({ key: "duration", label: `Разрешить ${formatDuration(candidate.totalDurationMin)} суммарно в пути` });
        severity += 1;
      }

      if (changes.length < 2 || !verifyMission(candidate, adjusted).verified) return null;
      return { candidate, changes, severity, adjusted };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => a.changes.length - b.changes.length || a.severity - b.severity || a.candidate.totalPrice - b.candidate.totalPrice)[0];

  if (!compound) return null;
  return {
    constraint: "multiple",
    title: `Изменить ${compound.changes.length} условия`,
    detail: `После этого появится проверяемый маршрут за ${formatMoney(compound.candidate.totalPrice)}.`,
    delta: compound.severity,
    candidate: compound.candidate,
    adjustedConstraints: compound.adjusted,
    changes: compound.changes,
  };
}
