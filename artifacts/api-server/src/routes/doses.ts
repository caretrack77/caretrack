import { and, asc, eq, gt, gte, inArray, lt, lte } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateDemoDoseBody,
  CreateDemoDoseResponse,
  ListDosesQueryParams,
  ListDosesResponse,
  UpdateDoseStatusBody,
  UpdateDoseStatusParams,
  UpdateDoseStatusResponse,
} from "@workspace/api-zod";
import { db, doseLogsTable, medicationsTable } from "@workspace/db";
import { authenticate, currentUser, requireRoles, requireUser } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { canAccessPatient, canManagePatient, getVisiblePatientIds } from "../lib/patient-access";
import {
  ensureDoseEventsForDate,
  manilaDate,
  markOverdueDoses,
  MISSED_GRACE_PERIOD_MS,
  sendDueReminders,
} from "../lib/dose-scheduler";
import { notifyProvidersForLowAdherence } from "../lib/notifications";
import { serializeDose } from "../lib/serializers";

const router: IRouter = Router();

const PATIENT_CORRECTION_WINDOW_MS = 24 * 60 * 60 * 1000;
const PATIENT_EARLY_WINDOW_MS = 2 * 60 * 60 * 1000;
router.use(authenticate, requireUser);

router.get("/doses", async (req, res): Promise<void> => {
  const query = ListDosesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const user = currentUser(res)!;
  const visibleIds = await getVisiblePatientIds(user);
  if (query.data.patientId !== undefined && !visibleIds.includes(query.data.patientId)) {
    res.status(404).json({ error: "Patient not found." });
    return;
  }
  const dateValue = query.data.date ?? manilaDate();
  const date =
    typeof dateValue === "string"
      ? dateValue
      : dateValue.toISOString().slice(0, 10);
  const patientIds =
    query.data.patientId === undefined ? visibleIds : [query.data.patientId];
  if (patientIds.length === 0) {
    res.json(ListDosesResponse.parse([]));
    return;
  }
  await ensureDoseEventsForDate(date, patientIds);
  await markOverdueDoses();
  const dayStart = new Date(`${date}T00:00:00+08:00`);
  const dayEnd = new Date(`${date}T00:00:00+08:00`);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const rows = await db
    .select({
      dose: doseLogsTable,
      medicationName: medicationsTable.name,
      dosage: medicationsTable.dosage,
    })
    .from(doseLogsTable)
    .innerJoin(medicationsTable, eq(doseLogsTable.medicationId, medicationsTable.id))
    .where(
      and(
        inArray(doseLogsTable.patientId, patientIds),
        gte(doseLogsTable.scheduledTime, dayStart),
        lt(doseLogsTable.scheduledTime, dayEnd),
      ),
    )
    .orderBy(asc(doseLogsTable.scheduledTime));
  res.json(
    ListDosesResponse.parse(
      rows.map((row) => serializeDose(row.dose, row.medicationName, row.dosage)),
    ),
  );
});

router.patch("/doses/:id/status", async (req, res): Promise<void> => {
  const params = UpdateDoseStatusParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateDoseStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = currentUser(res)!;
  if (user.role === "caregiver") {
    res.status(403).json({ error: "Caregiver accounts have read-only access." });
    return;
  }
  const [existing] = await db
    .select()
    .from(doseLogsTable)
    .where(eq(doseLogsTable.id, params.data.id))
    .limit(1);
  if (!existing || !(await canAccessPatient(user, existing.patientId))) {
    res.status(404).json({ error: "Dose not found." });
    return;
  }
  // Patients may only log doses close to their scheduled time, so the record can't be
  // tidied up days later. Doctors and admins can still correct any dose.
  if (user.role === "patient") {
    const offset = Date.now() - existing.scheduledTime.getTime();
    if (offset > PATIENT_CORRECTION_WINDOW_MS) {
      res.status(403).json({
        error: "This dose is more than 24 hours old. Ask your care team if it needs to be corrected.",
      });
      return;
    }
    if (offset < -PATIENT_EARLY_WINDOW_MS) {
      res.status(403).json({ error: "This dose isn't due yet. You can log it up to 2 hours early." });
      return;
    }
  }
  const correctedLate = parsed.data.status === "taken" && existing.status === "missed";
  // Offline-logged doses are synced later; keep the time the patient actually tapped "taken".
  let takenTime = new Date();
  if (parsed.data.takenAt) {
    const at = new Date(parsed.data.takenAt);
    if (!Number.isNaN(at.getTime()) && at.getTime() <= Date.now() && at.getTime() >= existing.scheduledTime.getTime() - 2 * 60 * 60 * 1000) {
      takenTime = at;
    }
  }
  const roleName = { patient: "patient", caregiver: "caregiver", provider: "doctor", admin: "admin" }[user.role] ?? user.role;
  const [dose] = await db
    .update(doseLogsTable)
    .set({
      status: parsed.data.status,
      takenTime: parsed.data.status === "taken" ? takenTime : null,
      loggedBy: parsed.data.status === "scheduled" ? null : `${user.name} (${roleName})`,
      notes:
        parsed.data.notes?.trim() ||
        (correctedLate
          ? `Confirmed late by ${user.role === "patient" ? "the patient" : user.name} after being marked missed.`
          : null),
    })
    .where(eq(doseLogsTable.id, existing.id))
    .returning();
  const [medication] = await db
    .select({ name: medicationsTable.name, dosage: medicationsTable.dosage })
    .from(medicationsTable)
    .where(eq(medicationsTable.id, dose.medicationId))
    .limit(1);
  await writeAuditLog(user.id, "dose_logged", "dose", dose.id, {
    status: dose.status,
    previousStatus: existing.status,
    ...(correctedLate ? { late: true } : {}),
  });
  if (dose.status === "missed" || dose.status === "skipped") {
    await notifyProvidersForLowAdherence(dose.patientId);
  }
  res.json(
    UpdateDoseStatusResponse.parse(
      serializeDose(dose, medication?.name ?? "Medication", medication?.dosage ?? ""),
    ),
  );
});

