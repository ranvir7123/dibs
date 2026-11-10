// Loads .env.local (then .env) for commands run outside the web app, the same
// files the web app reads by itself. Import this first: import "./env";
// Values already set in the terminal win. Missing files are fine.
import { existsSync } from "node:fs";
import path from "node:path";

for (const name of [".env.local", ".env"]) {
  const file = path.join(process.cwd(), name);
  if (existsSync(file)) process.loadEnvFile(file);
}
