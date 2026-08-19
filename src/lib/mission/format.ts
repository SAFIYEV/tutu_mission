import type { TransportMode } from "./schema";

export const modeLabel: Record<TransportMode, string> = {
  avia: "Самолёт",
  railway: "Поезд",
  bus: "Автобус",
  etrain: "Электричка",
};

export function formatMoney(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value) + " ₽";
}

export function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (!hours) return `${mins} мин`;
  if (!mins) return `${hours} ч`;
  return `${hours} ч ${mins} мин`;
}

export function formatTransfers(value: number) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  const noun = mod10 === 1 && mod100 !== 11 ? "пересадка" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "пересадки" : "пересадок";
  return `${value} ${noun}`;
}

export function formatTime(iso: string) {
  const wallClock = iso.match(/T(\d{2}:\d{2})/)?.[1];
  if (wallClock) return wallClock;
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}
