import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  db,
  consultationsTable,
  medicalHistoryTable,
  medicationsTable,
  notificationsTable,
  prescriptionsTable,
  recordHistoryTable,
} from "@workspace/db";
import { authenticate, currentUser, requireRoles, requireUser } from "../lib/auth";
import { canAccessPatient, canManagePatient } from "../lib/patient-access";
import { writeAuditLog } from "../lib/audit";
import { ensureDoseEventsForDate, manilaDate } from "../lib/dose-scheduler";
import { patientSideUsers } from "../lib/notifications";

const router: IRouter = Router();
router.use(authenticate, requireUser);

const historyInput = z.object({
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().trim().min(1).max(160),
  notes: z.string().trim().max(2000).optional(),
});

function historyPayload(row: { before: unknown; after: unknown }) {
  return { before: row.before ?? {}, after: row.after ?? {} };
}

router.get("/patients/:patientId/medical-history", async (req, res) => {
  const patientId = Number(req.params.patientId);
  const user = currentUser(res)!;
  if (!(await canAccessPatient(user, patientId))) return void res.status(404).json({ error: "Patient not found." });
  const rows = await db.select().from(medicalHistoryTable)
    .where(and(eq(medicalHistoryTable.patientId, patientId), eq(medicalHistoryTable.active, true)))
    .orderBy(desc(medicalHistoryTable.occurredOn));
  res.json(rows);
});

router.post("/patients/:patientId/medical-history", async (req, res) => {
  const patientId = Number(req.params.patientId);
  const user = currentUser(res)!;
  if (user.role !== "patient" && user.role !== "provider" && user.role !== "admin") return void res.status(403).json({ error: "Not allowed to add medical history." });
  if (!(await canManagePatient(user, patientId))) return void res.status(403).json({ error: "Not allowed to add medical history for this patient." });
  const parsed = historyInput.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.message });
  const [created] = await db.insert(medicalHistoryTable).values({ patientId, ...parsed.data, enteredBy: user.id }).returning();
  await writeAuditLog(user.id, "medical_history_created", "medical_history", created.id, { patientId });
  res.status(201).json(created);
});

router.patch("/patients/:patientId/medical-history/:id", requireRoles("admin", "provider"), async (req, res) => {
  const patientId = Number(req.params.patientId);
  const id = Number(req.params.id);
  const user = currentUser(res)!;
  if (!(await canManagePatient(user, patientId))) return void res.status(404).json({ error: "Medical history not found." });
  const parsed = historyInput.partial().safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data).length === 0) return void res.status(400).json({ error: "Provide a valid history change." });
  const [before] = await db.select().from(medicalHistoryTable).where(and(eq(medicalHistoryTable.id, id), eq(medicalHistoryTable.patientId, patientId), eq(medicalHistoryTable.active, true))).limit(1);
  if (!before) return void res.status(404).json({ error: "Medical history not found." });
  const [after] = await db.update(medicalHistoryTable).set(parsed.data).where(eq(medicalHistoryTable.id, id)).returning();
  await db.insert(recordHistoryTable).values({ entity: "medical_history", entityId: id, action: "update", changedBy: user.id, before: before as object, after: after as object });
  await writeAuditLog(user.id, "medical_history_updated", "medical_history", id, { patientId });
  res.json(after);
});

router.delete("/patients/:patientId/medical-history/:id", requireRoles("admin", "provider"), async (req, res) => {
  const patientId = Number(req.params.patientId), id = Number(req.params.id), user = currentUser(res)!;
  if (!(await canManagePatient(user, patientId))) return void res.status(404).json({ error: "Medical history not found." });
  const [before] = await db.select().from(medicalHistoryTable).where(and(eq(medicalHistoryTable.id, id), eq(medicalHistoryTable.patientId, patientId), eq(medicalHistoryTable.active, true))).limit(1);
  if (!before) return void res.status(404).json({ error: "Medical history not found." });
  const [after] = await db.update(medicalHistoryTable).set({ active: false, deletedAt: new Date() }).where(eq(medicalHistoryTable.id, id)).returning();
  await db.insert(recordHistoryTable).values({ entity: "medical_history", entityId: id, action: "delete", changedBy: user.id, before: before as object, after: after as object });
  await writeAuditLog(user.id, "medical_history_deleted", "medical_history", id, { patientId });
  res.status(204).end();
});

router.get("/patients/:patientId/consultations", async (req, res) => {
  const patientId = Number(req.params.patientId), user = currentUser(res)!;
  if (!(await canAccessPatient(user, patientId))) return void res.status(404).json({ error: "Patient not found." });
  const rows = await db.select().from(consultationsTable).where(and(eq(consultationsTable.patientId, patientId), eq(consultationsTable.active, true))).orderBy(desc(consultationsTable.consultationDate));
  res.json(rows);
});

const consultationInput = z.object({
  consultationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  complaint: z.string().trim().min(1).max(1000),
  assessment: z.string().trim().max(2000).optional(),
  notes: z.string().trim().max(4000).optional(),
  followUp: z.string().trim().max(2000).optional(),
  appointmentId: z.number().int().positive().optional(),
});

