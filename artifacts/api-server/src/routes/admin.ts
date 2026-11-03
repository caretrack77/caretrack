import { and, desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  ListAuditLogsQueryParams,
  ListAuditLogsResponse,
} from "@workspace/api-zod";
import { auditLogsTable, db, usersTable } from "@workspace/db";
import { authenticate, currentUser, requireRoles, requireUser } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { emailConfigured, sendEmail, sendSms, smsConfigured } from "../lib/otp-delivery";
import { SendDeliveryTestBody } from "@workspace/api-zod";

const router: IRouter = Router();
router.use("/admin", authenticate, requireUser, requireRoles("admin"));

router.get("/admin/audit", async (req, res): Promise<void> => {
  const query = ListAuditLogsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const rows = await db
    .select({
      id: auditLogsTable.id,
      userId: auditLogsTable.userId,
      userName: usersTable.name,
      action: auditLogsTable.action,
      entityType: auditLogsTable.entityType,
      entityId: auditLogsTable.entityId,
      details: auditLogsTable.details,
      createdAt: auditLogsTable.createdAt,
    })
    .from(auditLogsTable)
    .leftJoin(usersTable, eq(usersTable.id, auditLogsTable.userId))
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(query.data.limit ?? 100);
  res.json(
    ListAuditLogsResponse.parse(
      rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
    ),
  );
});

router.get("/admin/delivery-status", (_req, res): void => {
  res.json({
    emailConfigured: emailConfigured(),
    emailSender: process.env.GMAIL_USER || null,
    smsProvider: process.env.SMS_PROVIDER || null,
    smsConfigured: smsConfigured(),
    offlineFallback: process.env.OTP_OFFLINE_FALLBACK !== "false",
    otpEnabled: process.env.OTP_ENABLED !== "false",
  });
});

router.post("/admin/delivery-test", async (req, res): Promise<void> => {
  const parsed = SendDeliveryTestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter an email address or mobile number." });
    return;
  }
  const { channel, to } = parsed.data;
  const configured = channel === "email" ? emailConfigured() : smsConfigured();
  if (!configured) {
    res.json({
      delivered: false,
      message:
        channel === "email"
          ? "Gmail is not set up. Add GMAIL_USER and GMAIL_APP_PASSWORD to the .env file and restart the server."
          : "SMS is not set up. Set SMS_PROVIDER and its keys in the .env file and restart the server.",
    });
    return;
  }
  const text = "CareTrack test message: your login-code delivery is working.";
  const delivered =
    channel === "email"
      ? await sendEmail(to.trim(), "CareTrack delivery test", text)
      : await sendSms(to.trim(), text);
  await writeAuditLog(currentUser(res)!.id, "delivery_test", "settings", null, { channel, delivered });
  res.json({
    delivered,
    message: delivered
      ? `Sent. Check ${channel === "email" ? "the inbox (and spam folder)" : "the phone"} for the test message.`
      : "Sending failed. Check the credentials in .env and the server log for the exact error.",
  });
});

export default router;
