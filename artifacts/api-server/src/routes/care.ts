import { createHmac } from "node:crypto";
import { aliasedTable, and, asc, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  AskAssistantBody,
  CreateAppointmentBody,
  DownloadLabResultParams,
  ListLabResultsParams,
  ReviewLabResultBody,
  ReviewLabResultParams,
  UpdateAppointmentBody,
  UpdateAppointmentParams,
  UploadLabResultBody,
  UploadLabResultParams,
} from "@workspace/api-zod";
import {
  appointmentsTable,
  db,
  doseLogsTable,
  labResultsTable,
  medicationsTable,
  notificationsTable,
  patientCaregiverAssignmentsTable,
  patientProviderAssignmentsTable,
  patientsTable,
  usersTable,
} from "@workspace/db";
import { authenticate, currentUser, requireRoles, requireUser } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { canAccessPatient, canManagePatient, getVisiblePatientIds } from "../lib/patient-access";
import { careTeamProviderIds } from "../lib/coverage";
import { decryptBuffer, encryptBuffer } from "../lib/encryption";
import { fileMatchesType } from "../lib/file-validation";
import { chatbotRateLimit } from "../lib/rate-limit";
import {
  CRISIS,
  EMERGENCY,
  INJECTION_REQUEST,
  PROMPT_INJECTION,
  RESTRICTED_MEDICAL_REQUEST,
} from "../lib/chatbot-guards";
import {
  answerFromAssistantRecords,
  assistantRecordIntent,
} from "../lib/assistant-record-answers";
import { ensureDoseEventsForDate, manilaDate } from "../lib/dose-scheduler";

const router: IRouter = Router();
router.use(authenticate, requireUser);

