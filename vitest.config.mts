import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: { environment: "node", coverage: { reporter: ["text", "json-summary"] } },
});
