import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreatePatientAccountBody,
  CreatePatientAccountParams,
  CreatePatientBody,
  CreatePatientResponse,
  GetPatientParams,
  GetPatientResponse,
  ListPatientsResponse,
  UpdatePatientBody,
  UpdatePatientParams,
  UpdatePatientResponse,
} from "@workspace/api-zod";
import {
  db,
  doseLogsTable,
  medicationsTable,
  notificationsTable,
  patientProviderAssignmentsTable,
  patientsTable,
  usersTable,
} from "@workspace/db";
import bcrypt from "bcryptjs";
import { authenticate, currentUser, passwordProblem, requireRoles, requireUser } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { getVisiblePatientIds, canAccessPatient, canManagePatient } from "../lib/patient-access";
import { serializeDose, serializeMedication, serializePatient } from "../lib/serializers";
import { coveringFor } from "../lib/coverage";
import { prescriberNames } from "./medications";

const router: IRouter = Router();
router.use(authenticate, requireUser);

async function patientApiRecord(id: number) {
  const [row] = await db
    .select({
      patient: patientsTable,
      providerId: patientProviderAssignmentsTable.providerId,
      providerName: usersTable.name,
    })
    .from(patientsTable)
    .leftJoin(
      patientProviderAssignmentsTable,
      eq(patientProviderAssignmentsTable.patientId, patientsTable.id),
    )
    .leftJoin(usersTable, eq(usersTable.id, patientProviderAssignmentsTable.providerId))
    .where(eq(patientsTable.id, id))
    .orderBy(asc(patientProviderAssignmentsTable.createdAt))
    .limit(1);
  if (!row) return undefined;
  const covering = row.providerId ? await coveringFor([row.providerId]) : new Map();
  return serializePatient(
    row.patient,
    row.providerId ?? null,
    row.providerName ?? null,
    row.providerId ? covering.get(row.providerId)?.name ?? null : null,
  );
}

/** Makes providerId the patient's assigned doctor, replacing any previous assignment. */
async function assignProvider(patientId: number, providerId: number): Promise<boolean> {
  const [provider] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.id, providerId), eq(usersTable.role, "provider"), eq(usersTable.active, true)))
    .limit(1);
  if (!provider) return false;
  await db
    .delete(patientProviderAssignmentsTable)
    .where(eq(patientProviderAssignmentsTable.patientId, patientId));
  await db.insert(patientProviderAssignmentsTable).values({ patientId, providerId });
  return true;
}

router.get("/patients", async (_req, res): Promise<void> => {
  const user = currentUser(res)!;
  const ids = await getVisiblePatientIds(user);
  if (ids.length === 0) {
    res.json(ListPatientsResponse.parse([]));
    return;
  }

  const rows = await db
    .select({
      patient: patientsTable,
      providerId: patientProviderAssignmentsTable.providerId,
      providerName: usersTable.name,
    })
    .from(patientsTable)
    .leftJoin(
      patientProviderAssignmentsTable,
      eq(patientProviderAssignmentsTable.patientId, patientsTable.id),
    )
    .leftJoin(usersTable, eq(usersTable.id, patientProviderAssignmentsTable.providerId))
    .where(inArray(patientsTable.id, ids))
    .orderBy(asc(patientsTable.name), asc(patientProviderAssignmentsTable.createdAt));

  const covering = await coveringFor(
    [...new Set(rows.map((row) => row.providerId).filter((id): id is number => id !== null))],
  );
  const seen = new Set<number>();
  const patients = rows.flatMap((row) => {
    if (seen.has(row.patient.id)) return [];
    seen.add(row.patient.id);
    return [
      serializePatient(
        row.patient,
        row.providerId ?? null,
        row.providerName ?? null,
        row.providerId ? covering.get(row.providerId)?.name ?? null : null,
      ),
    ];
  });
  res.json(ListPatientsResponse.parse(patients));
});