const uploader = aliasedTable(usersTable, "uploader");
const reviewer = aliasedTable(usersTable, "reviewer");
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
function assistantJwt(userId: number): string {
  const secret = process.env.GEMINI_ASSISTANT_JWT_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("Gemini assistant signing secret is not configured.");
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const content = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: String(userId), aud: "caretrack-gemini", iat: now, exp: now + 60 })}`;
  return `${content}.${createHmac("sha256", secret).update(content).digest("base64url")}`;
}

async function geminiAssistantReply(userId: number, message: string, history: { role: "user" | "model"; text: string }[]): Promise<string | null> {
  const configuredUrl = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const databaseUrl = process.env.DATABASE_URL;
  const projectRef = databaseUrl ? decodeURIComponent(new URL(databaseUrl).username).match(/^postgres\.([a-z0-9]+)$/i)?.[1] : null;
  const url = configuredUrl || (projectRef ? `https://${projectRef}.supabase.co` : "");
  if (!url) throw new Error("Supabase project URL cannot be determined.");
  const response = await fetch(`${url}/functions/v1/gemini-assistant`, {
    method: "POST",
    headers: { Authorization: `Bearer ${assistantJwt(userId)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message, history: history.slice(-6) }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`Gemini assistant request failed (${response.status}).`);
  const data = await response.json() as { reply?: unknown };
  return typeof data.reply === "string" && data.reply.trim() ? data.reply.trim() : null;
}

/** The patient account and caregivers linked to a patient profile. */
async function patientSideUsers(patientId: number): Promise<number[]> {
  const [patient] = await db.select({ userId: patientsTable.userId }).from(patientsTable).where(eq(patientsTable.id, patientId)).limit(1);
  const caregivers = await db
    .select({ id: patientCaregiverAssignmentsTable.caregiverId })
    .from(patientCaregiverAssignmentsTable)
    .where(eq(patientCaregiverAssignmentsTable.patientId, patientId));
  return [patient?.userId, ...caregivers.map((c) => c.id)].filter((id): id is number => typeof id === "number");
}

async function notify(userIds: number[], patientId: number, kind: string, title: string, message: string) {
  const unique = [...new Set(userIds)];
  if (unique.length) {
    await db.insert(notificationsTable).values(unique.map((userId) => ({ userId, patientId, kind, title, message })));
  }
}

async function answerFromApiRecords(user: NonNullable<ReturnType<typeof currentUser>>, question: string) {
    const intent = assistantRecordIntent(question);
    if (!intent) return null;

    const patientIds = await getVisiblePatientIds(user);
    if (patientIds.length === 0) {
      return "I couldn't find a patient profile linked to your CareTrack account. Please ask your care team to check your account access.";
    }

    const now = new Date();
    if (intent === "next-dose") {
      const date = new Date(`${manilaDate(now)}T00:00:00.000Z`);
      for (let day = 0; day < 7; day += 1) {
        await ensureDoseEventsForDate(manilaDate(date), patientIds);
        date.setUTCDate(date.getUTCDate() + 1);
      }
      const rows = await db
        .select({
          medicationName: medicationsTable.name,
          dosage: medicationsTable.dosage,
          scheduledTime: doseLogsTable.scheduledTime,
          patientName: patientsTable.name,
        })
        .from(doseLogsTable)
        .innerJoin(medicationsTable, eq(doseLogsTable.medicationId, medicationsTable.id))
        .innerJoin(patientsTable, eq(doseLogsTable.patientId, patientsTable.id))
        .where(and(
          inArray(doseLogsTable.patientId, patientIds),
          eq(doseLogsTable.status, "scheduled"),
          gte(doseLogsTable.scheduledTime, now),
          lte(doseLogsTable.scheduledTime, new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)),
        ))
        .orderBy(asc(doseLogsTable.scheduledTime))
        .limit(10);
      const names = new Set(rows.map((row) => row.patientName));
      return answerFromAssistantRecords(question, intent, rows.map((row) => ({
        ...row,
        patientName: names.size > 1 ? row.patientName : undefined,
      })));
    }

    if (intent === "missed-dose") {
      const rows = await db
        .select({
          medicationName: medicationsTable.name,
          dosage: medicationsTable.dosage,
          scheduledTime: doseLogsTable.scheduledTime,
          patientName: patientsTable.name,
        })
        .from(doseLogsTable)
        .innerJoin(medicationsTable, eq(doseLogsTable.medicationId, medicationsTable.id))
        .innerJoin(patientsTable, eq(doseLogsTable.patientId, patientsTable.id))
        .where(and(
          inArray(doseLogsTable.patientId, patientIds),
          eq(doseLogsTable.status, "missed"),
          gte(doseLogsTable.scheduledTime, new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)),
          lte(doseLogsTable.scheduledTime, now),
        ))
        .orderBy(desc(doseLogsTable.scheduledTime))
        .limit(10);
      const names = new Set(rows.map((row) => row.patientName));
      return answerFromAssistantRecords(question, intent, rows.map((row) => ({
        ...row,
        patientName: names.size > 1 ? row.patientName : undefined,
      })));
    }

    if (intent === "medications") {
      const rows = await db
        .select({
          name: medicationsTable.name,
          dosage: medicationsTable.dosage,
          frequency: medicationsTable.frequency,
          timesPerDay: medicationsTable.timesPerDay,
          scheduleTimes: medicationsTable.scheduleTimes,
          daysOfWeek: medicationsTable.daysOfWeek,
          intervalHours: medicationsTable.intervalHours,
          instructions: medicationsTable.instructions,
          patientName: patientsTable.name,
        })
        .from(medicationsTable)
        .innerJoin(patientsTable, eq(medicationsTable.patientId, patientsTable.id))
        .where(and(
          inArray(medicationsTable.patientId, patientIds),
          eq(medicationsTable.active, true),
        ))
        .orderBy(asc(patientsTable.name), asc(medicationsTable.name))
        .limit(20);
      const names = new Set(rows.map((row) => row.patientName));
      return answerFromAssistantRecords(question, intent, rows.map((row) => ({
        ...row,
        scheduleTimes: row.scheduleTimes ?? [],
        daysOfWeek: row.daysOfWeek ?? [],
        patientName: names.size > 1 ? row.patientName : undefined,
      })));
    }

    if (intent === "appointment") {
      const rows = await db
        .select({
          scheduledAt: appointmentsTable.scheduledAt,
          reason: appointmentsTable.reason,
          patientName: patientsTable.name,
        })
        .from(appointmentsTable)
        .innerJoin(patientsTable, eq(appointmentsTable.patientId, patientsTable.id))
        .where(and(
          inArray(appointmentsTable.patientId, patientIds),
          eq(appointmentsTable.status, "scheduled"),
          gte(appointmentsTable.scheduledAt, now),
        ))
        .orderBy(asc(appointmentsTable.scheduledAt))
        .limit(10);
      const names = new Set(rows.map((row) => row.patientName));
      return answerFromAssistantRecords(question, intent, rows.map((row) => ({
        ...row,
        patientName: names.size > 1 ? row.patientName : undefined,
      })));
    }

    const rows = await db
      .select({ status: doseLogsTable.status })
      .from(doseLogsTable)
      .where(and(
        inArray(doseLogsTable.patientId, patientIds),
        gte(doseLogsTable.scheduledTime, new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)),
        lte(doseLogsTable.scheduledTime, now),
      ));
    return answerFromAssistantRecords(question, intent, rows);
}

// ---------------------------------------------------------------- Lab results

async function labRows(where: ReturnType<typeof eq>) {
  const rows = await db
    .select({
      lab: labResultsTable,
      uploadedByName: uploader.name,
      uploadedByRole: uploader.role,
      reviewedByName: reviewer.name,
    })
    .from(labResultsTable)
    .leftJoin(uploader, eq(uploader.id, labResultsTable.uploadedBy))
    .leftJoin(reviewer, eq(reviewer.id, labResultsTable.reviewedBy))
    .where(where)
    .orderBy(desc(labResultsTable.createdAt));
  return rows.map(({ lab, uploadedByName, uploadedByRole, reviewedByName }) => ({
    id: lab.id,
    patientId: lab.patientId,
    category: lab.category,
    title: lab.title,
    fileName: lab.fileName,
    mimeType: lab.mimeType,
    sizeBytes: lab.sizeBytes,
    notes: lab.notes,
    uploadedByName: uploadedByName ? `${uploadedByName}${uploadedByRole === "provider" ? " (doctor)" : ""}` : "Unknown",
    reviewComment: lab.reviewComment,
    reviewedByName: reviewedByName ?? null,
    reviewedAt: lab.reviewedAt?.toISOString() ?? null,
    createdAt: lab.createdAt.toISOString(),
  }));
}

router.get("/patients/:id/lab-results", async (req, res): Promise<void> => {
  const params = ListLabResultsParams.safeParse(req.params);
  if (!params.success || !(await canAccessPatient(currentUser(res)!, params.data.id))) {
    res.status(404).json({ error: "Patient not found." });
    return;
  }
  res.json(await labRows(eq(labResultsTable.patientId, params.data.id)));
});

router.post("/patients/:id/lab-results", async (req, res): Promise<void> => {
  const params = UploadLabResultParams.safeParse(req.params);
  const parsed = UploadLabResultBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Add a title and choose a file." });
    return;
  }
  const user = currentUser(res)!;
  const patientId = params.data.id;
  const category = parsed.data.category ?? "lab";
  const allowed =
    user.role === "patient" ? await canAccessPatient(user, patientId) : await canManagePatient(user, patientId);
  if (!allowed) {
    res.status(403).json({ error: "You can't upload files for this patient." });
    return;
  }
  if (category === "prescription" && user.role !== "provider" && user.role !== "admin") {
    res.status(403).json({ error: "Only the care team can upload prescriptions." });
    return;
  }
  if (!ALLOWED_TYPES.includes(parsed.data.mimeType)) {
    res.status(400).json({ error: "Upload a PDF or an image (PNG, JPG or WebP)." });
    return;
  }
  const data = Buffer.from(parsed.data.dataBase64, "base64");
  if (data.length === 0 || data.length > MAX_FILE_BYTES) {
    res.status(400).json({ error: "The file must be smaller than 5 MB." });
    return;
  }
  if (!fileMatchesType(data, parsed.data.mimeType)) {
    res.status(400).json({ error: "This file doesn't look like a real PDF or image. Choose the original file and try again." });
    return;
  }
  const [lab] = await db
    .insert(labResultsTable)
    .values({
      patientId,
      uploadedBy: user.id,
      category,
      title: parsed.data.title.trim(),
      fileName: parsed.data.fileName.replace(/[^\w.\- ]+/g, "_").slice(0, 200),
      mimeType: parsed.data.mimeType,
      sizeBytes: data.length,
      encryptedData: encryptBuffer(data),
      notes: parsed.data.notes?.trim() || null,
    })
    .returning();
  const [patient] = await db.select({ name: patientsTable.name }).from(patientsTable).where(eq(patientsTable.id, patientId)).limit(1);
  if (user.role === "patient") {
    await notify(await careTeamProviderIds(patientId), patientId, "lab", `New lab result from ${patient?.name}`, `"${lab.title}" was uploaded and is waiting for your review.`);
  } else {
    await notify(
      await patientSideUsers(patientId),
      patientId,
      category === "prescription" ? "prescription" : "lab",
      category === "prescription" ? "New prescription from your doctor" : "New lab result added",
      category === "prescription"
        ? `${user.name} uploaded "${lab.title}". Open My prescriptions to view it.`
        : `${user.name} added "${lab.title}" to your records.`,
    );
  }
  await writeAuditLog(user.id, category === "prescription" ? "prescription_uploaded" : "lab_result_uploaded", "lab_result", lab.id, { patientId, sizeBytes: data.length });
  res.status(201).json((await labRows(eq(labResultsTable.id, lab.id)))[0]);
});

router.get("/lab-results/:id/file", async (req, res): Promise<void> => {
  const params = DownloadLabResultParams.safeParse(req.params);
  const [lab] = params.success
    ? await db.select().from(labResultsTable).where(eq(labResultsTable.id, params.data.id)).limit(1)
    : [];
  const user = currentUser(res)!;
  if (!lab || !(await canAccessPatient(user, lab.patientId))) {
    res.status(404).json({ error: "File not found." });
    return;
  }
  const file = decryptBuffer(lab.encryptedData);
  await writeAuditLog(user.id, "lab_result_viewed", "lab_result", lab.id, { patientId: lab.patientId });
  res
    .status(200)
    .set({
      "Content-Type": lab.mimeType,
      "Content-Disposition": `inline; filename="${lab.fileName.replace(/"/g, "")}"`,
      "Content-Length": String(file.length),
      "Cache-Control": "private, no-store",
    })
    .send(file);
});

