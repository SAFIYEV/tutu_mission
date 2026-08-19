import { describe, expect, it } from "vitest";
import { extractMissionWithClaude, isBedrockConfigured } from "./bedrock";

describe("Bedrock live smoke", () => {
  it.runIf(process.env.LIVE_BEDROCK_TEST === "1")("extracts a real structured mission with Claude Sonnet", async () => {
    expect(isBedrockConfigured()).toBe(true);
    const result = await extractMissionWithClaude(
      "Завтра к 18:00 мне нужно быть в Казани. Я нахожусь в Москве. Бюджет до 20 000 рублей, без самолёта.",
      null,
      new Date("2026-08-08T08:00:00Z"),
    );
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.constraints).toMatchObject({ origin: "Москва", destination: "Казань", maxBudget: 20_000 });
    }
  }, 30_000);
});
