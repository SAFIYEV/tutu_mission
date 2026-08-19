import { describe, expect, it } from "vitest";
import { missionResponseSchema, type MissionConstraints, type TransportOption } from "./schema";
import { executeMission } from "./orchestrator";
import { verifyMission } from "./verifier";
import { TutuProvider } from "@/lib/tutu/provider";
import type { MissionSearchResult } from "./ports";
import type { TutuMcpClient } from "@/lib/tutu/client";

const constraints: MissionConstraints = {
  origin: "Москва",
  destination: "Санкт-Петербург",
  eventAt: "2027-08-08T18:00:00+03:00",
  latestArrivalAt: "2027-08-08T16:00:00+03:00",
  arrivalBufferMin: 120,
  returnEarliestDepartureAt: null,
  returnArrivalDeadline: null,
  maxBudget: 10_000,
  allowedTransport: ["railway", "bus", "etrain"],
  excludedTransport: ["avia"],
  maxTransfers: 1,
  maxTripDurationMin: null,
  passengers: { adults: 1 },
  timezone: "Europe/Moscow",
};

function option(overrides: Partial<TransportOption> = {}): TransportOption {
  return {
    id: "outbound",
    mode: "railway",
    price: 12_000,
    currency: "RUB",
    departureAt: "2027-08-08T08:00:00+03:00",
    arrivalAt: "2027-08-08T15:00:00+03:00",
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

function searchResult(outbound: TransportOption[], returns: TransportOption[] = [], warnings: string[] = []): MissionSearchResult {
  return {
    outbound: { options: outbound, unavailableModes: [], warnings, attempts: 1, successfulSearches: 1 },
    returns: { options: returns, unavailableModes: [], warnings: [], attempts: returns.length ? 1 : 0, successfulSearches: returns.length ? 1 : 0 },
  };
}

describe("Mission Orchestrator", () => {
  it("owns the adjustment loop and verifies the newly solved mission", async () => {
    let searches = 0;
    const response = await executeMission("synthetic mission with enough text", {
      mode: "auto-adjust",
      requestId: "mission-test",
      parser: async () => ({ constraints, source: "deterministic-fallback" as const }),
      provider: { searchForMission: async () => { searches += 1; return searchResult([option()]); } },
    });

    expect(response.status).toBe("complete");
    expect(response.verification?.verified).toBe(true);
    expect(response.constraints.maxBudget).toBe(12_000);
    expect(response.parserSource).toBe("agent-adjustment");
    expect(response.trace).toMatchObject({ requestId: "mission-test", adjustmentRounds: 1 });
    expect(response.trace.appliedChanges[0]).toContain("бюджет");
    expect(missionResponseSchema.safeParse(response).success).toBe(true);
    expect(searches).toBe(2);
  });

  it("can remove an impossible return requirement and rerun search", async () => {
    const roundTrip = {
      ...constraints,
      maxBudget: 20_000,
      returnEarliestDepartureAt: "2027-08-08T18:00:00+03:00",
      returnArrivalDeadline: "2027-08-09T10:00:00+03:00",
    };
    const response = await executeMission("synthetic round trip mission", {
      mode: "auto-adjust",
      parser: async () => ({ constraints: roundTrip, source: "deterministic-fallback" as const }),
      provider: {
        searchForMission: async (current) => searchResult([option()], current.returnArrivalDeadline ? [] : []),
      },
    });

    expect(response.status).toBe("complete");
    expect(response.winner?.return).toBeNull();
    expect(response.constraints.returnArrivalDeadline).toBeNull();
    expect(response.trace.adjustmentRounds).toBe(1);
  });

  it("keeps a verified result when another MCP search job only partially failed", async () => {
    const response = await executeMission("synthetic partially available mission", {
      parser: async () => ({ constraints: { ...constraints, maxBudget: 20_000 }, source: "deterministic-fallback" as const }),
      provider: { searchForMission: async () => searchResult([option()], [], ["previous date: timeout"]) },
    });
    expect(response.status).toBe("complete");
    expect(response.warnings).toHaveLength(1);
    expect(response.verification?.verified).toBe(true);
  });

  it("stops immediately when the request has already been aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(executeMission("synthetic aborted mission", {
      signal: controller.signal,
      parser: async () => ({ constraints, source: "deterministic-fallback" as const }),
      provider: { searchForMission: async () => searchResult([option()]) },
    })).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("Bounded Tutu search", () => {
  it("never runs more than two date searches concurrently by default", async () => {
    let active = 0;
    let maximumActive = 0;
    const client = {
      callTool: async (_name: string, args: Record<string, unknown>) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return { variants: [], meta: { unavailable: [], has_more: false }, args };
      },
    } as unknown as TutuMcpClient;
    const provider = new TutuProvider(client);
    await provider.searchForMission({
      ...constraints,
      eventAt: "2027-08-08T18:00:00+03:00",
      latestArrivalAt: "2027-08-08T16:00:00+03:00",
      returnEarliestDepartureAt: "2027-08-08T18:00:00+03:00",
      returnArrivalDeadline: "2027-08-10T10:00:00+03:00",
    });
    expect(maximumActive).toBeLessThanOrEqual(2);
  });
});

describe("Independent chronology verification", () => {
  it("rejects a return that departs before the outbound leg arrives", () => {
    const outbound = option();
    const back = option({
      id: "return",
      from: "Санкт-Петербург",
      to: "Москва",
      departureAt: "2027-08-08T14:00:00+03:00",
      arrivalAt: "2027-08-08T17:00:00+03:00",
    });
    const roundTrip = { ...constraints, maxBudget: 30_000, returnArrivalDeadline: "2027-08-09T10:00:00+03:00" };
    const candidate = { id: "bad-order", outbound, return: back, totalPrice: 24_000, totalDurationMin: 840, transfers: 0, score: 0 };
    expect(verifyMission(candidate, roundTrip).checks.find((check) => check.key === "chronology")?.passed).toBe(false);
  });
});
