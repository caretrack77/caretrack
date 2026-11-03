import { defineConfig } from "drizzle-kit";
import { existsSync } from "fs";
import path from "path";

// Load the repository-root .env file so `pnpm db:push` works without extra setup.
const envFile = path.join(__dirname, "..", "..", ".env");
if (!process.env.DATABASE_URL && existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Add it to the .env file.");
}

const isLocal = /@(localhost|127\.0\.0\.1)(:|\/)/.test(process.env.DATABASE_URL);

export default defineConfig({
  schema: "./src/schema/index.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  },
});
