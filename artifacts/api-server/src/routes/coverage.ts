import { aliasedTable, and, asc, count, desc, eq, inArray, or } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { CreateCoverageBody, EndCoverageParams } from "@workspace/api-zod";
import {
  db,
  notificationsTable,
  patientTransferRequestsTable,
  patientProviderAssignmentsTable,
  patientsTable,
  providerCoverageTable,
  usersTable,
} from "@workspace/db";
import { authenticate, currentUser, requireRoles, requireUser } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { manilaDate } from "../lib/dose-scheduler";
import { publishUsers } from "../lib/realtime";
import { sendMessagePush } from "../lib/push";

const router: IRouter = Router();
router.use(authenticate, requireUser);

const absentUser = aliasedTable(usersTable, "absent_user");
const coveringUser = aliasedTable(usersTable, "covering_user");
const requestingUser = aliasedTable(usersTable, "requesting_user");
const receivingUser = aliasedTable(usersTable, "receiving_user");

const CreateTransferRequestBody = z.object({
  patientId: z.number().int().positive(),
  toProviderId: z.number().int().positive(),
  reason: z.string().trim().max(200).nullish(),
});
const RespondTransferRequestParams = z.object({ id: z.coerce.number().int().positive() });
const RespondTransferRequestBody = z.object({ decision: z.enum(["accept", "decline"]) });

function statusOf(row: typeof providerCoverageTable.$inferSelect): "active" | "upcoming" | "ended" {
  const today = manilaDate();
  if (row.endedAt || (row.endDate && row.endDate < today)) return "ended";
  return row.startDate > today ? "upcoming" : "active";
}

async function loadCoverage(where?: ReturnType<typeof eq>) {
  const rows = await db
    .select({
      coverage: providerCoverageTable,
      absentName: absentUser.name,
      coveringName: coveringUser.name,
    })
    .from(providerCoverageTable)
    .innerJoin(absentUser, eq(absentUser.id, providerCoverageTable.absentProviderId))
    .innerJoin(coveringUser, eq(coveringUser.id, providerCoverageTable.coveringProviderId))
    .where(where)
    .orderBy(desc(providerCoverageTable.createdAt))
    .limit(100);
  const absentIds = [...new Set(rows.map((row) => row.coverage.absentProviderId))];
  const counts = absentIds.length
    ? await db
        .select({ providerId: patientProviderAssignmentsTable.providerId, total: count() })
        .from(patientProviderAssignmentsTable)
        .where(inArray(patientProviderAssignmentsTable.providerId, absentIds))
        .groupBy(patientProviderAssignmentsTable.providerId)
    : [];
  return rows.map(({ coverage, absentName, coveringName }) => ({
    id: coverage.id,
    absentProviderId: coverage.absentProviderId,
    absentProviderName: absentName,
    coveringProviderId: coverage.coveringProviderId,
    coveringProviderName: coveringName,
    startDate: coverage.startDate,
    endDate: coverage.endDate,
    reason: coverage.reason,
    status: statusOf(coverage),
    patientCount: Number(counts.find((c) => c.providerId === coverage.absentProviderId)?.total ?? 0),
  }));
}

async function loadTransferRequests(userId: number, role: string) {
  const rows = await db
    .select({
      request: patientTransferRequestsTable,
      patientName: patientsTable.name,
      fromProviderName: requestingUser.name,
      toProviderName: receivingUser.name,
    })
    .from(patientTransferRequestsTable)
    .innerJoin(patientsTable, eq(patientsTable.id, patientTransferRequestsTable.patientId))
    .innerJoin(requestingUser, eq(requestingUser.id, patientTransferRequestsTable.fromProviderId))
    .innerJoin(receivingUser, eq(receivingUser.id, patientTransferRequestsTable.toProviderId))
    .where(role === "admin"
      ? undefined
      : or(
          eq(patientTransferRequestsTable.fromProviderId, userId),
          eq(patientTransferRequestsTable.toProviderId, userId),
        ),
    )
    .orderBy(desc(patientTransferRequestsTable.createdAt))
    .limit(100);
  return rows.map(({ request, patientName, fromProviderName, toProviderName }) => ({
    id: request.id,
    patientId: request.patientId,
    patientName,
    fromProviderId: request.fromProviderId,
    fromProviderName,
    toProviderId: request.toProviderId,
    toProviderName,
    reason: request.reason,
    status: request.status,
    createdAt: request.createdAt,
    respondedAt: request.respondedAt,
  }));
}

