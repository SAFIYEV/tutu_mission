import type { MissionConstraints } from "./schema";
import type { MissionSearchResult } from "./ports";

function offsetFromIso(iso: string | undefined) {
  return iso?.match(/([+-]\d{2}:\d{2}|Z)$/)?.[1] ?? null;
}

export function cityTimeZone(city: string) {
  const normalized = city.toLocaleLowerCase("ru");
  const zones: Record<string, string> = {
    баку: "Asia/Baku", baku: "Asia/Baku", тбилиси: "Asia/Tbilisi", ереван: "Asia/Yerevan",
    стамбул: "Europe/Istanbul", дубай: "Asia/Dubai", алматы: "Asia/Almaty", астана: "Asia/Almaty",
    бишкек: "Asia/Bishkek", ташкент: "Asia/Tashkent", минск: "Europe/Minsk", калининград: "Europe/Kaliningrad",
    самара: "Europe/Samara", екатеринбург: "Asia/Yekaterinburg", омск: "Asia/Omsk", новосибирск: "Asia/Novosibirsk",
    красноярск: "Asia/Krasnoyarsk", иркутск: "Asia/Irkutsk", якутск: "Asia/Yakutsk", владивосток: "Asia/Vladivostok",
    магадан: "Asia/Magadan", петропавловсккамчатский: "Asia/Kamchatka", лондон: "Europe/London",
    париж: "Europe/Paris", берлин: "Europe/Berlin",
  };
  return zones[normalized.replace(/[ -]/g, "")] ?? zones[normalized] ?? "Europe/Moscow";
}

function zonedParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

function offsetForInstant(timeZone: string, instant: Date) {
  const part = zonedParts(instant, timeZone);
  const localAsUtc = Date.UTC(part.year, part.month - 1, part.day, part.hour, part.minute, part.second);
  const minutes = Math.round((localAsUtc - instant.getTime()) / 60_000);
  const sign = minutes >= 0 ? "+" : "-";
  const absolute = Math.abs(minutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

export function offsetForDate(timeZone: string, date: string) {
  return offsetForInstant(timeZone, new Date(`${date}T12:00:00Z`));
}

export function isoInTimeZone(iso: string, timeZone: string) {
  const instant = new Date(iso);
  const part = zonedParts(instant, timeZone);
  const local = `${part.year}-${String(part.month).padStart(2, "0")}-${String(part.day).padStart(2, "0")}T${String(part.hour).padStart(2, "0")}:${String(part.minute).padStart(2, "0")}:${String(part.second).padStart(2, "0")}`;
  return `${local}${offsetForInstant(timeZone, instant)}`;
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

/** Grounds wall-clock deadlines in city IANA zones, never in the caller/MCP offset. */
export function groundMissionTimezones(constraints: MissionConstraints, search: MissionSearchResult): MissionConstraints {
  void search;
  const destinationZone = cityTimeZone(constraints.destination);
  const originZone = cityTimeZone(constraints.origin);
  const destinationOffset = offsetForDate(destinationZone, constraints.eventAt.slice(0, 10));

  const eventAt = withOffset(constraints.eventAt, destinationOffset);
  return {
    ...constraints,
    eventAt,
    latestArrivalAt: shiftKeepingOffset(eventAt, -constraints.arrivalBufferMin),
    returnEarliestDepartureAt: constraints.returnEarliestDepartureAt
      ? withOffset(constraints.returnEarliestDepartureAt, destinationOffset)
      : null,
    returnArrivalDeadline: constraints.returnArrivalDeadline
      ? withOffset(constraints.returnArrivalDeadline, offsetForDate(originZone, constraints.returnArrivalDeadline.slice(0, 10)))
      : constraints.returnArrivalDeadline,
    timezone: destinationZone,
  };
}
