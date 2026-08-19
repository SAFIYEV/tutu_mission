import { missionConstraintsSchema, type MissionConstraints, type TransportMode } from "./schema";
import { cityTimeZone, offsetForDate } from "./timezone";

const ALL_MODES: TransportMode[] = ["avia", "railway", "bus", "etrain"];
const CITY = "([А-ЯЁA-Z][А-Яа-яЁёA-Za-z-]+(?:[ -][А-ЯЁA-Z][А-Яа-яЁёA-Za-z-]+){0,2})";

export class MissionClarificationError extends Error {
  readonly code = "MISSION_NEEDS_CLARIFICATION";

  constructor(readonly questions: string[]) {
    super("Нужно уточнить условия поездки.");
    this.name = "MissionClarificationError";
  }
}

export class MissionUnsupportedError extends Error {
  readonly code = "MISSION_UNSUPPORTED";

  constructor(readonly details: string[]) {
    super("Часть условий пока нельзя проверить надёжно.");
    this.name = "MissionUnsupportedError";
  }
}

function datePartsInZone(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function cityClock(city: string) {
  return { zone: cityTimeZone(city) };
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function parseRelativeDayOffset(text: string) {
  const match = text.match(
    /(?:через|спустя)\s+(\d+|один|одну|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять|неделю)\s*(д(?:ень|ня|ней)?|сут(?:ки|ок)?|недел(?:ю|и|ь)?)?/i,
  );
  if (!match) return null;

  const wordNumber: Record<string, number> = {
    один: 1, одну: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5,
    шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10, неделю: 1,
  };
  const amount = wordNumber[match[1].toLowerCase()] ?? Number(match[1]);
  const unit = `${match[1]} ${match[2] ?? ""}`.toLowerCase();
  return amount * (unit.includes("недел") ? 7 : 1);
}

function parseHour(text: string) {
  const matches = [...text.matchAll(/(?:к|до)\s*(\d{1,2})(?::(\d{2}))?/gi)];
  const contextual = text.match(/(?:быть|приехать|успеть|событи\w*)[^.!?]{0,50}?(?:в|к|до)\s*(\d{1,2})(?::(\d{2}))?/i);
  const match = matches.find((item) => Number(item[1]) <= 23 && Number(item[2] ?? 0) <= 59) ?? contextual;
  if (!match) return null;
  if (Number(match[1]) > 23 || Number(match[2] ?? 0) > 59) return null;
  return `${match[1].padStart(2, "0")}:${match[2] ?? "00"}`;
}

function parseEventDate(text: string, today: string) {
  if (/(?:^|[^а-яё])послезавтра(?:$|[^а-яё])/i.test(text)) return addDays(today, 2);
  if (/(?:^|[^а-яё])завтра(?:$|[^а-яё])/i.test(text)) return addDays(today, 1);
  if (/(?:^|[^а-яё])сегодня(?:$|[^а-яё])/i.test(text)) return today;
  const numeric = text.match(/\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b/);
  if (numeric) {
    const year = numeric[3] ? (numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]) : today.slice(0, 4);
    const date = `${year}-${numeric[2].padStart(2, "0")}-${numeric[1].padStart(2, "0")}`;
    return Number.isNaN(new Date(`${date}T12:00:00Z`).getTime()) ? null : date;
  }
  const months: Record<string, number> = { января: 1, февраля: 2, марта: 3, апреля: 4, мая: 5, июня: 6, июля: 7, августа: 8, сентября: 9, октября: 10, ноября: 11, декабря: 12 };
  const named = text.match(/\b(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s+(\d{4}))?/i);
  if (named) return `${named[3] ?? today.slice(0, 4)}-${String(months[named[2].toLowerCase()]).padStart(2, "0")}-${named[1].padStart(2, "0")}`;
  const weekdays: Record<string, number> = { воскресенье: 0, воскресенья: 0, понедельник: 1, понедельника: 1, вторник: 2, вторника: 2, среду: 3, среды: 3, четверг: 4, четверга: 4, пятницу: 5, пятницы: 5, субботу: 6, субботы: 6 };
  const weekday = text.match(/(?:в|к)\s+(воскресенье|воскресенья|понедельник|понедельника|вторник|вторника|среду|среды|четверг|четверга|пятницу|пятницы|субботу|субботы)/i)?.[1]?.toLowerCase();
  if (weekday) {
    const current = new Date(`${today}T12:00:00Z`).getUTCDay();
    const delta = (weekdays[weekday] - current + 7) % 7 || 7;
    return addDays(today, delta);
  }
  return null;
}

function cityFrom(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return normalizeCity(match[1]);
    }
  }
  return null;
}