router.post("/lab-results/:id/review", requireRoles("admin", "provider"), async (req, res): Promise<void> => {
  const params = ReviewLabResultParams.safeParse(req.params);
  const parsed = ReviewLabResultBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Write a review comment." });
    return;
  }
  const user = currentUser(res)!;
  const [lab] = await db.select().from(labResultsTable).where(eq(labResultsTable.id, params.data.id)).limit(1);
  if (!lab || !(await canManagePatient(user, lab.patientId))) {
    res.status(404).json({ error: "Lab result not found." });
    return;
  }
  await db
    .update(labResultsTable)
    .set({ reviewComment: parsed.data.comment.trim(), reviewedBy: user.id, reviewedAt: new Date() })
    .where(eq(labResultsTable.id, lab.id));
  await notify(await patientSideUsers(lab.patientId), lab.patientId, "lab", "Your doctor reviewed a lab result", `${user.name} added a comment on "${lab.title}".`);
  await writeAuditLog(user.id, "lab_result_reviewed", "lab_result", lab.id, { patientId: lab.patientId });
  res.json((await labRows(eq(labResultsTable.id, lab.id)))[0]);
});

// ------------------------------------------------------------- Appointments

const apptProvider = aliasedTable(usersTable, "appt_provider");

async function appointmentRows(patientIds: number[], id?: number) {
  if (patientIds.length === 0 && id === undefined) return [];
  const rows = await db
    .select({ appt: appointmentsTable, patientName: patientsTable.name, providerName: apptProvider.name })
    .from(appointmentsTable)
    .innerJoin(patientsTable, eq(patientsTable.id, appointmentsTable.patientId))
    .leftJoin(apptProvider, eq(apptProvider.id, appointmentsTable.providerId))
    .where(id !== undefined ? eq(appointmentsTable.id, id) : inArray(appointmentsTable.patientId, patientIds))
    .orderBy(asc(appointmentsTable.scheduledAt));
  return rows.map(({ appt, patientName, providerName }) => ({
    id: appt.id,
    patientId: appt.patientId,
    patientName,
    providerId: appt.providerId,
    providerName: providerName ?? null,
    scheduledAt: appt.scheduledAt.toISOString(),
    reason: appt.reason,
    status: appt.status,
    notes: appt.notes,
  }));
}