router.post(
  "/patients",
  requireRoles("admin", "provider"),
  async (req, res): Promise<void> => {
    const parsed = CreatePatientBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const user = currentUser(res)!;
    const inserted = await db
      .insert(patientsTable)
      .values({
        name: parsed.data.name.trim(),
        age: parsed.data.age,
        sex: parsed.data.sex,
        phone: parsed.data.phone?.trim() || null,
        email: parsed.data.email?.trim().toLowerCase() || null,
        conditions: parsed.data.conditions ?? [],
        allergies: parsed.data.allergies ?? [],
        notes: parsed.data.notes?.trim() || null,
      })
      ;
    const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, Number(inserted[0].insertId))).limit(1);

    let providerId: number | null = null;
    if (parsed.data.assignedProviderId) {
      if (!(await assignProvider(patient.id, parsed.data.assignedProviderId))) {
        res.status(400).json({ error: "Choose an active doctor to assign." });
        return;
      }
    } else if (user.role === "provider") {
      providerId = user.id;
    } else {
      const [provider] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(and(eq(usersTable.role, "provider"), eq(usersTable.active, true)))
        .orderBy(asc(usersTable.id))
        .limit(1);
      providerId = provider?.id ?? null;
    }
    if (providerId !== null && !parsed.data.assignedProviderId) {
      await db
        .insert(patientProviderAssignmentsTable)
        .values({ patientId: patient.id, providerId })
        .onDuplicateKeyUpdate({ set: { patientId: patient.id } });
    }

    await writeAuditLog(user.id, "create", "patient", patient.id);
    const output = await patientApiRecord(patient.id);
    res.status(201).json(CreatePatientResponse.parse(output));
  },
);

router.get("/patients/:id", async (req, res): Promise<void> => {
  const params = GetPatientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const user = currentUser(res)!;
  if (!(await canAccessPatient(user, params.data.id))) {
    res.status(404).json({ error: "Patient not found." });
    return;
  }
  const patient = await patientApiRecord(params.data.id);
  if (!patient) {
    res.status(404).json({ error: "Patient not found." });
    return;
  }

  const medications = await db
    .select()
    .from(medicationsTable)
    .where(eq(medicationsTable.patientId, params.data.id))
    .orderBy(desc(medicationsTable.active), asc(medicationsTable.name));
  const prescribers = await prescriberNames(medications.map((m) => m.prescribedBy));
  const doses = await db
    .select({
      dose: doseLogsTable,
      medicationName: medicationsTable.name,
      dosage: medicationsTable.dosage,
    })
    .from(doseLogsTable)
    .innerJoin(medicationsTable, eq(doseLogsTable.medicationId, medicationsTable.id))
    .where(eq(doseLogsTable.patientId, params.data.id))
    .orderBy(desc(doseLogsTable.scheduledTime))
    .limit(20);
  res.json(
    GetPatientResponse.parse({
      ...patient,
      medications: medications.map((m) =>
        serializeMedication(m, m.prescribedBy ? prescribers.get(m.prescribedBy) ?? null : null),
      ),
      recentDoses: doses.map((row) =>
        serializeDose(row.dose, row.medicationName, row.dosage),
      ),
    }),
  );
});