router.get("/providers", requireRoles("admin", "provider"), async (_req, res): Promise<void> => {
  const providers = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
    .from(usersTable)
    .where(and(eq(usersTable.role, "provider"), eq(usersTable.active, true)))
    .orderBy(asc(usersTable.name));
  res.json(providers);
});

router.get("/coverage/transfers", requireRoles("admin", "provider"), async (_req, res): Promise<void> => {
  const user = currentUser(res)!;
  res.json(await loadTransferRequests(user.id, user.role));
});

router.post("/coverage/transfers", requireRoles("provider"), async (req, res): Promise<void> => {
  const parsed = CreateTransferRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a patient and the doctor receiving the transfer." });
    return;
  }
  const user = currentUser(res)!;
  if (parsed.data.toProviderId === user.id) {
    res.status(400).json({ error: "Choose a different doctor to receive the transfer." });
    return;
  }

  const [assignment] = await db
    .select({ id: patientProviderAssignmentsTable.id })
    .from(patientProviderAssignmentsTable)
    .where(and(
      eq(patientProviderAssignmentsTable.patientId, parsed.data.patientId),
      eq(patientProviderAssignmentsTable.providerId, user.id),
    ))
    .limit(1);
  if (!assignment) {
    res.status(404).json({ error: "This patient is not currently assigned to you." });
    return;
  }
  const [recipient] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(
      eq(usersTable.id, parsed.data.toProviderId),
      eq(usersTable.role, "provider"),
      eq(usersTable.active, true),
    ))
    .limit(1);
  if (!recipient) {
    res.status(400).json({ error: "Choose an active doctor to receive the transfer." });
    return;
  }
  const [pending] = await db
    .select({ id: patientTransferRequestsTable.id })
    .from(patientTransferRequestsTable)
    .where(and(
      eq(patientTransferRequestsTable.patientId, parsed.data.patientId),
      eq(patientTransferRequestsTable.fromProviderId, user.id),
      eq(patientTransferRequestsTable.toProviderId, parsed.data.toProviderId),
      eq(patientTransferRequestsTable.status, "pending"),
    ))
    .limit(1);
  if (pending) {
    res.status(409).json({ error: "A transfer request for this patient is already pending with that doctor." });
    return;
  }

  const { request, notificationId } = await db.transaction(async (tx) => {
    const [createdRequest] = await tx
      .insert(patientTransferRequestsTable)
      .values({
        patientId: parsed.data.patientId,
        fromProviderId: user.id,
        toProviderId: parsed.data.toProviderId,
        reason: parsed.data.reason?.trim() || null,
      })
      .returning();
    if (!createdRequest) throw new Error("The patient transfer request could not be created.");
    const [patient] = await tx
      .select({ name: patientsTable.name })
      .from(patientsTable)
      .where(eq(patientsTable.id, createdRequest.patientId))
      .limit(1);
    const [notification] = await tx
      .insert(notificationsTable)
      .values({
        userId: createdRequest.toProviderId,
        patientId: createdRequest.patientId,
        kind: "coverage",
        title: `Patient transfer request from ${user.name}`,
        message: `${patient?.name ?? "A patient"} is proposed for transfer to your care${createdRequest.reason ? `: ${createdRequest.reason}` : ""}. Review the request in Doctor coverage.`,
      })
      .returning({ id: notificationsTable.id });
    if (!notification) throw new Error("The patient transfer notification could not be created.");
    return { request: createdRequest, notificationId: notification.id };
  });
  publishUsers([request.toProviderId], { type: "notification", patientId: request.patientId });
  await sendMessagePush([request.toProviderId], {
    notificationId,
    url: "/coverage",
    kind: "coverage",
    title: "Patient transfer request",
    body: "A doctor requested to transfer a patient to your care. Open CareTrack to review.",
  });
  await writeAuditLog(user.id, "patient_transfer_requested", "patient", request.patientId, {
    transferRequestId: request.id,
    toProviderId: request.toProviderId,
  });
  res.status(201).json((await loadTransferRequests(user.id, user.role)).find((item) => item.id === request.id));
});

