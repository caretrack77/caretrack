// Internal admin–doctor messages: administrators write to doctors and doctors to
// administrators, about system, patient-related, medication or clinic-operations matters.
// Patients and caregivers have no access. Bodies are encrypted like patient messages.
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { Router, type IRouter, type Response } from "express";
import {
  ListStaffMessagesParams,
  MarkStaffMessagesReadParams,
  SendStaffMessageBody,
  SendStaffMessageParams,
} from "@workspace/api-zod";
import { db, notificationsTable, staffMessagesTable, usersTable } from "@workspace/db";
import { authenticate, currentUser, requireUser, type CurrentUser } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { decryptText, encryptText } from "../lib/encryption";
import { publishUsers } from "../lib/realtime";
import { sendMessagePush } from "../lib/push";

const router: IRouter = Router();
// Routers are mounted without a path prefix, so the role check is per route (a router-wide
// check here would block patients from every route registered after this one).
router.use("/staff-messages", authenticate, requireUser);


/** Admins talk to doctors; doctors talk to admins. */
export function counterpartRole(role: string): "admin" | "provider" | null {
  return role === "admin" ? "provider" : role === "provider" ? "admin" : null;
}

/** The signed-in admin or doctor, or a 403 for anyone else. */
function staffUser(res: Response): CurrentUser | null {
  const user = currentUser(res);
  if (!user || !counterpartRole(user.role)) {
    res.status(403).json({ error: "Team messages are only for administrators and doctors." });
    return null;
  }
  return user;
}

/** The colleague this user may write to: active, and of the other staff role. */
async function colleague(user: CurrentUser, userId: number) {
  const [row] = await db
    .select({ id: usersTable.id, name: usersTable.name, role: usersTable.role, active: usersTable.active })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return row && row.active && row.role === counterpartRole(user.role) ? row : null;
}

const between = (a: number, b: number) =>
  or(
    and(eq(staffMessagesTable.senderId, a), eq(staffMessagesTable.recipientId, b)),
    and(eq(staffMessagesTable.senderId, b), eq(staffMessagesTable.recipientId, a)),
  );

function serialize(row: { message: typeof staffMessagesTable.$inferSelect; senderName: string | null; senderRole: string | null }) {
  return {
    id: row.message.id,
    senderId: row.message.senderId,
    senderName: row.senderName ?? "Former team member",
    senderRole: row.senderRole ?? "unknown",
    recipientId: row.message.recipientId,
    body: decryptText(row.message.body),
    readAt: row.message.readAt?.toISOString() ?? null,
    createdAt: row.message.createdAt.toISOString(),
  };
}

router.get("/staff-messages/threads", async (_req, res): Promise<void> => {
  const user = staffUser(res);
  if (!user) return;
  const others = await db
    .select({ id: usersTable.id, name: usersTable.name, role: usersTable.role })
    .from(usersTable)
    .where(and(eq(usersTable.role, counterpartRole(user.role)!), eq(usersTable.active, true)))
    .orderBy(asc(usersTable.name));
  if (others.length === 0) {
    res.json([]);
    return;
  }
  const ids = others.map((o) => o.id);
  const mine = or(
    and(eq(staffMessagesTable.senderId, user.id), inArray(staffMessagesTable.recipientId, ids)),
    and(eq(staffMessagesTable.recipientId, user.id), inArray(staffMessagesTable.senderId, ids)),
  );
  const [recent, unread] = await Promise.all([
    db.select().from(staffMessagesTable).where(mine).orderBy(desc(staffMessagesTable.createdAt)).limit(500),
    db
      .select({ senderId: staffMessagesTable.senderId, total: sql<number>`count(*)::int` })
      .from(staffMessagesTable)
      .where(and(eq(staffMessagesTable.recipientId, user.id), isNull(staffMessagesTable.readAt), inArray(staffMessagesTable.senderId, ids)))
      .groupBy(staffMessagesTable.senderId),
  ]);
  const threads = others
    .map((other) => {
      const last = recent.find((m) => m.senderId === other.id || m.recipientId === other.id);
      return {
        userId: other.id,
        name: other.name,
        role: other.role as "admin" | "provider",
        lastMessage: last ? decryptText(last.body) : null,
        lastMessageAt: last?.createdAt.toISOString() ?? null,
        lastFromMe: last?.senderId === user.id,
        unreadCount: unread.find((u) => u.senderId === other.id)?.total ?? 0,
      };
    })
    .sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? "") || a.name.localeCompare(b.name));
  res.json(threads);
});

