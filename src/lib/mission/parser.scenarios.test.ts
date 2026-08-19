import { describe, expect, it } from "vitest";
import { parseMissionDeterministically } from "./parser";

const now = new Date("2026-08-08T08:00:00Z");

describe("Russian mission prompt corpus", () => {
  const scenarios = [
    {
      name: "classic Moscow to Saint Petersburg round trip",
      text: "Завтра к 18:00 мне нужно быть в Санкт-Петербурге. Я нахожусь в Москве. Бюджет до 15 000 ₽, без самолёта, приехать минимум за два часа и вернуться следующим утром.",
      expected: { origin: "Москва", destination: "Санкт-Петербург", hour: "18:00", budget: 15_000, buffer: 120, returnRequired: true },
    },
    {
      name: "Baku to Yekaterinburg with manat budget",
      text: "Завтра к 14:15 мне нужно быть в Екатеринбурге. Я нахожусь в Баку. Бюджет до 2000 манатов, без самолёта, вернуться следующим утром.",
      expected: { origin: "Баку", destination: "Екатеринбург", hour: "14:15", budget: null, buffer: 0, returnRequired: true },
    },
    {
      name: "explicit route pair and one way",
      text: "Из Москвы в Казань завтра до 20:30, только поездом, в одну сторону.",
      expected: { origin: "Москва", destination: "Казань", hour: "20:30", budget: null, buffer: 0, returnRequired: false },
    },
    {
      name: "reverse city order",
      text: "Завтра к 09:45 нужно приехать в Москву из Казани, без автобуса.",
      expected: { origin: "Казань", destination: "Москва", hour: "09:45", budget: null, buffer: 0, returnRequired: false },
    },
    {
      name: "dash route and transfer limit",
      text: "Москва → Санкт-Петербург, завтра к 16:20, не более 1 пересадки.",
      expected: { origin: "Москва", destination: "Санкт-Петербург", hour: "16:20", budget: null, buffer: 0, returnRequired: false },
    },
    {
      name: "international destination timezone",
      text: "Завтра к 19:00 мне нужно быть в Тбилиси. Я нахожусь в Баку. Бюджет до 900 манатов.",
      expected: { origin: "Баку", destination: "Тбилиси", hour: "19:00", budget: null, buffer: 0, returnRequired: false },
    },
    {
      name: "far eastern timezone",
      text: "Завтра к 13:00 мне нужно быть во Владивостоке. Я нахожусь в Москве. Только самолётом.",
      expected: { origin: "Москва", destination: "Владивосток", hour: "13:00", budget: null, buffer: 0, returnRequired: false },
    },
  ] as const;

  for (const scenario of scenarios) {
    it(scenario.name, () => {
      const parsed = parseMissionDeterministically(scenario.text, now);
      expect(parsed.origin).toBe(scenario.expected.origin);
      expect(parsed.destination).toBe(scenario.expected.destination);
      expect(parsed.eventAt.slice(11, 16)).toBe(scenario.expected.hour);
      expect(parsed.maxBudget).toBe(scenario.expected.budget);
      expect(parsed.arrivalBufferMin).toBe(scenario.expected.buffer);
      expect(Boolean(parsed.returnArrivalDeadline)).toBe(scenario.expected.returnRequired);
    });
  }

  it("uses seasonal IANA offsets rather than a hard-coded European offset", () => {
    const summer = parseMissionDeterministically("Завтра к 18:00 мне нужно быть в Париже. Я нахожусь в Москве.", now);
    const winter = parseMissionDeterministically("Завтра к 18:00 мне нужно быть в Париже. Я нахожусь в Москве.", new Date("2026-12-10T08:00:00Z"));
    expect(summer.eventAt.endsWith("+02:00")).toBe(true);
    expect(winter.eventAt.endsWith("+01:00")).toBe(true);
  });

  it("counts a relative return from the stated trip date", () => {
    const parsed = parseMissionDeterministically(
      "Завтра к 18:00 мне нужно быть в Санкт-Петербурге. Я нахожусь в Москве. Вернуться через 5 дней. Отель тоже найди.",
      new Date("2026-08-14T08:00:00Z"),
    );

    expect(parsed.eventAt).toBe("2026-08-15T18:00:00+03:00");
    expect(parsed.returnArrivalDeadline).toBe("2026-08-20T23:59:00+03:00");
    expect(parsed.accommodation).toMatchObject({ checkIn: "2026-08-15", checkOut: "2026-08-20" });
  });

  it.each([
    ["через два дня", "2026-08-17T23:59:00+03:00"],
    ["спустя неделю", "2026-08-22T23:59:00+03:00"],
  ])("understands the relative return phrase %s", (phrase, expected) => {
    const parsed = parseMissionDeterministically(
      `Завтра к 18:00 мне нужно быть в Казани из Москвы. Вернуться ${phrase}.`,
      new Date("2026-08-14T08:00:00Z"),
    );

    expect(parsed.returnArrivalDeadline).toBe(expected);
  });
});
