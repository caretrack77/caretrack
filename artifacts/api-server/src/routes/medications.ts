import { asc, eq, inArray } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateMedicationBody,
  CreateMedicationResponse,
  DeleteMedicationParams,
  ListMedicationsQueryParams,
  ListMedicationsResponse,
  UpdateMedicationBody,
  UpdateMedicationParams,
  UpdateMedicationResponse,
} from "@workspace/api-zod";
import { db, medicationsTable, usersTable } from "@workspace/db";
import { authenticate, currentUser, requireRoles, requireUser } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { canManagePatient, getVisiblePatientIds } from "../lib/patient-access";
import { ensureDoseEventsForDate, manilaDate } from "../lib/dose-scheduler";
import { serializeMedication } from "../lib/serializers";

const router: IRouter = Router();

export async function prescriberNames(
  ids: (number | null)[],
): Promise<Map<number, string>> {
  const unique = [...new Set(ids.filter((id): id is number => id !== null))];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({ id: usersTable.id, name: usersTable.name })
    .from(usersTable)
    .where(inArray(usersTable.id, unique));
  return new Map(rows.map((row) => [row.id, row.name]));
}

router.use(authenticate, requireUser);

function calendarDate(value: string | Date): string {
  return typeof value === "string" ? value : value.toISOString().slice(0, 10);
}

async function findMedication(id: number) {
  const [medication] = await db
    .select()
    .from(medicationsTable)
    .where(eq(medicationsTable.id, id))
    .limit(1);
  return medication;
}

router.get("/medications", async (req, res): Promise<void> => {
  const query = ListMedicationsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const user = currentUser(res)!;
  const visibleIds = await getVisiblePatientIds(user);
  if (
    query.data.patientId !== undefined &&
    !visibleIds.includes(query.data.patientId)
  ) {
    res.status(404).json({ error: "Patient not found." });
    return;
  }
  const patientIds =
    query.data.patientId === undefined ? visibleIds : [query.data.patientId];
  if (patientIds.length === 0) {
    res.json(ListMedicationsResponse.parse([]));
    return;
  }
  const rows = await db
    .select()
    .from(medicationsTable)
    .where(inArray(medicationsTable.patientId, patientIds))
    .orderBy(asc(medicationsTable.patientId), asc(medicationsTable.name));
  const names = await prescriberNames(rows.map((row) => row.prescribedBy));
  res.json(
    ListMedicationsResponse.parse(
      rows.map((row) =>
        serializeMedication(
          row,
          row.prescribedBy ? names.get(row.prescribedBy) ?? null : null,
        ),
      ),
    ),
  );
});

router.post(
  "/medications",
  requireRoles("admin", "provider"),
  async (req, res): Promise<void> => {
    const parsed = CreateMedicationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const user = currentUser(res)!;
    if (!(await canManagePatient(user, parsed.data.patientId))) {
      res.status(404).json({ error: "Patient not found." });
      return;
    }
    const inserted = await db.insert(medicationsTable).values({
      patientId: parsed.data.patientId,
      name: parsed.data.name.trim(),
      dosage: parsed.data.dosage.trim(),
      form: parsed.data.form,
      frequency: parsed.data.frequency,
      timesPerDay: parsed.data.timesPerDay,
      scheduleTimes: parsed.data.scheduleTimes,
      daysOfWeek: parsed.data.daysOfWeek ?? [],
      intervalHours: parsed.data.intervalHours ?? null,
      startDate: calendarDate(parsed.data.startDate),
      endDate:
        parsed.data.endDate == null
          ? null
          : calendarDate(parsed.data.endDate),
      instructions: parsed.data.instructions?.trim() || null,
      prescribedBy: user.id,
    });
    const medication = await findMedication(Number(inserted[0].insertId));
    if (!medication) {
      res.status(500).json({ error: "Medication could not be created." });
      return;
    }
    await ensureDoseEventsForDate(manilaDate(), [medication.patientId]);
    await writeAuditLog(user.id, "create", "medication", medication.id, {
      patientId: medication.patientId,
    });
    res
      .status(201)
      .json(CreateMedicationResponse.parse(serializeMedication(medication)));
  },
);

router.patch(
  "/medications/:id",
  requireRoles("admin", "provider"),
  async (req, res): Promise<void> => {
    const params = UpdateMedicationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = UpdateMedicationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const existing = await findMedication(params.data.id);
    if (!existing) {
      res.status(404).json({ error: "Medication not found." });
      return;
    }
    const user = currentUser(res)!;
    if (!(await canManagePatient(user, existing.patientId))) {
      res.status(404).json({ error: "Medication not found." });
      return;
    }

    const changes: Partial<typeof medicationsTable.$inferInsert> = {};
    if (parsed.data.name !== undefined) changes.name = parsed.data.name.trim();
    if (parsed.data.dosage !== undefined) changes.dosage = parsed.data.dosage.trim();
    if (parsed.data.form !== undefined) changes.form = parsed.data.form;
    if (parsed.data.frequency !== undefined) changes.frequency = parsed.data.frequency;
    if (parsed.data.timesPerDay !== undefined) changes.timesPerDay = parsed.data.timesPerDay;
    if (parsed.data.scheduleTimes !== undefined) changes.scheduleTimes = parsed.data.scheduleTimes;
    if (parsed.data.daysOfWeek !== undefined) changes.daysOfWeek = parsed.data.daysOfWeek;
    if (parsed.data.intervalHours !== undefined) changes.intervalHours = parsed.data.intervalHours;
    if (parsed.data.startDate !== undefined) {
      changes.startDate = calendarDate(parsed.data.startDate);
    }
    if (parsed.data.endDate !== undefined) {
      changes.endDate =
        parsed.data.endDate === null ? null : calendarDate(parsed.data.endDate);
    }
    if (parsed.data.instructions !== undefined) {
      changes.instructions = parsed.data.instructions?.trim() || null;
    }
    if (parsed.data.active !== undefined) changes.active = parsed.data.active;
    if (Object.keys(changes).length === 0) {
      res.status(400).json({ error: "Provide at least one field to update." });
      return;
    }
    await db
      .update(medicationsTable)
      .set(changes)
      .where(eq(medicationsTable.id, existing.id));
    const medication = await findMedication(existing.id);
    if (!medication) {
      res.status(404).json({ error: "Medication not found." });
      return;
    }
    await ensureDoseEventsForDate(manilaDate(), [medication.patientId]);
    await writeAuditLog(user.id, "update", "medication", medication.id, {
      changedFields: Object.keys(changes),
    });
    res.json(UpdateMedicationResponse.parse(serializeMedication(medication)));
  },
);

router.delete(
  "/medications/:id",
  requireRoles("admin", "provider"),
  async (req, res): Promise<void> => {
    const params = DeleteMedicationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const existing = await findMedication(params.data.id);
    if (!existing) {
      res.status(404).json({ error: "Medication not found." });
      return;
    }
    const user = currentUser(res)!;
    if (!(await canManagePatient(user, existing.patientId))) {
      res.status(404).json({ error: "Medication not found." });
      return;
    }
    await db
      .update(medicationsTable)
      .set({ active: false })
      .where(eq(medicationsTable.id, existing.id));
    await writeAuditLog(user.id, "deactivate", "medication", existing.id, {
      patientId: existing.patientId,
    });
    res.status(204).send();
  },
);

export default router;
