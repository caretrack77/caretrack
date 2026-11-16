import { and, desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  ListAuditLogsQueryParams,
  ListAuditLogsResponse,
} from "@workspace/api-zod";
import { auditLogsTable, db, usersTable } from "@workspace/db";
import { authenticate, currentUser, requireRoles, requireUser } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { emailConfigured, sendEmail, sendSmsDetailed, smsConfigured } from "../lib/otp-delivery";
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
    offlineFallback:
      process.env.OTP_OFFLINE_FALLBACK === undefined
        ? process.env.NODE_ENV !== "production"
        : process.env.OTP_OFFLINE_FALLBACK === "true",
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
          : "SMS is not set up. Set SMS_PROVIDER=sms-gate, SMS_GATEWAY_USER and SMS_GATEWAY_PASSWORD (Render > Environment, or .env). See docs/SMS_OTP.md.",
    });
    return;
  }
  const text = "CareTrack test message: your login-code delivery is working.";
  const sms = channel === "sms" ? await sendSmsDetailed(to.trim(), text, 600) : null;
  const delivered = sms ? sms.ok : await sendEmail(to.trim(), "CareTrack delivery test", text);
  await writeAuditLog(currentUser(res)!.id, "delivery_test", "settings", null, { channel, delivered, ...(sms ? { smsStatus: sms.status } : {}) });
  res.json({
    delivered,
    message: sms?.status === "blocked"
      ? "That is one of the demo accounts' made-up numbers, so nothing was sent. Use a real mobile number."
      : sms?.status === "queued"
        ? "Accepted by the SMS gateway, but the gateway phone hasn't confirmed sending yet. Make sure it is on, online, and the app is running; the text should arrive shortly."
        : delivered
          ? `Sent. Check ${channel === "email" ? "the inbox (and spam folder)" : "the phone"} for the test message.`
          : channel === "sms"
            ? "The SMS gateway could not send it. Check that the gateway phone is on with load/signal and the credentials are right; the server log has the exact error."
            : "Sending failed. Check the credentials and the server log for the exact error.",
  });
});

export default router;
