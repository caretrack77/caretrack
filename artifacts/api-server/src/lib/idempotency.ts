// Duplicate protection for changes synced from devices that were offline.
//
// The app gives every change it saves on the device a random id and sends it as the
// `Idempotency-Key` header, on the first attempt and on every retry. The first request
// with a key is processed normally and its successful response is stored; any later
// request with the same key gets that stored response back instead of running again.
// So a reading, message or dose update is saved exactly once, even when the phone lost
// the server's answer and sent it again after reconnecting.
import type { NextFunction, Request, Response } from "express";
import { and, eq, isNull, lt } from "drizzle-orm";
import { db, idempotencyKeysTable, pool } from "@workspace/db";
import { authenticate, currentUser } from "./auth";
import { logger } from "./logger";

const KEY_PATTERN = /^[A-Za-z0-9_-]{16,100}$/;
const MUTATING = new Set(["POST", "PATCH", "PUT", "DELETE"]);
/** A first attempt that never finished (server restarted mid-request) stops blocking retries after this. */
const ABANDONED_AFTER_MS = 2 * 60 * 1000;
/** Keys are kept long enough to cover a device that stays offline for a while. */
const KEEP_KEYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Creates the table on start-up if it is missing (additive only: it never alters or drops
 * anything), so a deployment works without a separate `pnpm db:push`. Mirrors the Drizzle
 * definition in lib/db/src/schema/caretrack.ts.
 */
