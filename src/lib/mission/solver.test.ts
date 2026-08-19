import { describe, expect, it } from "vitest";
import type { HotelOption, MissionCandidate, MissionConstraints, TransportMode, TransportOption } from "./schema";
import { findMinimalRelaxation, solveMission } from "./solver";
import { verifyMission } from "./verifier";
import { MissionClarificationError, MissionUnsupportedError, parseMissionDeterministically } from "./parser";
import { TutuProvider } from "@/lib/tutu/provider";
import { TutuMcpClient } from "@/lib/tutu/client";
import { convertBudgetToRub, extractBudgetIntent, resetCurrencyRateCacheForTests } from "@/lib/currency/cbr";
import { formatTime, formatTransfers } from "./format";

const constraints: MissionConstraints = {
  origin: "Москва",
  destination: "Санкт-Петербург",
  eventAt: "2026-08-08T18:00:00+03:00",
  latestArrivalAt: "2026-08-08T16:00:00+03:00",
  arrivalBufferMin: 120,
  returnEarliestDepartureAt: null,
  returnArrivalDeadline: null,
  maxBudget: 15_000,
  allowedTransport: ["railway", "bus", "etrain"],
  excludedTransport: ["avia"],
  maxTransfers: 1,
  maxTripDurationMin: null,
  passengers: { adults: 1 },
  timezone: "Europe/Moscow",
};

function option(overrides: Partial<TransportOption> = {}): TransportOption {
  return {
    id: crypto.randomUUID(),
    mode: "railway",
    price: 6_500,
    currency: "RUB",
    departureAt: "2026-08-08T08:00:00+03:00",
    arrivalAt: "2026-08-08T15:00:00+03:00",
    durationMin: 420,
    transfers: 0,
    carrier: "РЖД",
    from: "Москва",
    to: "Санкт-Петербург",
    checkoutUrl: "https://www.tutu.ru/train/",
    searchResultsUrl: "https://www.tutu.ru/poezda/",
    source: "tutu-mcp",
    ...overrides,
  };
}

function candidate(outbound = option()): MissionCandidate {
  return { id: outbound.id, outbound, return: null, totalPrice: outbound.price, totalDurationMin: outbound.durationMin, transfers: outbound.transfers, score: 0 };
}

function hotel(overrides: Partial<HotelOption> = {}): HotelOption {
  return {
    id: "hotel-1",
    name: "Тестовый отель",
    stars: 4,
    rating: 8.7,
    reviewCount: 120,
    address: "Центр города",
    checkIn: "2026-08-08",
    checkOut: "2026-08-09",
    nights: 1,
    price: 4_000,
    currency: "RUB",
    breakfastIncluded: true,
    freeCancellation: true,
    checkoutUrl: "https://hotel.tutu.ru/offers/details",
    photoUrl: null,
    source: "tutu-mcp",
    ...overrides,
  };
}