router.post("/coverage/transfers/:id/respond", requireRoles("provider"), async (req, res): Promise<void> => {
  const params = RespondTransferRequestParams.safeParse(req.params);
  const parsed = RespondTransferRequestBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Choose whether to accept or decline this transfer request." });
    return;
  }
  const user = currentUser(res)!;
  const result = await db.transaction(async (tx): Promise<
    { error: string; status: number } | { request: typeof patientTransferRequestsTable.$inferSelect; notificationId: number }
  > => {
    const [request] = await tx
      .select()
      .from(patientTransferRequestsTable)
      .where(eq(patientTransferRequestsTable.id, params.data.id))
      .for("update")
      .limit(1);
    if (!request || request.toProviderId !== user.id) return { error: "Transfer request not found." as const, status: 404 };
    if (request.status !== "pending") return { error: "This transfer request has already been answered." as const, status: 409 };

    if (parsed.data.decision === "accept") {
      const [patient] = await tx
        .select({ id: patientsTable.id })
        .from(patientsTable)
        .where(eq(patientsTable.id, request.patientId))
        .for("update")
        .limit(1);
      if (!patient) return { error: "The patient no longer exists." as const, status: 404 };
      const [assignment] = await tx
        .select({ id: patientProviderAssignmentsTable.id })
        .from(patientProviderAssignmentsTable)
        .where(and(
          eq(patientProviderAssignmentsTable.patientId, request.patientId),
          eq(patientProviderAssignmentsTable.providerId, request.fromProviderId),
        ))
        .limit(1);
      if (!assignment) return { error: "The patient’s current assignment changed. Ask the requesting doctor to submit a new request." as const, status: 409 };
      await tx
        .delete(patientProviderAssignmentsTable)
        .where(eq(patientProviderAssignmentsTable.patientId, request.patientId));
      await tx.insert(patientProviderAssignmentsTable).values({
        patientId: request.patientId,
        providerId: request.toProviderId,
      });
    }

    const [updated] = await tx
      .update(patientTransferRequestsTable)
      .set({
        status: parsed.data.decision === "accept" ? "accepted" : "declined",
        respondedAt: new Date(),
      })
      .where(eq(patientTransferRequestsTable.id, request.id))
      .returning();
    if (!updated) throw new Error("The patient transfer request could not be updated.");
    const [patient] = await tx
      .select({ name: patientsTable.name })
      .from(patientsTable)
      .where(eq(patientsTable.id, updated.patientId))
      .limit(1);
    const [notification] = await tx
      .insert(notificationsTable)
      .values({
        userId: updated.fromProviderId,
        patientId: updated.patientId,
        kind: "coverage",
        title: updated.status === "accepted" ? "Patient transfer accepted" : "Patient transfer declined",
        message: `${user.name} ${updated.status === "accepted" ? "accepted" : "declined"} the transfer request for ${patient?.name ?? "your patient"}.`,
      })
      .returning({ id: notificationsTable.id });
    if (!notification) throw new Error("The patient transfer response notification could not be created.");
    return { request: updated, notificationId: notification.id };
  });
  if ("error" in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  const accepted = result.request.status === "accepted";
  publishUsers([result.request.fromProviderId, result.request.toProviderId], {
    type: "notification",
    patientId: result.request.patientId,
  });
  await sendMessagePush([result.request.fromProviderId], {
    notificationId: result.notificationId,
    url: "/coverage",
    kind: "coverage",
    title: accepted ? "Patient transfer accepted" : "Patient transfer declined",
    body: "Open CareTrack to review the transfer response.",
  });
  await writeAuditLog(user.id, `patient_transfer_${result.request.status}`, "patient", result.request.patientId, {
    transferRequestId: result.request.id,
    fromProviderId: result.request.fromProviderId,
    toProviderId: result.request.toProviderId,
  });
  res.json((await loadTransferRequests(user.id, user.role)).find((item) => item.id === result.request.id));
});