const whenText = (date: Date) =>
  date.toLocaleString("en-US", { timeZone: "Asia/Manila", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

router.get("/appointments", async (_req, res): Promise<void> => {
  res.json(await appointmentRows(await getVisiblePatientIds(currentUser(res)!)));
});

router.post("/appointments", requireRoles("admin", "provider"), async (req, res): Promise<void> => {
  const parsed = CreateAppointmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a patient, date and reason." });
    return;
  }
  const user = currentUser(res)!;
  const at = new Date(parsed.data.scheduledAt);
  if (Number.isNaN(at.getTime()) || at.getTime() < Date.now() - 60 * 60 * 1000) {
    res.status(400).json({ error: "Choose a date and time in the future." });
    return;
  }
  if (!(await canManagePatient(user, parsed.data.patientId))) {
    res.status(404).json({ error: "Patient not found." });
    return;
  }
  let providerId: number | null = user.role === "provider" ? user.id : null;
  if (providerId === null) {
    const [assigned] = await db
      .select({ id: patientProviderAssignmentsTable.providerId })
      .from(patientProviderAssignmentsTable)
      .where(eq(patientProviderAssignmentsTable.patientId, parsed.data.patientId))
      .limit(1);
    providerId = assigned?.id ?? null;
  }
  const [appt] = await db
    .insert(appointmentsTable)
    .values({ patientId: parsed.data.patientId, providerId, scheduledAt: at, reason: parsed.data.reason.trim(), createdBy: user.id })
    .returning();
  await notify(await patientSideUsers(appt.patientId), appt.patientId, "appointment", "Check-up scheduled", `${appt.reason} on ${whenText(at)}.`);
  await writeAuditLog(user.id, "appointment_created", "appointment", appt.id, { patientId: appt.patientId });
  res.status(201).json((await appointmentRows([], appt.id))[0]);
});

router.patch("/appointments/:id", requireRoles("admin", "provider"), async (req, res): Promise<void> => {
  const params = UpdateAppointmentParams.safeParse(req.params);
  const parsed = UpdateAppointmentBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid update." });
    return;
  }
  const user = currentUser(res)!;
  const [appt] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, params.data.id)).limit(1);
  if (!appt || !(await canManagePatient(user, appt.patientId))) {
    res.status(404).json({ error: "Appointment not found." });
    return;
  }
  const changes: Partial<typeof appointmentsTable.$inferInsert> = {};
  if (parsed.data.status) changes.status = parsed.data.status;
  if (parsed.data.notes !== undefined) changes.notes = parsed.data.notes?.trim() || null;
  if (parsed.data.scheduledAt) {
    const at = new Date(parsed.data.scheduledAt);
    if (Number.isNaN(at.getTime())) {
      res.status(400).json({ error: "Invalid date." });
      return;
    }
    changes.scheduledAt = at;
    changes.reminderSentAt = null;
  }
  await db.update(appointmentsTable).set(changes).where(eq(appointmentsTable.id, appt.id));
  if (parsed.data.status === "cancelled" || parsed.data.scheduledAt) {
    await notify(
      await patientSideUsers(appt.patientId),
      appt.patientId,
      "appointment",
      parsed.data.status === "cancelled" ? "Check-up cancelled" : "Check-up rescheduled",
      parsed.data.status === "cancelled"
        ? `${appt.reason} on ${whenText(appt.scheduledAt)} was cancelled.`
        : `${appt.reason} is now on ${whenText(changes.scheduledAt!)}.`,
    );
  }
  await writeAuditLog(user.id, "appointment_updated", "appointment", appt.id, { ...parsed.data });
  res.json((await appointmentRows([], appt.id))[0]);
});