router.post(
  "/doses/demo-due",
  requireRoles("admin", "provider"),
  async (req, res): Promise<void> => {
    const parsed = CreateDemoDoseBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const user = currentUser(res)!;
    if (!(await canManagePatient(user, parsed.data.patientId))) {
      res.status(404).json({ error: "Patient not found." });
      return;
    }
    const [medication] = await db
      .select()
      .from(medicationsTable)
      .where(
        and(
          eq(medicationsTable.id, parsed.data.medicationId),
          eq(medicationsTable.patientId, parsed.data.patientId),
          eq(medicationsTable.active, true),
        ),
      )
      .limit(1);
    if (!medication) {
      res.status(404).json({ error: "Active medication not found for this patient." });
      return;
    }
    const [dose] = await db
      .insert(doseLogsTable)
      .values({
        patientId: medication.patientId,
        medicationId: medication.id,
        scheduledTime: new Date(),
        status: "scheduled",
      })
      .returning();
    await writeAuditLog(user.id, "demo_dose_created", "dose", dose.id, {
      patientId: medication.patientId,
      medicationId: medication.id,
    });
    // Fire the "dose due" reminder straight away instead of waiting for the next job tick.
    await sendDueReminders();
    res.status(201).json(
      CreateDemoDoseResponse.parse(
        serializeDose(dose, medication.name, medication.dosage),
      ),
    );
  },
);

router.post(
  "/doses/simulate-overdue",
  requireRoles("admin", "provider"),
  async (_req, res): Promise<void> => {
    const user = currentUser(res)!;
    const patientIds = await getVisiblePatientIds(user);
    if (patientIds.length === 0) {
      res.json({ shiftedCount: 0, missedCount: 0 });
      return;
    }
    // Doses that are already due but still inside the grace period.
    const now = new Date();
    const due = await db
      .select({ id: doseLogsTable.id, scheduledTime: doseLogsTable.scheduledTime })
      .from(doseLogsTable)
      .where(
        and(
          inArray(doseLogsTable.patientId, patientIds),
          eq(doseLogsTable.status, "scheduled"),
          lte(doseLogsTable.scheduledTime, now),
          gt(doseLogsTable.scheduledTime, new Date(now.getTime() - MISSED_GRACE_PERIOD_MS)),
        ),
      );
    // Move each one just past the grace period, as if two hours had gone by.
    let shiftedCount = 0;
    for (const dose of due) {
      try {
        await db
          .update(doseLogsTable)
          .set({
            scheduledTime: new Date(
              dose.scheduledTime.getTime() - MISSED_GRACE_PERIOD_MS - 60 * 1000,
            ),
          })
          .where(eq(doseLogsTable.id, dose.id));
        shiftedCount += 1;
      } catch {
        // Another dose of the same medication already occupies that slot; leave this one.
      }
    }
    const missedCount = await markOverdueDoses();
    await writeAuditLog(user.id, "demo_time_simulated", "dose", null, {
      shiftedCount,
      missedCount,
    });
    res.json({ shiftedCount, missedCount });
  },
);

export default router;
