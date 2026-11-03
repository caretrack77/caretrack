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
import { authenticate, currentUser, requireRoles, requireUser, type CurrentUser } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { canAccessPatient, canManagePatient, getVisiblePatientIds } from "../lib/patient-access";
import { careTeamProviderIds } from "../lib/coverage";
import { decryptBuffer, encryptBuffer } from "../lib/encryption";
import { latestPredictions, HEALTH_TIPS } from "../lib/ml/risk-model";
import { manilaDate } from "../lib/dose-scheduler";

const router: IRouter = Router();
router.use(authenticate, requireUser);

const uploader = aliasedTable(usersTable, "uploader");
const reviewer = aliasedTable(usersTable, "reviewer");
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];

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
  const insertedLab = await db
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
    ;
  const [lab] = await db.select().from(labResultsTable).where(eq(labResultsTable.id, Number(insertedLab[0].insertId))).limit(1);
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
  const insertedAppt = await db
    .insert(appointmentsTable)
    .values({ patientId: parsed.data.patientId, providerId, scheduledAt: at, reason: parsed.data.reason.trim(), createdBy: user.id })
    ;
  const [appt] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, Number(insertedAppt[0].insertId))).limit(1);
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
  const dueCandidates = await db.select({ id: appointmentsTable.id }).from(appointmentsTable).where(
    and(
      eq(appointmentsTable.status, "scheduled"),
      gte(appointmentsTable.scheduledAt, now),
      lte(appointmentsTable.scheduledAt, new Date(now.getTime() + 24 * 60 * 60 * 1000)),
      isNull(appointmentsTable.reminderSentAt),
    ),
  );
  await db
    .update(appointmentsTable)
    .set({ reminderSentAt: now })
    .where(
      and(
        eq(appointmentsTable.status, "scheduled"),
        gte(appointmentsTable.scheduledAt, now),
        lte(appointmentsTable.scheduledAt, new Date(now.getTime() + 24 * 60 * 60 * 1000)),
        isNull(appointmentsTable.reminderSentAt),
      ),
    );
  const due = dueCandidates.length
    ? await db.select().from(appointmentsTable).where(inArray(appointmentsTable.id, dueCandidates.map((row) => row.id)))
    : [];
  for (const appt of due) {
    const message = `${appt.reason} on ${whenText(appt.scheduledAt)}.`;
    await notify(await patientSideUsers(appt.patientId), appt.patientId, "appointment", "Check-up tomorrow", message);
    if (appt.providerId) await notify([appt.providerId], appt.patientId, "appointment", "Upcoming check-up", message);
  }
  return due.length;
}

// ---------------------------------------------------------------- Assistant

const TOPIC_WORDS =
  /\b(medicine|medicines|medication|meds?|dose|doses|pill|pills|tablet|capsule|gamot|inom|schedule|remind|reminder|missed|forgot|nakalimutan|late|adherence|progress|streak|doctor|nurse|check-?up|appointment|lab|result|side ?effects?|dizzy|nausea|rash|allerg|pain|caretrack|health|tip|tips|course|refill|today|tomorrow|next|ngayon|bukas|doing|how am i|kumusta ako|my (rate|score|record))\b/i;
