import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["artifacts/api-server/src/**/*.test.ts"],
    coverage: { reporter: ["text", "json-summary"] },
  },
});