function normalizeCity(value: string) {
  const city = value
    .trim()
    .replace(/\s+(?:сегодня|завтра|послезавтра|до|к|бюджет|без|только)(?:\s|$).*$/i, "")
    .replace(/[.,]$/, "");
  const normalized: Record<string, string> = {
    москвы: "Москва",
    москве: "Москва",
    москву: "Москва",
    казани: "Казань",
    казань: "Казань",
    екатеринбурга: "Екатеринбург",
    екатеринбурге: "Екатеринбург",
    владивостока: "Владивосток",
    владивостоке: "Владивосток",
    парижа: "Париж",
    париже: "Париж",
    баку: "Баку",
    питера: "Санкт-Петербург",
    питере: "Санкт-Петербург",
    петербурга: "Санкт-Петербург",
    петербурге: "Санкт-Петербург",
    "санкт-петербурга": "Санкт-Петербург",
    "санкт-петербурге": "Санкт-Петербург",
  };
  return normalized[city.toLowerCase()] ?? city;
}

export function parseMissionDeterministically(text: string, now = new Date()): MissionConstraints {
  const unsupported: string[] = [];
  if (/(?:через\s+(?!(?:\d+|один|одну|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять|недел)(?=\s|$))[А-ЯЁA-Z]|несколько город|мульти-сити)/i.test(text)) unsupported.push("Маршрут через несколько городов пока не собирается в единый проверяемый план.");
  if (/(?:инвалидн|коляск|питом|собак|кошк|велосипед|негабарит)/i.test(text)) unsupported.push("Специальные требования к доступности, животным или багажу отсутствуют в нормализованных данных всех видов транспорта.");
  if (unsupported.length) throw new MissionUnsupportedError(unsupported);

  const routePair = text.match(new RegExp(`(?:из|от)\\s+${CITY}\\s+(?:в|до)\\s+${CITY}`, "i"));
  const reverseRoutePair = text.match(new RegExp(`(?:в|до)\\s+${CITY}\\s+(?:из|от)\\s+${CITY}`, "i"));
  const dashPair = text.match(new RegExp(`(?:маршрут\\s+)?${CITY}\\s*(?:→|—|->)\\s*${CITY}`, "i"));
  const origin = routePair?.[1] ? normalizeCity(routePair[1]) : reverseRoutePair?.[2] ? normalizeCity(reverseRoutePair[2]) : dashPair?.[1] ? normalizeCity(dashPair[1]) : cityFrom(text, [
    new RegExp(`(?:нахожусь|сейчас|я)\\s+в\\s+${CITY}`, "i"),
    new RegExp(`из\\s+${CITY}`, "i"),
  ]);
  const destination = routePair?.[2] ? normalizeCity(routePair[2]) : reverseRoutePair?.[1] ? normalizeCity(reverseRoutePair[1]) : dashPair?.[2] ? normalizeCity(dashPair[2]) : cityFrom(text, [
    new RegExp(`(?:быть|оказаться|успеть|приехать)\\s+в(?:о)?\\s+${CITY}`, "i"),
    new RegExp(`(?:доехать|поехать|еду)\\s+в(?:о)?\\s+${CITY}`, "i"),
  ]);
  const questions: string[] = [];
  if (!origin) questions.push("Из какого города вы отправляетесь?");
  if (!destination) questions.push("В какой город вам нужно приехать?");
  if (questions.length) throw new MissionClarificationError(questions);
  if (origin!.toLowerCase() === destination!.toLowerCase()) {
    throw new MissionClarificationError(["Город отправления и назначения совпадают. Уточните конечную точку поездки."]);
  }

  if (/(?:реб[её]нок|дети|детей|младенец)/i.test(text)) {
    throw new MissionUnsupportedError(["Детские тарифы требуют отдельных профильных поисков по возрастам; нельзя рассчитывать детей как взрослых."]);
  }

  const originClock = cityClock(origin!);
  const destinationClock = cityClock(destination!);
  const today = datePartsInZone(now, originClock.zone);
  const eventDate = parseEventDate(text, today);
  const eventTime = parseHour(text);
  if (!eventDate) questions.push("В какой день нужно прибыть? Например: «завтра» или «12.08.2026».");
  if (!eventTime) questions.push("К какому точному времени нужно прибыть?");
  if (questions.length) throw new MissionClarificationError(questions);
  const eventAt = `${eventDate}T${eventTime}:00${offsetForDate(destinationClock.zone, eventDate!)}`;
  if (new Date(eventAt).getTime() <= now.getTime()) {
    throw new MissionClarificationError(["Указанный дедлайн уже прошёл. Назовите будущую дату и время."]);
  }

  const bufferMatch = text.match(/(?:минимум(?:\s+за)?|запас(?:ом)?(?:\s+в)?)\s*(\d+(?:[.,]\d+)?|один|одна|два|две|три|четыре)\s*(час|ч\b|мин)/i)
    ?? text.match(/за\s*(\d+(?:[.,]\d+)?|один|одна|два|две|три|четыре)\s*(час|ч\b|мин)[^.!?]{0,18}до\s*(?:событ|встреч)/i);
  const wordNumber: Record<string, number> = { один: 1, одна: 1, два: 2, две: 2, три: 3, четыре: 4 };
  const bufferValue = bufferMatch ? (wordNumber[bufferMatch[1].toLowerCase()] ?? Number(bufferMatch[1].replace(",", "."))) : 0;
  const arrivalBufferMin = bufferMatch?.[2].toLowerCase().startsWith("мин") ? Math.round(bufferValue) : Math.round(bufferValue * 60);
  const latestArrivalAt = new Date(new Date(eventAt).getTime() - arrivalBufferMin * 60_000).toISOString();

  const budgetMatch = text.match(/(?:бюджет(?:ом)?|до)\s*(\d[\d\s]{2,})\s*(?:₽|руб)/i);
  const maxBudget = budgetMatch ? Number(budgetMatch[1].replace(/\s/g, "")) : null;
  const excludedTransport: TransportMode[] = [];
  if (/(?:без|не хочу|исключить)\s+(?:самол[её]т|авиа)|самол[её]том\s+не/i.test(text)) excludedTransport.push("avia");
  if (/(?:без|не хочу)\s+(?:автобус)/i.test(text)) excludedTransport.push("bus");
  if (/(?:без|не хочу)\s+(?:поезд)/i.test(text)) excludedTransport.push("railway");
  const onlyModeMatch = text.match(/только\s+(?:на\s+)?(самол[её]т\w*|поезд\w*|автобус\w*|электрич\w*)/i)?.[1]?.toLowerCase();
  const onlyMode: TransportMode | null = onlyModeMatch?.startsWith("самол") ? "avia" : onlyModeMatch?.startsWith("поезд") ? "railway" : onlyModeMatch?.startsWith("автобус") ? "bus" : onlyModeMatch?.startsWith("электр") ? "etrain" : null;
  if (onlyMode && excludedTransport.includes(onlyMode)) {
    throw new MissionClarificationError(["Запрос одновременно требует и запрещает один и тот же вид транспорта. Какое условие оставить?"]);
  }
  const allowedTransport = onlyMode ? [onlyMode] : ALL_MODES.filter((mode) => !excludedTransport.includes(mode));
  if (!allowedTransport.length) throw new MissionClarificationError(["Все виды транспорта исключены. Какой транспорт всё-таки можно использовать?"]);

  const transfersMatch = text.match(/(?:не более|max(?:imum)?|до)\s*(\d+)\s*пересад/i);
  const maxTransfers = /без пересад/i.test(text) ? 0 : transfersMatch ? Number(transfersMatch[1]) : 6;
  const wantsReturn = !/(?:в одну сторону|обратно не надо|без возврата)/i.test(text) && /обратно|вернут|возврат/i.test(text);
  const returnSection = text.match(/(?:обратно|вернут\w*|возврат)[\s\S]*/i)?.[0] ?? "";
  const relativeReturnOffsetDays = parseRelativeDayOffset(returnSection);
  const parsedReturnDate = parseEventDate(returnSection, today);
  const normalizedText = text.toLocaleLowerCase("ru");
  const nextMorning = normalizedText.includes("следующ") && normalizedText.includes("утр");
  let returnDate = relativeReturnOffsetDays != null
    ? addDays(eventDate!, relativeReturnOffsetDays)
    : parsedReturnDate ?? addDays(eventDate!, nextMorning ? 1 : 0);
  // “Следующим утром” is always the calendar day after the event, even if
  // another relative-date token elsewhere in the return sentence was matched.
  if (nextMorning && returnDate <= eventDate!) returnDate = addDays(eventDate!, 1);
  const returnTimeMatch = text.match(/(?:вернут\w*|обратно)[^.!?]{0,40}?(?:до|к)\s*(\d{1,2})(?::(\d{2}))?/i);
  if (wantsReturn && !returnTimeMatch && !nextMorning && relativeReturnOffsetDays == null) {
    throw new MissionClarificationError(["До какого точного времени нужно вернуться домой?"]);
  }
  // A relative calendar deadline without a clock means any time during that day.
  // Using 23:59 preserves the user's intent without silently narrowing the window.
  const returnTime = returnTimeMatch
    ? `${returnTimeMatch[1].padStart(2, "0")}:${returnTimeMatch[2] ?? "00"}`
    : relativeReturnOffsetDays != null ? "23:59" : "12:00";
  if (wantsReturn && returnTimeMatch && !parsedReturnDate && !nextMorning && returnTime <= eventTime!) {
    throw new MissionClarificationError(["В какой день нужно вернуться домой?"]);
  }
  const adultsMatch = text.match(/(\d+)\s*(?:взросл\w*|человек\w*|пассажир\w*)/i);
  const adults = adultsMatch ? Number(adultsMatch[1]) : 1;
  if (adults > 9) throw new MissionUnsupportedError(["За один поиск Tutu принимает не более 9 взрослых пассажиров."]);
  const wantsHotel = /(?:отел|гостиниц|хостел|апартамент|ноч[её]вк)/i.test(text);
  if (wantsHotel && adults > 6) {
    throw new MissionUnsupportedError(["Поиск отелей Туту поддерживает до 6 взрослых гостей за один запрос."]);
  }
  const starMatch = text.match(/([1-5])\s*(?:[-–—]\s*([1-5]))?\s*(?:зв[её]зд|★)/i);
  const stars = starMatch ? numberRange(Number(starMatch[1]), Number(starMatch[2] ?? starMatch[1])) : null;
  const ratingMatch = text.match(/рейтинг(?:ом)?\s*(?:от|не ниже|≥)?\s*(\d+(?:[.,]\d+)?)/i);
  const minRating = ratingMatch ? Number(ratingMatch[1].replace(",", ".")) : null;
  const breakfastIncluded = /(?:с\s+завтраком|завтрак\s+включ)/i.test(text) ? true : null;
  const freeCancellation = /(?:бесплатн\w*\s+отмен|свободн\w*\s+отмен)/i.test(text) ? true : null;
  const hotelTypes = /хостел/i.test(text) ? ["hostel"]
    : /апартамент/i.test(text) ? ["apartments", "aparthotel"]
      : /гостиниц|отел/i.test(text) ? ["hotel"] : null;
  const delegatedHotelChoice = /(?:сам(?:ый|ую)?\s+деш[её]в|выбери\s+сам|подбери\s+сам|любой\s+отель|лишь\s+бы\s+переночевать|просто\s+переночевать|(?:отел|гостиниц)[^.!?]{0,24}(?:найди|подбери|выбери))/i.test(text);
  if (wantsHotel && !delegatedHotelChoice && !stars && minRating == null && breakfastIncluded == null && freeCancellation == null && !/хостел|апартамент/i.test(text)) {
    throw new MissionClarificationError([
      "Какой тип и уровень отеля нужен: звёздность или минимальный рейтинг?",
      "Нужны ли завтрак и бесплатная отмена?",
      "Если предпочтений нет, напишите «подбери сам».",
    ]);
  }
  const nightsMatch = text.match(/(?:на\s+)?(\d+)\s*ноч(?:ь|и|ей)/i);
  const hotelNights = nightsMatch ? Number(nightsMatch[1]) : null;
  if (wantsHotel && !wantsReturn && hotelNights == null) {
    throw new MissionClarificationError(["На сколько ночей нужен отель?"]);
  }
  const hotelCheckOut = hotelNights != null ? addDays(eventDate!, hotelNights) : returnDate;
  if (wantsHotel && hotelCheckOut <= eventDate!) {
    throw new MissionClarificationError([`Дата выезда из отеля должна быть позже даты заселения (${eventDate} → ${hotelCheckOut}).`]);
  }
  const durationMatch = text.match(/(?:не больше|не более|максимум)\s*(\d+(?:[.,]\d+)?)\s*(?:час|ч\b)[^.!?]{0,20}(?:в пути|дорог)/i);
  const maxTripDurationMin = durationMatch ? Math.round(Number(durationMatch[1].replace(",", ".")) * 60) : null;
  const daysUntilEvent = Math.round((new Date(`${eventDate}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime()) / 86_400_000);
  if (daysUntilEvent > 14 && maxTripDurationMin == null) {
    throw new MissionClarificationError(["Событие больше чем через две недели. Какую максимальную длительность пути рассматривать?"]);
  }
  const returnSpanDays = Math.round((new Date(`${returnDate}T12:00:00Z`).getTime() - new Date(`${eventDate}T12:00:00Z`).getTime()) / 86_400_000);
  if (wantsReturn && returnSpanDays > 14) {
    throw new MissionClarificationError(["Окно возврата шире двух недель. Уточните более узкий день или диапазон возврата."]);
  }

  return missionConstraintsSchema.parse({
    origin: origin!,
    destination: destination!,
    eventAt,
    latestArrivalAt,
    arrivalBufferMin,
    returnEarliestDepartureAt: wantsReturn ? eventAt : null,
    returnArrivalDeadline: wantsReturn ? `${returnDate}T${returnTime}:00${offsetForDate(originClock.zone, returnDate)}` : null,
    maxBudget,
    allowedTransport,
    excludedTransport,
    maxTransfers,
    maxTripDurationMin,
    passengers: { adults },
    timezone: destinationClock.zone,
    accommodation: wantsHotel ? {
      checkIn: eventDate!,
      checkOut: hotelCheckOut,
      stars,
      minRating,
      breakfastIncluded,
      freeCancellation,
      hotelTypes,
    } : null,
  });
}

function numberRange(start: number, end: number) {
  const lower = Math.min(start, end);
  const upper = Math.max(start, end);
  return Array.from({ length: upper - lower + 1 }, (_, index) => lower + index);
}
