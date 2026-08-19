import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { integerEnv } from "./runtime-config";

const DOMAIN_FILES = [
  "candidate.ts",
  "deterministic-parser.ts",
  "explanation.ts",
  "relaxation.ts",
  "scoring.ts",
  "solver.ts",
  "verifier.ts",
  "timezone.ts",
  "schema.ts",
  "ports.ts",
];

describe("architecture boundaries", () => {
  it("keeps deterministic mission domain independent from infrastructure adapters", () => {
    for (const file of DOMAIN_FILES) {
      const source = readFileSync(resolve(process.cwd(), "src/lib/mission", file), "utf8");
      expect(source, file).not.toMatch(/@\/lib\/(?:tutu|ai|currency)/);
    }
  });

  it("keeps the orchestrator dependent on ports instead of Tutu implementation", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/mission/orchestrator.ts"), "utf8");
    expect(source).toContain('from "./ports"');
    expect(source).not.toContain("@/lib/tutu");
  });
});

describe("runtime configuration", () => {
  it("uses a safe fallback for malformed numeric environment values", () => {
    const previous = process.env.TEST_INTEGER_CONFIG;
    process.env.TEST_INTEGER_CONFIG = "not-a-number";
    expect(integerEnv("TEST_INTEGER_CONFIG", 3, { min: 1, max: 5 })).toBe(3);
    process.env.TEST_INTEGER_CONFIG = "99";
    expect(integerEnv("TEST_INTEGER_CONFIG", 3, { min: 1, max: 5 })).toBe(5);
    if (previous === undefined) delete process.env.TEST_INTEGER_CONFIG;
    else process.env.TEST_INTEGER_CONFIG = previous;
  });
});
