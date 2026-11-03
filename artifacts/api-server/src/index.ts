import app from "./app";
import { logger } from "./lib/logger";
import { startBackgroundJobs } from "./lib/jobs";
import { encryptLegacyMessages } from "./routes/messages";

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET must be set. Add a long random value to the .env file.");
}

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
  // Reminders, missed-dose marking, risk alerts and scheduled reports.
  startBackgroundJobs();
  encryptLegacyMessages()
    .then((count) => count && logger.info({ count }, "Encrypted existing messages"))
    .catch((err) => logger.warn({ err }, "Message encryption migration failed"));
});
