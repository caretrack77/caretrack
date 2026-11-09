import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Add your Supabase connection string to the .env file.",
  );
}

// Hosted databases such as Supabase require TLS; local Postgres usually does not.
const isLocal = /@(localhost|127\.0\.0\.1)(:|\/)/.test(process.env.DATABASE_URL);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 10,
  // Supabase's pooler closes idle connections; recycle ours first so a request
  // never picks up a dead connection after the app has been idle.
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
  keepAlive: true,
});

// A dropped idle connection must not crash the server; the pool replaces it.
pool.on("error", (err) => {
  console.warn("Database connection dropped and will be replaced:", err.message);
});
export const db = drizzle(pool, { schema });

export * from "./schema";
