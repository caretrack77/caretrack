import { Router, type IRouter } from "express";
import { authenticate, currentUser, requireUser } from "../lib/auth";
import { subscribeUser } from "../lib/realtime";
import { desc, eq } from "drizzle-orm";
import { db, notificationsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/events", authenticate, requireUser, (req, res): void => {
  const user = currentUser(res)!;
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  res.write(`event: connected\ndata: ${JSON.stringify({ userId: user.id })}\n\n`);
  const unsubscribe = subscribeUser(user.id, (event) => {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  });
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(": heartbeat\n\n");
  }, 20_000);
  let lastNotificationId = 0;
  // Notifications created by background jobs are found by polling. Messages are pushed
  // straight away (subscribeUser above), so this doesn't need to be faster than a few seconds.
  // One poll at a time per stream: on a slow database, overlapping polls exhausted the pool.
  let polling = false;
  const notificationPoll = setInterval(async () => {
    if (res.writableEnded || polling) return;
    polling = true;
    // A timer callback has no request error handler: an uncaught database error here
    // (e.g. a pooler connection timeout) would crash the whole server. Skip this tick instead.
    try {
      const [latest] = await db.select({ id: notificationsTable.id })
        .from(notificationsTable)
        .where(eq(notificationsTable.userId, user.id))
        .orderBy(desc(notificationsTable.id)).limit(1);
      if (!latest || latest.id <= lastNotificationId) return;
      if (lastNotificationId) res.write(`event: notification\ndata: ${JSON.stringify({ id: latest.id })}\n\n`);
      lastNotificationId = latest.id;
    } catch (err) {
      req.log?.warn({ err }, "Notification poll failed; will retry");
    } finally {
      polling = false;
    }
  }, 5000);
  req.on("close", () => {
    clearInterval(heartbeat);
    clearInterval(notificationPoll);
    unsubscribe();
  });
});

export default router;
