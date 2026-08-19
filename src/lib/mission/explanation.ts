import { formatDuration, formatTransfers, modeLabel } from "./format";
import type { MissionCandidate, MissionConstraints } from "./schema";

export function explainWinner(winner: MissionCandidate, constraints: MissionConstraints) {
  const buffer = Math.floor((new Date(constraints.eventAt).getTime() - new Date(winner.outbound.arrivalAt).getTime()) / 60_000);
  const mode = modeLabel[winner.outbound.mode].toLowerCase();
  const stay = winner.hotel ? ` В общую стоимость включён отель «${winner.hotel.name}» на ${winner.hotel.nights} ноч.` : "";
  return `Мы выбрали ${mode}: маршрут укладывается в бюджет, даёт ${formatDuration(buffer)} запаса до события и требует ${winner.transfers ? formatTransfers(winner.transfers) : "ни одной пересадки"}.${stay} Лучший вариант определён программной оценкой цены, времени, пересадок и удобства.`;
}