describe("Mission Verifier", () => {
  it("verifies a route satisfying every constraint", () => expect(verifyMission(candidate(), constraints).verified).toBe(true));
  it("rejects a route over budget", () => expect(verifyMission(candidate(option({ price: 15_001 })), constraints).checks.find((check) => check.key === "budget")?.passed).toBe(false));
  it("rejects a late arrival", () => expect(verifyMission(candidate(option({ arrivalAt: "2026-08-08T18:10:00+03:00" })), constraints).checks.find((check) => check.key === "arrival")?.passed).toBe(false));
  it("rejects an insufficient arrival buffer", () => expect(verifyMission(candidate(option({ arrivalAt: "2026-08-08T16:30:00+03:00" })), constraints).checks.find((check) => check.key === "buffer")?.passed).toBe(false));
  it("rejects excluded transport", () => expect(verifyMission(candidate(option({ mode: "avia" })), constraints).checks.find((check) => check.key === "transport")?.passed).toBe(false));
  it("rejects too many transfers", () => expect(verifyMission(candidate(option({ transfers: 2 })), constraints).checks.find((check) => check.key === "transfers")?.passed).toBe(false));
  it("rejects a late return", () => {
    const back = option({ id: "back", departureAt: "2026-08-08T20:00:00+03:00", arrivalAt: "2026-08-09T11:00:00+03:00" });
    const withReturn = { ...candidate(), return: back, totalPrice: 13_000, totalDurationMin: 840 };
    const roundTripConstraints = { ...constraints, returnEarliestDepartureAt: constraints.eventAt, returnArrivalDeadline: "2026-08-09T10:00:00+03:00" };
    expect(verifyMission(withReturn, roundTripConstraints).checks.find((check) => check.key === "return")?.passed).toBe(false);
  });
  it("independently verifies hotel dates, preferences and total budget", () => {
    const withHotel = { ...constraints, maxBudget: 11_000, accommodation: { checkIn: "2026-08-08", checkOut: "2026-08-09", stars: [4], minRating: 8, breakfastIncluded: true, freeCancellation: true, hotelTypes: ["hotel"] } };
    const solved = solveMission(withHotel, [option()], [], [], [hotel()]);
    expect(solved.ranked[0].totalPrice).toBe(10_500);
    expect(verifyMission(solved.ranked[0], withHotel).checks.find((check) => check.key === "hotel")?.passed).toBe(true);
    expect(solveMission({ ...withHotel, maxBudget: 10_000 }, [option()], [], [], [hotel()]).ranked).toHaveLength(0);
  });
  it("rejects a return that leaves before the hotel stay is completed", () => {
    const withHotel = { ...constraints, maxBudget: 30_000, returnEarliestDepartureAt: constraints.eventAt, returnArrivalDeadline: "2026-08-09T12:00:00+03:00", accommodation: { checkIn: "2026-08-08", checkOut: "2026-08-09", stars: [4], minRating: 8, breakfastIncluded: true, freeCancellation: true, hotelTypes: ["hotel"] } };
    const earlyReturn = option({ id: "early-return", departureAt: "2026-08-08T23:00:00+03:00", arrivalAt: "2026-08-09T07:00:00+03:00" });
    expect(solveMission(withHotel, [option()], [earlyReturn], [], [hotel()]).ranked).toHaveLength(0);
  });
});