/** Background job: remind patients and doctors about check-ups in the next 24 hours. */
export async function sendAppointmentReminders(): Promise<number> {
  const now = new Date();
  const due = await db
    .update(appointmentsTable)
    .set({ reminderSentAt: now })
    .where(
      and(
        eq(appointmentsTable.status, "scheduled"),
        gte(appointmentsTable.scheduledAt, now),
        lte(appointmentsTable.scheduledAt, new Date(now.getTime() + 24 * 60 * 60 * 1000)),
        isNull(appointmentsTable.reminderSentAt),
      ),
    )
    .returning();
  for (const appt of due) {
    const message = `${appt.reason} on ${whenText(appt.scheduledAt)}.`;
    await notify(await patientSideUsers(appt.patientId), appt.patientId, "appointment", "Check-up tomorrow", message);
    if (appt.providerId) await notify([appt.providerId], appt.patientId, "appointment", "Upcoming check-up", message);
  }
  return due.length;
}

// ---------------------------------------------------------------- Assistant


router.post("/assistant", chatbotRateLimit, async (req, res): Promise<void> => {
  const parsed = AskAssistantBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Type a question." }); return; }
  const user = currentUser(res)!;
  if (!["patient", "caretaker", "caregiver"].includes(user.role)) {
    res.status(403).json({ error: "The CareTrack assistant is only available to patients and caregivers." });
    return;
  }
  const q = parsed.data.message.trim();
  const defaults = ["When is my next dose?", "What should I do if I missed a dose?", "How am I doing?"];
  const reply = (text: string, relevant = true) => {
    void writeAuditLog(user.id, "assistant_question", "assistant", null, { relevant });
    res.json({ reply: text, relevant, suggestions: defaults });
  };
  if (EMERGENCY.test(q)) { reply("This sounds urgent. Call 911 or go to the nearest emergency room now. Do not wait for a reply in the app."); return; }
  if (CRISIS.test(q)) { reply("I'm sorry you're feeling this way. Please contact a trusted person and call local emergency services or a crisis hotline now. If you are in immediate danger, go to the nearest emergency room."); return; }
  if (RESTRICTED_MEDICAL_REQUEST.test(q)) { reply("I can't diagnose or change medications. Please ask your doctor or pharmacist. You can message your doctor through CareTrack."); return; }
  if (INJECTION_REQUEST.test(q)) { reply("Do not give yourself injections unless your doctor or pharmacist has trained you and provided instructions. For an injection question, missed injection, or a possible reaction, contact your doctor or pharmacist promptly."); return; }
  if (PROMPT_INJECTION.test(q)) { reply("I can only help with your medicines, dose schedule, progress, lab results and check-ups. I cannot change my safety instructions.", false); return; }
  try {
    const recordAnswer = await answerFromApiRecords(user, q);
    if (recordAnswer) { reply(recordAnswer); return; }
  } catch (error) {
    req.log?.warn({ err: error }, "Could not answer from CareTrack records; trying Gemini");
  }
  try {
    const answer = await geminiAssistantReply(user.id, q, parsed.data.history ?? []);
    if (!answer) { res.status(502).json({ error: "CareTrack AI returned an empty answer." }); return; }
    reply(answer);
  } catch (error) {
    req.log?.error({ err: error }, "Gemini assistant request failed");
    res.status(503).json({ error: "Gemini AI is not available. Try a question about your next dose, medication schedule, upcoming check-up, or recent dose progress." });
  }
});
export default router;
