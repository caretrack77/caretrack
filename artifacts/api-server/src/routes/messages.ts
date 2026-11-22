import { and, asc, desc, eq, gt, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  ListMessageCalendarQueryParams,
  ListPatientMessagesParams,
  MarkPatientMessagesReadParams,
  SendPatientMessageBody,
  SendPatientMessageParams,
} from "@workspace/api-zod";
import {
  db,
  messageReadsTable,
  messagesTable,
  notificationsTable,
  patientCaregiverAssignmentsTable,
  patientsTable,
  usersTable,
} from "@workspace/db";
import { authenticate, currentUser, requireUser, type CurrentUser } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { canAccessPatient, canManagePatient, getVisiblePatientIds } from "../lib/patient-access";
import { careTeamProviderIds } from "../lib/coverage";
import { decryptText, encryptText, isEncrypted } from "../lib/encryption";
import { publishUsers } from "../lib/realtime";
import { sendMessagePush } from "../lib/push";

const router: IRouter = Router();
router.use(authenticate, requireUser);

/** Patients write in their own thread; providers and admins in threads they manage. Caregivers read only. */
async function canSend(user: CurrentUser, patientId: number): Promise<boolean> {
  if (user.role === "patient") return canAccessPatient(user, patientId);
  if (user.role === "provider" || user.role === "admin") return canManagePatient(user, patientId);
  return false;
}

async function markRead(userId: number, patientId: number): Promise<void> {
  await db
    .insert(messageReadsTable)
    .values({ userId, patientId, lastReadAt: new Date() })
    .onConflictDoUpdate({
      target: [messageReadsTable.userId, messageReadsTable.patientId],
      set: { lastReadAt: new Date() },
    });
}

function serializeMessage(row: {
  message: typeof messagesTable.$inferSelect;
  senderName: string | null;
  senderRole: string | null;
}) {
  return {
    id: row.message.id,
    patientId: row.message.patientId,
    senderId: row.message.senderId,
    senderName: row.senderName ?? "Former team member",
    senderRole: row.senderRole ?? "unknown",
    body: decryptText(row.message.body),
    createdAt: row.message.createdAt.toISOString(),
  };
}

router.get("/messages/threads", async (_req, res): Promise<void> => {
  const user = currentUser(res)!;
  const patientIds = await getVisiblePatientIds(user);
  if (patientIds.length === 0) {
    res.json([]);
    return;
  }
  const [patients, latest] = await Promise.all([
    db
      .select({ id: patientsTable.id, name: patientsTable.name })
      .from(patientsTable)
      .where(inArray(patientsTable.id, patientIds)),
    db
      .selectDistinctOn([messagesTable.patientId], {
        patientId: messagesTable.patientId,
        body: messagesTable.body,
        createdAt: messagesTable.createdAt,
        senderName: usersTable.name,
      })
      .from(messagesTable)
      .leftJoin(usersTable, eq(usersTable.id, messagesTable.senderId))
      .where(inArray(messagesTable.patientId, patientIds))
      .orderBy(messagesTable.patientId, desc(messagesTable.createdAt)),
  ]);
  // Unread = messages from someone else, newer than this user's last read time.
  const unread = await db
    .select({ patientId: messagesTable.patientId, total: sql<number>`count(*)::int` })
    .from(messagesTable)
    .leftJoin(
      messageReadsTable,
      and(
        eq(messageReadsTable.patientId, messagesTable.patientId),
        eq(messageReadsTable.userId, user.id),
      ),
    )
    .where(
      and(
        inArray(messagesTable.patientId, patientIds),
        ne(messagesTable.senderId, user.id),
        sql`(${messageReadsTable.lastReadAt} is null or ${messagesTable.createdAt} > ${messageReadsTable.lastReadAt})`,
      ),
    )
    .groupBy(messagesTable.patientId);
  const threads = patients
    .map((patient) => {
      const last = latest.find((row) => row.patientId === patient.id);
      return {
        patientId: patient.id,
        patientName: patient.name,
        lastMessage: last ? decryptText(last.body) : null,
        lastSenderName: last?.senderName ?? null,
        lastMessageAt: last?.createdAt.toISOString() ?? null,
        unreadCount: unread.find((row) => row.patientId === patient.id)?.total ?? 0,
      };
    })
    .sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? "") || a.patientName.localeCompare(b.patientName));
  res.json(threads);
});

/**
 * Every patient-conversation message the user can see between two dates (inclusive, Manila
 * calendar days), for the Messages calendar. Same access rules as the threads above.
 */
router.get("/messages/calendar", async (req, res): Promise<void> => {
  const query = ListMessageCalendarQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Choose a valid date range." });
    return;
  }
  const day = (value: string | Date) => (typeof value === "string" ? value : value.toISOString().slice(0, 10));
  const start = new Date(`${day(query.data.from)}T00:00:00+08:00`);
  const end = new Date(`${day(query.data.to)}T00:00:00+08:00`);
  end.setDate(end.getDate() + 1);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start || end.getTime() - start.getTime() > 62 * 86_400_000) {
    res.status(400).json({ error: "Choose a date range of up to two months." });
    return;
  }
  const user = currentUser(res)!;
  const patientIds = await getVisiblePatientIds(user);
  if (patientIds.length === 0) {
    res.json([]);
    return;
  }
  const rows = await db
    .select({ message: messagesTable, senderName: usersTable.name, senderRole: usersTable.role, patientName: patientsTable.name })
    .from(messagesTable)
    .innerJoin(patientsTable, eq(patientsTable.id, messagesTable.patientId))
    .leftJoin(usersTable, eq(usersTable.id, messagesTable.senderId))
    .where(and(inArray(messagesTable.patientId, patientIds), gte(messagesTable.createdAt, start), lt(messagesTable.createdAt, end)))
    .orderBy(asc(messagesTable.createdAt))
    .limit(1000);
  res.json(rows.map((row) => ({ ...serializeMessage(row), patientName: row.patientName })));
});