router.patch(
  "/patients/:id",
  requireRoles("admin", "provider"),
  async (req, res): Promise<void> => {
    const params = UpdatePatientParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = UpdatePatientBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const user = currentUser(res)!;
    if (!(await canManagePatient(user, params.data.id))) {
      res.status(404).json({ error: "Patient not found." });
      return;
    }

    const changes: Partial<typeof patientsTable.$inferInsert> = {};
    if (parsed.data.name !== undefined) changes.name = parsed.data.name.trim();
    if (parsed.data.age !== undefined) changes.age = parsed.data.age;
    if (parsed.data.sex !== undefined) changes.sex = parsed.data.sex;
    if (parsed.data.phone !== undefined) changes.phone = parsed.data.phone?.trim() || null;
    if (parsed.data.email !== undefined) {
      changes.email = parsed.data.email?.trim().toLowerCase() || null;
    }
    if (parsed.data.conditions !== undefined) changes.conditions = parsed.data.conditions;
    if (parsed.data.allergies !== undefined) changes.allergies = parsed.data.allergies;
    if (parsed.data.notes !== undefined) changes.notes = parsed.data.notes?.trim() || null;
    if (parsed.data.active !== undefined) changes.active = parsed.data.active;
    const reassignTo = parsed.data.assignedProviderId ?? null;
    if (Object.keys(changes).length === 0 && reassignTo === null) {
      res.status(400).json({ error: "Provide at least one field to update." });
      return;
    }

    if (Object.keys(changes).length > 0) {
      await db.update(patientsTable).set(changes).where(eq(patientsTable.id, params.data.id));
    }
    const patient = { id: params.data.id };
    if (reassignTo !== null) {
      const before = await patientApiRecord(patient.id);
      if (before?.assignedProviderId !== reassignTo) {
        if (!(await assignProvider(patient.id, reassignTo))) {
          res.status(400).json({ error: "Choose an active doctor to assign." });
          return;
        }
        await writeAuditLog(user.id, "patient_reassigned", "patient", patient.id, {
          from: before?.assignedProviderId ?? null,
          to: reassignTo,
        });
        await db.insert(notificationsTable).values({
          userId: reassignTo,
          patientId: patient.id,
          kind: "coverage",
          title: `New patient assigned: ${before?.name ?? "patient"}`,
          message: `${user.name} assigned this patient to you${before?.assignedProviderName ? ` (previously with ${before.assignedProviderName})` : ""}.`,
        });
      }
    }
    await writeAuditLog(user.id, "update", "patient", patient.id, {
      changedFields: Object.keys(changes),
    });
    res.json(UpdatePatientResponse.parse(await patientApiRecord(patient.id)));
  },
);

router.post(
  "/patients/:id/account",
  requireRoles("admin", "provider"),
  async (req, res): Promise<void> => {
    const params = CreatePatientAccountParams.safeParse(req.params);
    const parsed = CreatePatientAccountBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({ error: "Enter a valid email and a temporary password of at least 8 characters." });
      return;
    }
    const user = currentUser(res)!;
    if (!(await canManagePatient(user, params.data.id))) {
      res.status(404).json({ error: "Patient not found." });
      return;
    }
    const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, params.data.id)).limit(1);
    if (!patient) {
      res.status(404).json({ error: "Patient not found." });
      return;
    }
    if (patient.userId) {
      res.status(409).json({ error: "This patient already has a login. Reset the password from Team access instead." });
      return;
    }
    const problem = passwordProblem(parsed.data.password.trim());
    if (problem) {
      res.status(400).json({ error: `Temporary password: ${problem}` });
      return;
    }
    const email = parsed.data.email.trim().toLowerCase();
    const [taken] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (taken) {
      res.status(409).json({ error: "Another account already uses that email." });
      return;
    }
    const phone = parsed.data.phone?.trim() || patient.phone || null;
    const inserted = await db
      .insert(usersTable)
      .values({
        name: patient.name,
        email,
        passwordHash: await bcrypt.hash(parsed.data.password.trim(), 12),
        role: "patient",
        phone,
        // The patient chooses their own password at first sign-in.
        mustChangePassword: true,
      })
      ;
    const [account] = await db.select({ id: usersTable.id, email: usersTable.email }).from(usersTable).where(eq(usersTable.id, Number(inserted[0].insertId))).limit(1);
    await db
      .update(patientsTable)
      .set({ userId: account.id, email: patient.email ?? email, phone: patient.phone ?? phone })
      .where(eq(patientsTable.id, patient.id));
    await writeAuditLog(user.id, "patient_account_created", "patient", patient.id, { userId: account.id });
    res.status(201).json({ userId: account.id, email: account.email });
  },
);

export default router;
