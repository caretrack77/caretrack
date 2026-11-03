import { and, desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  ListNotificationsResponse,
  MarkNotificationReadParams,
  MarkNotificationReadResponse,
} from "@workspace/api-zod";
import { db, notificationsTable } from "@workspace/db";
import { authenticate, currentUser, requireUser } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";

const router: IRouter = Router();
router.use(authenticate, requireUser);

function serializeNotification(
  notification: typeof notificationsTable.$inferSelect,
) {
  return {
    id: notification.id,
    patientId: notification.patientId,
    kind: notification.kind,
    title: notification.title,
    message: notification.message,
    read: notification.read,
    createdAt: notification.createdAt.toISOString(),
  };
}

router.get("/notifications", async (_req, res): Promise<void> => {
  const user = currentUser(res)!;
  const rows = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.userId, user.id))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(50);
  res.json(ListNotificationsResponse.parse(rows.map(serializeNotification)));
});

router.post("/notifications/:id/read", async (req, res): Promise<void> => {
  const params = MarkNotificationReadParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const user = currentUser(res)!;
  const inserted = await db
    .update(notificationsTable)
    .set({ read: true })
    .where(
      and(
        eq(notificationsTable.id, params.data.id),
        eq(notificationsTable.userId, user.id),
      ),
    )
    ;
  const [notification] = await db.select().from(notificationsTable).where(eq(notificationsTable.id, Number(inserted[0].insertId))).limit(1);
  if (!notification) {
    res.status(404).json({ error: "Notification not found." });
    return;
  }
  await writeAuditLog(user.id, "notification_read", "notification", notification.id);
  res.json(
    MarkNotificationReadResponse.parse(serializeNotification(notification)),
  );
});

export default router;