router.get("/patients/:id/messages", async (req, res): Promise<void> => {
  const params = ListPatientMessagesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const user = currentUser(res)!;
  if (!(await canAccessPatient(user, params.data.id))) {
    res.status(404).json({ error: "Patient not found." });
    return;
  }
  const rows = await db
    .select({ message: messagesTable, senderName: usersTable.name, senderRole: usersTable.role })
    .from(messagesTable)
    .leftJoin(usersTable, eq(usersTable.id, messagesTable.senderId))
    .where(eq(messagesTable.patientId, params.data.id))
    .orderBy(asc(messagesTable.createdAt))
    .limit(500);
  res.json(rows.map(serializeMessage));
});

router.post("/patients/:id/messages", async (req, res): Promise<void> => {
  const params = SendPatientMessageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = SendPatientMessageBody.safeParse(req.body);
  const body = parsed.success ? parsed.data.body.trim() : "";
  if (!body) {
    res.status(400).json({ error: "Write a message before sending." });
    return;
  }
  const user = currentUser(res)!;
  const patientId = params.data.id;
  if (!(await canAccessPatient(user, patientId))) {
    res.status(404).json({ error: "Patient not found." });
    return;
  }
  if (!(await canSend(user, patientId))) {
    res.status(403).json({ error: "Caregiver accounts can read messages but not send them." });
    return;
  }
  const [message] = await db
    .insert(messagesTable)
    .values({ patientId, senderId: user.id, body: encryptText(body.slice(0, 2000)) })
    .returning();
  await markRead(user.id, patientId);

  // Notify the other side: the care team when a patient writes, otherwise the patient and caregivers.
  const [patient] = await db
    .select({ name: patientsTable.name, userId: patientsTable.userId })
    .from(patientsTable)
    .where(eq(patientsTable.id, patientId))
    .limit(1);
  let recipients: number[];
  if (user.role === "patient") {
    // The assigned doctor plus anyone covering for them while they're away.
    recipients = await careTeamProviderIds(patientId);
  } else {
    const caregivers = await db
      .select({ id: patientCaregiverAssignmentsTable.caregiverId })
      .from(patientCaregiverAssignmentsTable)
      .where(eq(patientCaregiverAssignmentsTable.patientId, patientId));
    recipients = [patient?.userId, ...caregivers.map((row) => row.id)].filter(
      (id): id is number => typeof id === "number",
    );
  }
  recipients = [...new Set(recipients)].filter((id) => id !== user.id);
  publishUsers(recipients, { type: "message", patientId, id: message.id });
  // One unread notification per conversation is enough; don't stack them.
  const recent = new Date(Date.now() - 10 * 60 * 1000);
  for (const userId of recipients) {
    const [existing] = await db
      .select({ id: notificationsTable.id })
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.userId, userId),
          eq(notificationsTable.patientId, patientId),
          eq(notificationsTable.kind, "message"),
          eq(notificationsTable.read, false),
          gt(notificationsTable.createdAt, recent),
        ),
      )
      .limit(1);
    const [notification] = existing
      ? [existing]
      : await db.insert(notificationsTable).values({
          userId,
          patientId,
          kind: "message",
          title: `New message from ${user.name}`,
          // Message text stays encrypted in the messages table only.
          message: "Open Messages to read it.",
        }).returning({ id: notificationsTable.id });
    publishUsers([userId], { type: "notification", patientId });
    if (notification) {
      await sendMessagePush([userId], {
        notificationId: notification.id,
        url: `/messages?patient=${patientId}`,
        kind: "message",
      });
    }
  }
  await writeAuditLog(user.id, "message_sent", "patient", patientId, { messageId: message.id });
  res.status(201).json(
    serializeMessage({ message, senderName: user.name, senderRole: user.role }),
  );
});

router.post("/patients/:id/messages/read", async (req, res): Promise<void> => {
  const params = MarkPatientMessagesReadParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const user = currentUser(res)!;
  if (!(await canAccessPatient(user, params.data.id))) {
    res.status(404).json({ error: "Patient not found." });
    return;
  }
  await markRead(user.id, params.data.id);
  res.status(204).send();
});


/** One-time migration: encrypt messages that were stored before encryption was added. */
export async function encryptLegacyMessages(): Promise<number> {
  const rows = await db.select({ id: messagesTable.id, body: messagesTable.body }).from(messagesTable);
  let count = 0;
  for (const row of rows) {
    if (isEncrypted(row.body)) continue;
    await db.update(messagesTable).set({ body: encryptText(row.body) }).where(eq(messagesTable.id, row.id));
    count += 1;
  }
  return count;
}

export default router;