describe("Mission Solver", () => {
  it("ranks a balanced direct route above a slow transfer option", () => {
    const direct = option({ id: "direct", price: 7_000, durationMin: 420, transfers: 0 });
    const slow = option({ id: "slow", price: 6_700, durationMin: 780, transfers: 1, departureAt: "2026-08-08T02:00:00+03:00" });
    expect(solveMission(constraints, [slow, direct], []).ranked[0].id).toContain("direct");
  });
  it("returns no feasible routes for an impossible mission", () => {
    expect(solveMission(constraints, [option({ price: 20_000 })], []).ranked).toHaveLength(0);
  });
  it("suggests the minimum budget increase", () => {
    const all = [candidate(option({ price: 16_740 }))];
    const suggestion = findMinimalRelaxation(all, constraints);
    expect(suggestion?.constraint).toBe("budget");
    expect(suggestion?.title).toContain("1 740");
    expect(suggestion?.adjustedConstraints.maxBudget).toBe(16_740);
    expect(verifyMission(all[0], suggestion!.adjustedConstraints).verified).toBe(true);
  });
  it("suggests only a duration relaxation when that is the sole blocker", () => {
    const durationConstraints = { ...constraints, maxTripDurationMin: 60 };
    const all = [candidate(option({ durationMin: 420 }))];
    const suggestion = findMinimalRelaxation(all, durationConstraints);
    expect(suggestion?.constraint).toBe("duration");
    expect(suggestion?.adjustedConstraints.maxTripDurationMin).toBe(420);
    expect(verifyMission(all[0], suggestion!.adjustedConstraints).verified).toBe(true);
  });
  it("suggests a verified two-constraint relaxation", () => {
    const bakuConstraints: MissionConstraints = {
      ...constraints,
      destination: "Баку",
      eventAt: "2026-08-08T18:00:00+04:00",
      latestArrivalAt: "2026-08-08T16:00:00+04:00",
      returnEarliestDepartureAt: "2026-08-08T18:00:00+04:00",
      returnArrivalDeadline: "2026-08-09T12:00:00+03:00",
      maxBudget: 55_000,
      timezone: "Asia/Baku",
    };
    const outbound = option({ id: "avia-out", mode: "avia", price: 35_000, arrivalAt: "2026-08-08T15:00:00+04:00" });
    const back = option({ id: "avia-back", mode: "avia", price: 25_000, departureAt: "2026-08-08T20:00:00+04:00", arrivalAt: "2026-08-09T08:00:00+03:00" });
    const roundTrip: MissionCandidate = { id: "round", outbound, return: back, totalPrice: 60_000, totalDurationMin: 840, transfers: 0, score: 0 };
    const suggestion = findMinimalRelaxation([roundTrip], bakuConstraints);
    expect(suggestion?.constraint).toBe("multiple");
    expect(suggestion?.changes?.map((change) => change.key)).toEqual(["transport", "budget"]);
    expect(verifyMission(roundTrip, suggestion!.adjustedConstraints).verified).toBe(true);
  });
  it("can shift the event when every otherwise valid route arrives after it", () => {
    const lateFlight = candidate(option({
      id: "late-flight",
      mode: "avia",
      arrivalAt: "2026-08-08T20:00:00+04:00",
      price: 10_000,
    }));
    const suggestion = findMinimalRelaxation([lateFlight], constraints);
    expect(suggestion?.constraint).toBe("multiple");
    expect(suggestion?.changes?.map((change) => change.key)).toEqual(["transport", "event"]);
    expect(suggestion?.adjustedConstraints.eventAt).toBe("2026-08-08T22:00:00+04:00");
    expect(verifyMission(lateFlight, suggestion!.adjustedConstraints).verified).toBe(true);
  });
  it("suggests one-way travel when outbound offers exist but no return can be assembled", () => {
    const roundTripConstraints = {
      ...constraints,
      returnEarliestDepartureAt: constraints.eventAt,
      returnArrivalDeadline: "2026-08-09T12:00:00+03:00",
    };
    const outbound = option();
    const suggestion = findMinimalRelaxation([], roundTripConstraints, [outbound]);
    expect(suggestion?.constraint).toBe("return");
    expect(suggestion?.adjustedConstraints.returnArrivalDeadline).toBeNull();
    expect(verifyMission(candidate(outbound), suggestion!.adjustedConstraints).verified).toBe(true);

    const blockedFlight = option({ mode: "avia" });
    const compound = findMinimalRelaxation([], roundTripConstraints, [blockedFlight]);
    expect(compound?.changes?.map((change) => change.key)).toEqual(["return", "transport"]);
    expect(verifyMission(candidate(blockedFlight), compound!.adjustedConstraints).verified).toBe(true);
  });
  it.each<[TransportMode]>([["railway"], ["bus"], ["etrain"]])("counts %s offers in real solving stats", (mode) => {
    expect(solveMission(constraints, [option({ mode })], []).stats.offersByMode[mode]).toBe(1);
  });
});

