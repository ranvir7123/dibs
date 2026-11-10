// Tests for the scripts in this folder. Run with:
//   npx vitest run --config scripts/vitest.config.mts
// ("npm test" covers src/ only; this file keeps the scripts' tests beside them.)
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL("..", import.meta.url)),
  resolve: {
    alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["scripts/**/*.test.ts"],
    // Never the real database folder: each test file gets its own database in memory.
    env: { DIBS_DATA_DIR: "memory://", DATABASE_URL: "" },
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
