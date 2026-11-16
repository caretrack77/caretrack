import app from "./app";
import { logger } from "./lib/logger";
import { startBackgroundJobs } from "./lib/jobs";
import { encryptLegacyMessages } from "./routes/messages";
import { ensureIdempotencyStore } from "./lib/idempotency";

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET must be set. Add a long random value to the .env file.");
}

// Safety net: a stray rejected promise (for example a database timeout in a timer) must not
// take every patient offline. Log it; the request-level handlers deal with normal errors.
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled promise rejection");
});

const rawPort = process.env["PORT"] ?? "8080";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  ensureIdempotencyStore().catch((err) => logger.error({ err }, "Could not prepare the offline-sync duplicate guard table"));
  // Reminders, missed-dose marking, risk alerts and scheduled reports. Only one server per
  // database should run them: set BACKGROUND_JOBS=false on a laptop that shares the hosted
  // database, or reminders and alerts would be sent twice.
  if (process.env.BACKGROUND_JOBS !== "false") startBackgroundJobs();
  else logger.info("Background jobs are off (BACKGROUND_JOBS=false)");
  encryptLegacyMessages()
    .then((count) => count && logger.info({ count }, "Encrypted existing messages"))
    .catch((err) => logger.warn({ err }, "Message encryption migration failed"));
});