describe("Mission parser", () => {
  it("parses the hackathon demo request", () => {
    const parsed = parseMissionDeterministically(
      "Завтра к 18:00 мне нужно быть в Санкт-Петербурге. Я нахожусь в Москве. Бюджет до 15 000 рублей, без самолёта, приехать минимум за два часа и вернуться следующим утром.",
      new Date("2026-08-07T08:00:00Z"),
    );
    expect(parsed.origin).toBe("Москва");
    expect(parsed.destination).toBe("Санкт-Петербург");
    expect(parsed.maxBudget).toBe(15_000);
    expect(parsed.excludedTransport).toContain("avia");
  });
  it("uses the destination timezone for a Baku deadline", () => {
    const parsed = parseMissionDeterministically(
      "Завтра к 18:00 мне нужно быть в Баку. Я нахожусь в Москве. Бюджет до 55 000 рублей, без самолёта, приехать минимум за два часа и вернуться следующим утром.",
      new Date("2026-08-07T08:00:00Z"),
    );
    expect(parsed.eventAt).toBe("2026-08-08T18:00:00+04:00");
    expect(parsed.returnArrivalDeadline).toBe("2026-08-09T12:00:00+03:00");
    expect(parsed.timezone).toBe("Asia/Baku");
  });
  it("asks for a missing date and time instead of inventing them", () => {
    expect(() => parseMissionDeterministically("Мне нужно быть в Казани. Я нахожусь в Москве."))
      .toThrow(MissionClarificationError);
  });
  it("recognizes a short route written as 'from city to city'", () => {
    expect.assertions(2);
    try {
      parseMissionDeterministically("Мне нужно из Москвы в Казань поездом.", new Date("2026-08-07T08:00:00Z"));
    } catch (error) {
      expect(error).toBeInstanceOf(MissionClarificationError);
      expect((error as MissionClarificationError).questions).toEqual([
        "В какой день нужно прибыть? Например: «завтра» или «12.08.2026».",
        "К какому точному времени нужно прибыть?",
      ]);
    }
  });
  it("recognizes a route written as 'to city from city' without swallowing both cities", () => {
    const parsed = parseMissionDeterministically(
      "Завтра к 18:00 нужно быть в Казани из Москвы, без самолёта, в одну сторону.",
      new Date("2026-08-07T08:00:00Z"),
    );
    expect(parsed.origin).toBe("Москва");
    expect(parsed.destination).toBe("Казань");
  });
  it("does not invent a two-hour buffer or transfer limit", () => {
    const parsed = parseMissionDeterministically(
      "Завтра к 18:00 мне нужно быть в Казани. Я нахожусь в Москве.",
      new Date("2026-08-07T08:00:00Z"),
    );
    expect(parsed.arrivalBufferMin).toBe(0);
    expect(parsed.maxTransfers).toBe(6);
  });
  it("parses adults, duration and an only-mode constraint", () => {
    const parsed = parseMissionDeterministically(
      "Завтра к 18:00 нам нужно быть в Казани. Я нахожусь в Москве. 3 взрослых, только поезд, максимум 12 часов в пути.",
      new Date("2026-08-07T08:00:00Z"),
    );
    expect(parsed.passengers.adults).toBe(3);
    expect(parsed.allowedTransport).toEqual(["railway"]);
    expect(parsed.maxTripDurationMin).toBe(720);
  });
  it("parses explicit dates and contextual event time", () => {
    const parsed = parseMissionDeterministically(
      "Мне нужно быть в Казани 12.08.2026, событие в 18:30. Я нахожусь в Москве.",
      new Date("2026-08-07T08:00:00Z"),
    );
    expect(parsed.eventAt).toBe("2026-08-12T18:30:00+03:00");
  });
  it("parses the next named weekday", () => {
    const parsed = parseMissionDeterministically(
      "В пятницу к 18:00 мне нужно быть в Казани. Я нахожусь в Москве.",
      new Date("2026-08-07T08:00:00Z"),
    );
    expect(parsed.eventAt.startsWith("2026-08-14T18:00:00")).toBe(true);
  });
  it("refuses to price children as adults", () => {
    expect(() => parseMissionDeterministically(
      "Завтра к 18:00 мне нужно быть в Казани. Я нахожусь в Москве, со мной ребёнок.",
      new Date("2026-08-07T08:00:00Z"),
    )).toThrow(MissionUnsupportedError);
  });
  it("asks for hotel preferences instead of guessing them", () => {
    expect(() => parseMissionDeterministically(
      "Завтра к 18:00 мне нужно быть в Казани. Я нахожусь в Москве, нужен отель на ночь.",
      new Date("2026-08-07T08:00:00Z"),
    )).toThrow(MissionClarificationError);
  });
  it("parses a delegated one-night hotel search", () => {
    const parsed = parseMissionDeterministically(
      "Завтра к 18:00 мне нужно быть в Казани. Я нахожусь в Москве, нужен отель на 1 ночь, подбери сам.",
      new Date("2026-08-07T08:00:00Z"),
    );
    expect(parsed.accommodation).toMatchObject({ checkIn: "2026-08-08", checkOut: "2026-08-09", hotelTypes: ["hotel"] });
  });
  it("uses the next-morning return as hotel checkout", () => {
    const parsed = parseMissionDeterministically(
      "Завтра к 18:00 мне нужно быть в Санкт-Петербурге. Я нахожусь в Москве. Вернуться следующим утром. Нужен отель 4 звезды с завтраком, рейтинг от 8 и бесплатная отмена.",
      new Date("2026-08-14T08:00:00Z"),
    );
    expect(parsed.accommodation).toMatchObject({ checkIn: "2026-08-15", checkOut: "2026-08-16" });
  });
  it("asks for a destination when origin and destination are the same", () => {
    expect(() => parseMissionDeterministically(
      "Завтра к 18:00 мне нужно быть в Москве. Я нахожусь в Москве. Только поездом.",
      new Date("2026-08-07T08:00:00Z"),
    )).toThrow(MissionClarificationError);
  });
  it("asks which transport rule to keep when constraints conflict", () => {
    expect(() => parseMissionDeterministically(
      "Завтра к 18:00 мне нужно быть в Казани из Москвы. Только поездом, без поезда.",
      new Date("2026-08-07T08:00:00Z"),
    )).toThrow(MissionClarificationError);
  });
  it("does not mistake a generic trip duration for an arrival buffer", () => {
    const parsed = parseMissionDeterministically(
      "Завтра к 18:00 нужно быть в Казани из Москвы. Хочу добраться за два часа.",
      new Date("2026-08-07T08:00:00Z"),
    );
    expect(parsed.arrivalBufferMin).toBe(0);
  });
  it("bounds a distant search instead of querying an arbitrary two-week horizon", () => {
    expect(() => parseMissionDeterministically(
      "1 сентября 2026 года к 18:00 нужно быть в Казани из Москвы, поездом.",
      new Date("2026-08-07T08:00:00Z"),
    )).toThrow(MissionClarificationError);
  });
});