const EMERGENCY = /\b(chest pain|can'?t breathe|cannot breathe|difficulty breathing|overdose|suicid|unconscious|seizure|severe bleeding)\b/i;

async function patientFor(user: CurrentUser): Promise<number | null> {
  const ids = await getVisiblePatientIds(user);
  return user.role === "patient" || user.role === "caregiver" ? ids[0] ?? null : null;
}

router.post("/assistant", async (req, res): Promise<void> => {
  const parsed = AskAssistantBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Type a question." });
    return;
  }
  const user = currentUser(res)!;
  const q = parsed.data.message.trim();
  const reply = (text: string, relevant = true, suggestions: string[] = []) => {
    void writeAuditLog(user.id, "assistant_question", "assistant", null, { relevant });
    res.json({ reply: text, relevant, suggestions });
  };
  const defaults = ["When is my next dose?", "What should I do if I missed a dose?", "How am I doing?"];

  if (EMERGENCY.test(q)) {
    reply("This sounds urgent. Call 911 or go to the nearest emergency room now. Do not wait for a reply in the app.", true);
    return;
  }
  if (/^(hi|hello|hey|good (morning|afternoon|evening)|kumusta)\b/i.test(q)) {
    reply("Hi! I’m the CareTrack assistant. I can answer questions about your medicines, schedule, progress and check-ups.", true, defaults);
    return;
  }
  // Topic guard: only questions about medication care are answered.
  if (!TOPIC_WORDS.test(q)) {
    reply("I can only help with your medicines, dose schedule, progress, lab results and check-ups. For anything else, please ask your care team in Messages.", false, defaults);
    return;
  }

  const patientId = await patientFor(user);
  if (!patientId) {
    reply("I answer questions for patients and caregivers about a specific care plan. Open a patient’s profile to see their details.", true);
    return;
  }

  if (/side ?effects?|dizzy|nausea|rash|allerg|pain/i.test(q)) {
    reply("Side effects should be checked by your doctor. Don’t stop a medicine on your own. Send your doctor a message describing what you feel and when it started. If symptoms are severe, go to the nearest clinic or emergency room.", true, ["Message my doctor"]);
    return;
  }
  if (/missed|forgot|nakalimutan|late/i.test(q)) {
    reply("If you missed a dose: take it as soon as you remember, unless it’s almost time for the next one. Then skip the missed dose and continue as usual. Never take a double dose. In CareTrack you can tap “I took it late” within 24 hours. Ask your doctor if you’re unsure.", true);
    return;
  }
  if (/next|when|schedule|today|tomorrow|ngayon|bukas|remind/i.test(q)) {
    const rows = await db
      .select({ name: medicationsTable.name, dosage: medicationsTable.dosage, at: doseLogsTable.scheduledTime, status: doseLogsTable.status })
      .from(doseLogsTable)
      .innerJoin(medicationsTable, eq(medicationsTable.id, doseLogsTable.medicationId))
      .where(and(eq(doseLogsTable.patientId, patientId), gte(doseLogsTable.scheduledTime, new Date(`${manilaDate()}T00:00:00+08:00`))))
      .orderBy(asc(doseLogsTable.scheduledTime))
      .limit(12);
    const next = rows.find((r) => r.status === "scheduled");
    const todayList = rows
      .filter((r) => manilaDate(r.at) === manilaDate())
      .map((r) => `${r.name} ${r.dosage} at ${r.at.toLocaleTimeString("en-US", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" })} (${r.status})`);
    reply(
      `${next ? `Your next dose is ${next.name} ${next.dosage} at ${next.at.toLocaleString("en-US", { timeZone: "Asia/Manila", weekday: "short", hour: "numeric", minute: "2-digit" })}.` : "You have no more doses scheduled today."}${todayList.length ? ` Today: ${todayList.join("; ")}.` : ""}`,
      true,
    );
    return;
  }
  if (/adherence|progress|streak|how am i|doing/i.test(q)) {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await db
      .select({ status: doseLogsTable.status })
      .from(doseLogsTable)
      .where(and(eq(doseLogsTable.patientId, patientId), gte(doseLogsTable.scheduledTime, since), lte(doseLogsTable.scheduledTime, new Date())));
    const logged = rows.filter((r) => r.status !== "scheduled");
    const rate = logged.length ? Math.round((logged.filter((r) => r.status === "taken").length / logged.length) * 100) : 0;
    const [prediction] = await latestPredictions([patientId]);
    const outlook = prediction
      ? prediction.prediction.riskLevel === "low"
        ? " The AI model expects you to stay on track this week."
        : " The AI model suggests a little extra attention this week. Check your tasks on Today’s doses."
      : "";
    reply(`Over the last 30 days you took ${rate}% of your doses (${logged.length} logged).${rate >= 80 ? " Great job, keep it up!" : " Every dose counts, and you can do this."}${outlook}`, true);
    return;
  }
  if (/check-?up|appointment/i.test(q)) {
    const [appt] = await db
      .select()
      .from(appointmentsTable)
      .where(and(eq(appointmentsTable.patientId, patientId), eq(appointmentsTable.status, "scheduled"), gte(appointmentsTable.scheduledAt, new Date())))
      .orderBy(asc(appointmentsTable.scheduledAt))
      .limit(1);
    reply(appt ? `Your next check-up is “${appt.reason}” on ${whenText(appt.scheduledAt)}.` : "You have no upcoming check-up. Your doctor will schedule one when needed.", true);
    return;
  }
  if (/lab|result/i.test(q)) {
    reply("You can upload lab results (PDF or photo) on Today’s doses → Lab results. Files are encrypted, and your doctor is notified to review them.", true);
    return;
  }
  if (/medicine|medicines|medication|meds?|gamot|pill|tablet|capsule|course|refill/i.test(q)) {
    const meds = await db
      .select({ name: medicationsTable.name, dosage: medicationsTable.dosage, times: medicationsTable.scheduleTimes, end: medicationsTable.endDate })
      .from(medicationsTable)
      .where(and(eq(medicationsTable.patientId, patientId), eq(medicationsTable.active, true)));
    reply(meds.length ? `Your current medicines: ${meds.map((m) => `${m.name} ${m.dosage} at ${m.times.join(", ") || "08:00"}${m.end ? ` until ${m.end}` : ""}`).join("; ")}.` : "You have no active medicines yet.", true);
    return;
  }
  reply(`Here’s a health tip: ${HEALTH_TIPS[Math.floor(Date.now() / 86_400_000) % HEALTH_TIPS.length]}`, true, defaults);
});

export default router;
