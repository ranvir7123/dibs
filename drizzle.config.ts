import { defineConfig } from "drizzle-kit";

// Used only by "npm run db:generate", which turns src/db/schema.ts into SQL
// files in drizzle/. Applying them is done by "npm run db:migrate".
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