describe("Tutu provider resilience", () => {
  it("retries a transient MCP 503 before surfacing an outage", async () => {
    let attempts = 0;
    const fetcher = async () => {
      attempts += 1;
      if (attempts === 1) return new Response("temporary", { status: 503 });
      return Response.json({ result: { content: [{ type: "text", text: JSON.stringify({ variants: [], meta: { unavailable: [], has_more: false } }) }] } });
    };
    const client = new TutuMcpClient("https://mcp.test", fetcher as typeof fetch);
    await expect(client.callTool("search_multitransport", {})).resolves.toMatchObject({ variants: [] });
    expect(attempts).toBe(2);
  });

  it("retries a semantic outage when every transport mode is unavailable", async () => {
    let attempts = 0;
    const fetcher = async () => {
      attempts += 1;
      const payload = attempts === 1
        ? { variants: [], meta: { unavailable: ["avia", "railway", "bus", "etrain"], has_more: false } }
        : { variants: [{ offer_id: "recovered" }], meta: { unavailable: [], has_more: false } };
      return Response.json({ result: { content: [{ type: "text", text: JSON.stringify(payload) }] } });
    };
    const client = new TutuMcpClient("https://mcp.test", fetcher as typeof fetch);
    await expect(client.callTool<{ variants: Array<{ offer_id: string }> }>("search_multitransport", {})).resolves.toMatchObject({ variants: [{ offer_id: "recovered" }] });
    expect(attempts).toBe(2);
  });

  it("coalesces identical concurrent MCP calls", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return Response.json({ result: { content: [{ type: "text", text: JSON.stringify({ variants: [{ offer_id: "real" }], meta: {} }) }] } });
    };
    const client = new TutuMcpClient("https://mcp.test/coalesce", fetcher as typeof fetch);
    const [first, second] = await Promise.all([
      client.callTool<{ variants: unknown[] }>("search_multitransport", { page: 1 }),
      client.callTool<{ variants: unknown[] }>("search_multitransport", { page: 1 }),
    ]);
    expect(first.variants).toHaveLength(1);
    expect(second.variants).toHaveLength(1);
    expect(calls).toBe(1);
  });

  it("uses a recent real MCP response when the upstream briefly goes down", async () => {
    let now = 0;
    let unavailable = false;
    const fetcher = async () => unavailable
      ? new Response("temporary", { status: 503 })
      : Response.json({ result: { content: [{ type: "text", text: JSON.stringify({ variants: [{ offer_id: "real" }], meta: {} }) }] } });
    const client = new TutuMcpClient("https://mcp.test/stale", fetcher as typeof fetch, {
      now: () => now,
      freshCacheMs: 10,
      staleCacheMs: 1_000,
      maxAttempts: 1,
    });
    await client.callTool("search_multitransport", { page: 1 });
    now = 100;
    unavailable = true;
    const recovered = await client.callTool<{ meta: { cache_status?: string }; variants: unknown[] }>("search_multitransport", { page: 1 });
    expect(recovered.variants).toHaveLength(1);
    expect(recovered.meta.cache_status).toBe("stale-if-error");
  });

  it("treats total MCP failure as a technical error, not an impossible mission", async () => {
    const failingClient = { callTool: async () => { throw new Error("timeout"); } } as unknown as TutuMcpClient;
    const provider = new TutuProvider(failingClient, () => new Date("2026-08-07T08:00:00Z"));
    await expect(provider.searchForMission(constraints)).rejects.toMatchObject({ code: "TUTU_MCP_UNAVAILABLE" });
  });
  it("paginates until Tutu reports has_more=false", async () => {
    const pages: number[] = [];
    const pagedClient = {
      callTool: async (_name: string, args: Record<string, unknown>) => {
        const page = Number(args.page);
        pages.push(page);
        return {
          variants: [{
            offer_id: `${args.departure_date}-${page}`,
            transport: "railway",
            price: { amount: 5_000, currency: "RUB" },
            departure_at: "2027-08-08T08:00:00+03:00",
            arrival_at: "2027-08-08T15:00:00+03:00",
            duration_min: 420,
            segments_count: 1,
            legs: [{ from: "Москва", to: "Казань", segments: [{}] }],
          }],
          meta: { has_more: page === 1, unavailable: [] },
        };
      },
    } as unknown as TutuMcpClient;
    const provider = new TutuProvider(pagedClient, () => new Date("2026-08-07T08:00:00Z"));
    const result = await provider.searchForMission(constraints);
    expect(pages).toContain(2);
    expect(result.outbound.options.length).toBeGreaterThan(1);
  });
});