router.post("/patients/:patientId/consultations", requireRoles("admin", "provider"), async (req, res) => {
  const patientId = Number(req.params.patientId), user = currentUser(res)!;
  if (!(await canManagePatient(user, patientId))) return void res.status(403).json({ error: "Not allowed to record a consultation for this patient." });
  const parsed = consultationInput.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.message });
  const [created] = await db.insert(consultationsTable).values({ patientId, providerId: user.role === "provider" ? user.id : null, ...parsed.data }).returning();
  await writeAuditLog(user.id, "consultation_created", "consultation", created.id, { patientId });
  res.status(201).json(created);
});

router.get("/patients/:patientId/prescriptions", async (req, res) => {
  const patientId = Number(req.params.patientId), user = currentUser(res)!;
  if (!(await canAccessPatient(user, patientId))) return void res.status(404).json({ error: "Patient not found." });
  const rows = await db.select().from(prescriptionsTable).where(and(eq(prescriptionsTable.patientId, patientId), eq(prescriptionsTable.active, true))).orderBy(desc(prescriptionsTable.prescribedAt));
  res.json(rows);
});

const prescriptionInput = z.object({
  medicationName: z.string().trim().min(1).max(160),
  dosage: z.string().trim().min(1).max(80),
  frequency: z.string().trim().min(1).max(80),
  durationDays: z.number().int().min(1).max(365),
  instructions: z.string().trim().max(2000).optional(),
  scheduleTimes: z.array(z.string().regex(/^\d{2}:\d{2}$/)).min(1).max(12),
  form: z.string().trim().min(1).max(40).optional(),
});

router.post("/consultations/:consultationId/prescriptions", requireRoles("admin", "provider"), async (req, res) => {
  const consultationId = Number(req.params.consultationId);
  const parsed = prescriptionInput.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.message });
  const [consultation] = await db.select().from(consultationsTable).where(and(eq(consultationsTable.id, consultationId), eq(consultationsTable.active, true))).limit(1);
  if (!consultation) return void res.status(404).json({ error: "Consultation not found." });
  const user = currentUser(res)!;
  if (!(await canManagePatient(user, consultation.patientId))) return void res.status(403).json({ error: "Not allowed to prescribe for this patient." });
  const startDate = manilaDate();
  const end = new Date(`${startDate}T00:00:00+08:00`);
  end.setDate(end.getDate() + parsed.data.durationDays - 1);
  const endDate = end.toISOString().slice(0, 10);
  const timesPerDay = parsed.data.scheduleTimes.length;
  const [medication] = await db.insert(medicationsTable).values({
    patientId: consultation.patientId,
    name: parsed.data.medicationName,
    dosage: parsed.data.dosage,
    form: parsed.data.form ?? "tablet",
    frequency: "daily",
    timesPerDay,
    scheduleTimes: parsed.data.scheduleTimes,
    startDate,
    endDate,
    instructions: parsed.data.instructions ?? null,
    prescribedBy: user.id,
  }).returning();
  const [prescription] = await db.insert(prescriptionsTable).values({
    consultationId, patientId: consultation.patientId, providerId: user.id,
    medicationName: parsed.data.medicationName, dosage: parsed.data.dosage,
    frequency: parsed.data.frequency, durationDays: parsed.data.durationDays,
    instructions: parsed.data.instructions ?? null, scheduleTimes: parsed.data.scheduleTimes,
    medicationId: medication.id,
  }).returning();
  await ensureDoseEventsForDate(startDate, [consultation.patientId]);
  const recipients = await patientSideUsers(consultation.patientId);
  if (recipients.length) await db.insert(notificationsTable).values(recipients.map((userId) => ({
    userId, patientId: consultation.patientId, kind: "prescription",
    title: "New prescription",
    message: `${parsed.data.medicationName} ${parsed.data.dosage}. ${parsed.data.instructions ?? "Follow the dose schedule in CareTrack."}`,
  })));
  await writeAuditLog(user.id, "prescription_created", "prescription", prescription.id, {
    patientId: consultation.patientId, medicationId: medication.id, scheduleTimes: parsed.data.scheduleTimes,
  });
  res.status(201).json({ prescription, medication });
});

router.get("/patients/:patientId/record-history", requireRoles("admin", "provider"), async (req, res) => {
  const patientId = Number(req.params.patientId), user = currentUser(res)!;
  if (!(await canManagePatient(user, patientId))) return void res.status(404).json({ error: "Patient not found." });
  const entities = await db.select({ id: medicalHistoryTable.id }).from(medicalHistoryTable).where(eq(medicalHistoryTable.patientId, patientId));
  const consultationIds = await db.select({ id: consultationsTable.id }).from(consultationsTable).where(eq(consultationsTable.patientId, patientId));
  const prescriptionIds = await db.select({ id: prescriptionsTable.id }).from(prescriptionsTable).where(eq(prescriptionsTable.patientId, patientId));
  const medicationIds = await db.select({ id: medicationsTable.id }).from(medicationsTable).where(eq(medicationsTable.patientId, patientId));
  const allowed = [...entities.map(r => ["medical_history", r.id]), ...consultationIds.map(r => ["consultation", r.id]), ...prescriptionIds.map(r => ["prescription", r.id]), ...medicationIds.map(r => ["medication", r.id])] as [string, number][];
  const rows = await db.select().from(recordHistoryTable).orderBy(desc(recordHistoryTable.changedAt));
  res.json(rows.filter(r => allowed.some(([entity, id]) => r.entity === entity && r.entityId === id)).map(historyPayload));
});

export default router;
