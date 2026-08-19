import { describe, expect, it } from "vitest";
import { CurrencyRateUnavailableError } from "@/lib/currency/cbr";
import { MissionClarificationError } from "@/lib/mission/parser";
import { TutuSearchUnavailableError } from "@/lib/tutu/provider";
import { missionRequestSchema } from "./contract";
import { missionErrorResponse } from "./errors";

describe("mission API contract", () => {
  it("normalizes a valid request and defaults to solve mode", () => {
    expect(missionRequestSchema.parse({ text: "  достаточно длинная задача  " })).toEqual({
      text: "достаточно длинная задача",
      mode: "solve",
    });
  });

  it("rejects arbitrary orchestration modes", () => {
    expect(() => missionRequestSchema.parse({ text: "достаточно длинная задача", mode: "unsafe" })).toThrow();
  });
});

describe("mission API error mapping", () => {
  it.each([
    [new TutuSearchUnavailableError(["timeout"]), 503],
    [new CurrencyRateUnavailableError(), 503],
    [new MissionClarificationError(["Когда ехать?"]), 200],
  ])("maps %s to HTTP %s", (error, status) => {
    expect(missionErrorResponse(error).status).toBe(status);
  });
});