router.get("/staff-messages/:userId", async (req, res): Promise<void> => {
  const user = staffUser(res);
  if (!user) return;
  const params = ListStaffMessagesParams.safeParse(req.params);
  if (!params.success || !(await colleague(user, params.data.userId))) {
    res.status(404).json({ error: "Colleague not found." });
    return;
  }
  const rows = await db
    .select({ message: staffMessagesTable, senderName: usersTable.name, senderRole: usersTable.role })
    .from(staffMessagesTable)
    .leftJoin(usersTable, eq(usersTable.id, staffMessagesTable.senderId))
    .where(between(user.id, params.data.userId))
    .orderBy(asc(staffMessagesTable.createdAt))
    .limit(500);
  res.json(rows.map(serialize));
});

router.post("/staff-messages/:userId", async (req, res): Promise<void> => {
  const user = staffUser(res);
  if (!user) return;
  const params = SendStaffMessageParams.safeParse(req.params);
  const other = params.success ? await colleague(user, params.data.userId) : null;
  if (!other) {
    res.status(404).json({ error: "Colleague not found." });
    return;
  }
  const parsed = SendStaffMessageBody.safeParse(req.body);
  const body = parsed.success ? parsed.data.body.trim() : "";
  if (!body) {
    res.status(400).json({ error: "Write a message before sending." });
    return;
  }
  const [message] = await db
    .insert(staffMessagesTable)
    .values({ senderId: user.id, recipientId: other.id, body: encryptText(body.slice(0, 2000)) })
    .returning();
  // One unread "team message" notification per sender is enough; don't stack them.
  const [existing] = await db
    .select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(and(eq(notificationsTable.userId, other.id), eq(notificationsTable.kind, "staff-message"), eq(notificationsTable.read, false), eq(notificationsTable.title, `Team message from ${user.name}`)))
    .limit(1);
  const [notification] = existing
    ? [existing]
    : await db.insert(notificationsTable).values({
      userId: other.id,
      kind: "staff-message",
      title: `Team message from ${user.name}`,
      // Message text stays encrypted in the staff messages table only.
      message: "Open Team messages to read it.",
    }).returning({ id: notificationsTable.id });
  publishUsers([other.id], { type: "message", id: message.id });
  publishUsers([other.id], { type: "notification" });
  if (notification) {
    await sendMessagePush([other.id], {
      notificationId: notification.id,
      url: `/team-messages?user=${user.id}`,
      kind: "staff-message",
    });
  }
  await writeAuditLog(user.id, "staff_message_sent", "user", other.id, { messageId: message.id });
  res.status(201).json(serialize({ message, senderName: user.name, senderRole: user.role }));
});

router.post("/staff-messages/:userId/read", async (req, res): Promise<void> => {
  const user = staffUser(res);
  if (!user) return;
  const params = MarkStaffMessagesReadParams.safeParse(req.params);
  if (!params.success || !(await colleague(user, params.data.userId))) {
    res.status(404).json({ error: "Colleague not found." });
    return;
  }
  await db
    .update(staffMessagesTable)
    .set({ readAt: new Date() })
    .where(and(eq(staffMessagesTable.senderId, params.data.userId), eq(staffMessagesTable.recipientId, user.id), isNull(staffMessagesTable.readAt)));
  res.status(204).send();
});


export default router;