describe("Currency conversion", () => {
  it("recognizes a budget in Azerbaijani manats", () => {
    expect(extractBudgetIntent("Бюджет до 1 250 манатов")).toEqual({ amount: 1250, currency: "AZN" });
    expect(extractBudgetIntent("бюджет 999,50 ₼")).toEqual({ amount: 999.5, currency: "AZN" });
  });

  it("converts by the official rate and respects the currency nominal", async () => {
    resetCurrencyRateCacheForTests();
    const xml = `<?xml version="1.0"?><ValCurs Date="08.08.2026"><Valute><CharCode>AZN</CharCode><Nominal>1</Nominal><Value>48,3332</Value></Valute><Valute><CharCode>KZT</CharCode><Nominal>100</Nominal><Value>14,5000</Value></Valute></ValCurs>`;
    const fetcher = async () => new Response(xml, { status: 200 });
    const azn = await convertBudgetToRub({ amount: 1_000, currency: "AZN" }, fetcher as typeof fetch);
    expect(azn.rubAmount).toBe(48_333);
    resetCurrencyRateCacheForTests();
    const kzt = await convertBudgetToRub({ amount: 1_000, currency: "KZT" }, fetcher as typeof fetch);
    expect(kzt.rubAmount).toBe(145);
    expect(kzt.rateDate).toBe("08.08.2026");
  });
});

describe("Local time formatting", () => {
  it("shows each ISO timestamp in its own local offset instead of forcing Moscow time", () => {
    expect(formatTime("2026-08-09T18:00:00+04:00")).toBe("18:00");
    expect(formatTime("2026-08-09T09:50:00+03:00")).toBe("09:50");
    expect(formatTransfers(1)).toBe("1 пересадка");
  });
});