export async function ensureIdempotencyStore(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "caretrack_idempotency_keys" (
      "key" text PRIMARY KEY NOT NULL,
      "user_id" integer NOT NULL,
      "method" text NOT NULL,
      "path" text NOT NULL,
      "status_code" integer,
      "response" jsonb,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "caretrack_idempotency_keys_user_id_caretrack_users_id_fk"
        FOREIGN KEY ("user_id") REFERENCES "caretrack_users"("id") ON DELETE cascade
    );
    CREATE INDEX IF NOT EXISTS "caretrack_idempotency_keys_created_idx"
      ON "caretrack_idempotency_keys" USING btree ("created_at");
  `);
}

/**
 * Every additive schema change the running code needs, created if missing (never altered or
 * dropped), so a deployment works without a separate `pnpm db:push`. Run before the server
 * accepts requests: queries select these columns. Mirrors lib/db/src/schema/caretrack.ts.
 */
export async function ensureSchemaAdditions(): Promise<void> {
  await ensureIdempotencyStore();
  await pool.query(`
    ALTER TABLE "caretrack_users" ADD COLUMN IF NOT EXISTS "verified_phone" text;
    ALTER TABLE "caretrack_users" ADD COLUMN IF NOT EXISTS "phone_verified_at" timestamp with time zone;
    ALTER TABLE "caretrack_otp_challenges" ADD COLUMN IF NOT EXISTS "sms_phone" text;
    ALTER TABLE "caretrack_medications" ADD COLUMN IF NOT EXISTS "side_effects" text;
    CREATE TABLE IF NOT EXISTS "caretrack_staff_messages" (
      "id" serial PRIMARY KEY NOT NULL,
      "sender_id" integer REFERENCES "caretrack_users"("id") ON DELETE set null,
      "recipient_id" integer REFERENCES "caretrack_users"("id") ON DELETE set null,
      "body" text NOT NULL,
      "read_at" timestamp with time zone,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE INDEX IF NOT EXISTS "caretrack_staff_messages_pair_idx"
      ON "caretrack_staff_messages" USING btree ("sender_id", "recipient_id", "created_at");
    CREATE INDEX IF NOT EXISTS "caretrack_staff_messages_recipient_idx"
      ON "caretrack_staff_messages" USING btree ("recipient_id", "read_at");
    CREATE TABLE IF NOT EXISTS "caretrack_patient_transfer_requests" (
      "id" serial PRIMARY KEY NOT NULL,
      "patient_id" integer NOT NULL REFERENCES "caretrack_patients"("id") ON DELETE cascade,
      "from_provider_id" integer NOT NULL REFERENCES "caretrack_users"("id") ON DELETE cascade,
      "to_provider_id" integer NOT NULL REFERENCES "caretrack_users"("id") ON DELETE cascade,
      "reason" text,
      "status" text DEFAULT 'pending' NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "responded_at" timestamp with time zone
    );
    CREATE INDEX IF NOT EXISTS "caretrack_patient_transfer_requests_from_idx"
      ON "caretrack_patient_transfer_requests" USING btree ("from_provider_id", "status");
    CREATE INDEX IF NOT EXISTS "caretrack_patient_transfer_requests_to_idx"
      ON "caretrack_patient_transfer_requests" USING btree ("to_provider_id", "status");
    CREATE INDEX IF NOT EXISTS "caretrack_patient_transfer_requests_patient_idx"
      ON "caretrack_patient_transfer_requests" USING btree ("patient_id");
  `);
}

/** Removes keys older than the retention period. Run by the background job. */
export async function pruneIdempotencyKeys(): Promise<void> {
  await db.delete(idempotencyKeysTable).where(lt(idempotencyKeysTable.createdAt, new Date(Date.now() - KEEP_KEYS_MS)));
}

export async function idempotency(req: Request, res: Response, next: NextFunction): Promise<void> {
  const key = req.header("idempotency-key");
  if (!key || !MUTATING.has(req.method)) {
    next();
    return;
  }
  if (!KEY_PATTERN.test(key)) {
    res.status(400).json({ error: "Invalid Idempotency-Key header." });
    return;
  }
  try {
    await new Promise<void>((resolve, reject) => {
      authenticate(req, res, () => resolve()).catch(reject);
    });
    const user = currentUser(res);
    // Not signed in: let the route's own checks answer (401), and remember nothing.
    if (!user) {
      next();
      return;
    }
    const path = req.originalUrl.split("?")[0];
    const claimed = await db
      .insert(idempotencyKeysTable)
      .values({ key, userId: user.id, method: req.method, path })
      .onConflictDoNothing()
      .returning({ key: idempotencyKeysTable.key });
    if (!claimed.length) {
      const [row] = await db.select().from(idempotencyKeysTable).where(eq(idempotencyKeysTable.key, key)).limit(1);
      if (!row) {
        // Deleted between the insert and the read (a failed first attempt): process normally.
        next();
        return;
      }
      if (row.userId !== user.id || row.method !== req.method || row.path !== path) {
        res.status(422).json({ error: "This change id was already used for a different request.", code: "IDEMPOTENCY_KEY_REUSED" });
        return;
      }
      if (row.statusCode === null) {
        if (Date.now() - row.createdAt.getTime() < ABANDONED_AFTER_MS) {
          res.status(409).json({ error: "This change is still being saved. It will be retried shortly.", code: "IDEMPOTENCY_IN_PROGRESS" });
          return;
        }
        // The first attempt never completed; take it over.
        await db.update(idempotencyKeysTable).set({ createdAt: new Date() })
          .where(and(eq(idempotencyKeysTable.key, key), isNull(idempotencyKeysTable.statusCode)));
      } else {
        res.setHeader("idempotent-replayed", "true");
        if (row.response === null) res.status(row.statusCode).end();
        else res.status(row.statusCode).json(row.response);
        return;
      }
    }
    // Store the outcome before the response leaves, so an immediate retry finds it.
    // Only successes are remembered; after an error the next attempt runs again.
    const send = res.json.bind(res);
    let settled = false;
    const settle = async (body: unknown) => {
      if (settled) return;
      settled = true;
      if (res.statusCode >= 200 && res.statusCode < 300) {
        await db.update(idempotencyKeysTable)
          .set({ statusCode: res.statusCode, response: body === undefined ? null : body as object })
          .where(eq(idempotencyKeysTable.key, key));
      } else {
        await db.delete(idempotencyKeysTable).where(eq(idempotencyKeysTable.key, key));
      }
    };
    res.json = ((body: unknown) => {
      settle(body)
        .catch((err) => logger.error({ err }, "Could not store idempotency result"))
        .finally(() => send(body));
      return res;
    }) as Response["json"];
    // Responses sent without res.json (e.g. 204): record them once finished.
    res.on("finish", () => {
      settle(null).catch((err) => logger.error({ err }, "Could not store idempotency result"));
    });
    next();
  } catch (err) {
    next(err);
  }
}
