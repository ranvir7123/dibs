import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // Tests never touch the real database folder: each test file gets its own
    // embedded Postgres held in memory.
    env: { DIBS_DATA_DIR: "memory://", DATABASE_URL: "" },
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