router.get("/coverage", requireRoles("admin", "provider"), async (_req, res): Promise<void> => {
  const user = currentUser(res)!;
  res.json(
    await loadCoverage(
      user.role === "admin"
        ? undefined
        : (or(
            eq(providerCoverageTable.absentProviderId, user.id),
            eq(providerCoverageTable.coveringProviderId, user.id),
          ) as ReturnType<typeof eq>),
    ),
  );
});

router.post("/coverage", requireRoles("admin", "provider"), async (req, res): Promise<void> => {
  const parsed = CreateCoverageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose the absent doctor, the covering doctor and a start date." });
    return;
  }
  const user = currentUser(res)!;
  const { absentProviderId, coveringProviderId, startDate } = parsed.data;
  const endDate = parsed.data.endDate || null;
  // Doctors can hand over their own patients; admins can arrange coverage for anyone.
  if (user.role === "provider" && absentProviderId !== user.id) {
    res.status(403).json({ error: "You can only arrange coverage for your own patients." });
    return;
  }
  if (absentProviderId === coveringProviderId) {
    res.status(400).json({ error: "Choose a different doctor to cover." });
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate))) {
    res.status(400).json({ error: "Dates must be in YYYY-MM-DD format." });
    return;
  }
  if (startDate < manilaDate()) {
    res.status(400).json({ error: "Coverage cannot start in the past." });
    return;
  }
  if (endDate && endDate < startDate) {
    res.status(400).json({ error: "The end date must be on or after the start date." });
    return;
  }
  const providers = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      and(
        inArray(usersTable.id, [absentProviderId, coveringProviderId]),
        eq(usersTable.role, "provider"),
        eq(usersTable.active, true),
      ),
    );
  if (providers.length !== 2) {
    res.status(400).json({ error: "Both people must be active doctors." });
    return;
  }
  const [coverage] = await db
    .insert(providerCoverageTable)
    .values({
      absentProviderId,
      coveringProviderId,
      startDate,
      endDate,
      reason: parsed.data.reason?.trim() || null,
      createdBy: user.id,
    })
    .returning();
  const [result] = await loadCoverage(eq(providerCoverageTable.id, coverage.id));
  const period = `${startDate}${endDate ? ` to ${endDate}` : " until further notice"}`;
  await db.insert(notificationsTable).values([
    {
      userId: coveringProviderId,
      kind: "coverage",
      title: `You're covering for ${result.absentProviderName}`,
      message: `${result.patientCount} patient${result.patientCount === 1 ? "" : "s"} will appear in your list, ${period}. You'll receive their alerts and messages.`,
    },
    {
      userId: absentProviderId,
      kind: "coverage",
      title: `${result.coveringProviderName} is covering your patients`,
      message: `Coverage is in place ${period}.`,
    },
  ]);
  await writeAuditLog(user.id, "coverage_created", "coverage", coverage.id, {
    absentProviderId,
    coveringProviderId,
    startDate,
    endDate,
  });
  res.status(201).json(result);
});

router.post("/coverage/:id/end", requireRoles("admin", "provider"), async (req, res): Promise<void> => {
  const params = EndCoverageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const user = currentUser(res)!;
  const [existing] = await db
    .select()
    .from(providerCoverageTable)
    .where(eq(providerCoverageTable.id, params.data.id))
    .limit(1);
  const involved =
    existing && (existing.absentProviderId === user.id || existing.coveringProviderId === user.id);
  if (!existing || (user.role !== "admin" && !involved)) {
    res.status(404).json({ error: "Coverage not found." });
    return;
  }
  await db
    .update(providerCoverageTable)
    .set({ endedAt: new Date() })
    .where(eq(providerCoverageTable.id, existing.id));
  await writeAuditLog(user.id, "coverage_ended", "coverage", existing.id);
  const [result] = await loadCoverage(eq(providerCoverageTable.id, existing.id));
  res.json(result);
});

export default router;
