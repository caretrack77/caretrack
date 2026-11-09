import { and, eq, gte, inArray, lt } from "drizzle-orm";
import {
  db,
  doseLogsTable,
  medicationsTable,
  notificationsTable,
  patientCaregiverAssignmentsTable,
  patientProviderAssignmentsTable,
  patientsTable,
  usersTable,
} from "@workspace/db";
import { careTeamProviderIds } from "./coverage";
import { sendSms, smsConfigured } from "./otp-delivery";

type DoseAlert = {
  patientId: number;
  medicationId: number;
  scheduledTime: Date;
};

/** Patient account and assigned caregivers for clinical notifications. */
export async function patientSideUsers(patientId: number): Promise<number[]> {
  const [patientRows, caregiverRows] = await Promise.all([
    db
      .select({ userId: patientsTable.userId })
      .from(patientsTable)
      .where(eq(patientsTable.id, patientId)),
    db
      .select({ userId: patientCaregiverAssignmentsTable.caregiverId })
      .from(patientCaregiverAssignmentsTable)
      .where(eq(patientCaregiverAssignmentsTable.patientId, patientId)),
  ]);
  return [...new Set(
    [...patientRows, ...caregiverRows]
      .map((row) => row.userId)
      .filter((userId): userId is number => userId !== null),
  )];
}

/** Users who should hear about a patient's own doses: the patient account and linked caregivers. */
async function patientAudience(patientIds: number[]) {
  if (patientIds.length === 0) return new Map<number, number[]>();
  const [patients, caregivers] = await Promise.all([
    db
      .select({ patientId: patientsTable.id, userId: patientsTable.userId })
      .from(patientsTable)
      .where(inArray(patientsTable.id, patientIds)),
    db
      .select({
        patientId: patientCaregiverAssignmentsTable.patientId,
        userId: patientCaregiverAssignmentsTable.caregiverId,
      })
      .from(patientCaregiverAssignmentsTable)
      .where(inArray(patientCaregiverAssignmentsTable.patientId, patientIds)),
  ]);
  const audience = new Map<number, number[]>();
  for (const row of [...patients, ...caregivers]) {
    if (row.userId === null) continue;
    audience.set(row.patientId, [...(audience.get(row.patientId) ?? []), row.userId]);
  }
  return audience;
}

function timeInManila(value: Date): string {
  return value.toLocaleTimeString("en-US", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Sends "dose due" or "dose missed" notifications for the given dose events. */
export async function notifyDoseEvents(
  kind: "reminder" | "overdue",
  doses: DoseAlert[],
): Promise<void> {
  if (doses.length === 0) return;
  const patientIds = [...new Set(doses.map((dose) => dose.patientId))];
  const medicationIds = [...new Set(doses.map((dose) => dose.medicationId))];
  const [audience, medications] = await Promise.all([
    patientAudience(patientIds),
    db
      .select({
        id: medicationsTable.id,
        name: medicationsTable.name,
        dosage: medicationsTable.dosage,
      })
      .from(medicationsTable)
      .where(inArray(medicationsTable.id, medicationIds)),
  ]);
  const medicationById = new Map(medications.map((medication) => [medication.id, medication]));
  const values = doses.flatMap((dose) => {
    const medication = medicationById.get(dose.medicationId);
    const label = medication ? `${medication.name} ${medication.dosage}` : "A medication";
    const time = timeInManila(dose.scheduledTime);
    return (audience.get(dose.patientId) ?? []).map((userId) => ({
      userId,
      patientId: dose.patientId,
      kind,
      title: kind === "reminder" ? "Dose due now" : "Dose marked as missed",
      message:
        kind === "reminder"
          ? `${label} is scheduled for ${time}. Log it once it has been taken.`
          : `${label} scheduled for ${time} was not logged within 2 hours and has been marked as missed.`,
    }));
  });
  if (values.length > 0) {
    await db.insert(notificationsTable).values(values);
  }
  await smsDoseEvents(kind, doses, medicationById);
}

/**
 * Texts dose reminders to the patient's phone, so patients without internet are still
 * reminded. Only runs when an SMS provider is configured (SMS_DOSE_REMINDERS=false turns it off).
 */
async function smsDoseEvents(
  kind: "reminder" | "overdue",
  doses: DoseAlert[],
  medicationById: Map<number, { name: string; dosage: string }>,
): Promise<void> {
  if (!smsConfigured() || process.env.SMS_DOSE_REMINDERS === "false" || doses.length === 0) return;
  const patientIds = [...new Set(doses.map((d) => d.patientId))];
  const rows = await db
    .select({ id: patientsTable.id, phone: patientsTable.phone, userPhone: usersTable.phone })
    .from(patientsTable)
    .leftJoin(usersTable, eq(usersTable.id, patientsTable.userId))
    .where(inArray(patientsTable.id, patientIds));
  for (const dose of doses) {
    const row = rows.find((r) => r.id === dose.patientId);
    const phone = row?.userPhone || row?.phone;
    if (!phone) continue;
    const medication = medicationById.get(dose.medicationId);
    const label = medication ? `${medication.name} ${medication.dosage}` : "your medicine";
    const text =
      kind === "reminder"
        ? `CareTrack: It's time to take ${label} (${timeInManila(dose.scheduledTime)}). Reply not needed.`
        : `CareTrack: ${label} scheduled at ${timeInManila(dose.scheduledTime)} was not logged and is marked missed. Contact your care team if you need help.`;
    await sendSms(phone, text);
  }
}

export async function notifyProvidersForLowAdherence(
  patientId: number,
): Promise<void> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const doses = await db
    .select({ status: doseLogsTable.status })
    .from(doseLogsTable)
    .where(
      and(
        eq(doseLogsTable.patientId, patientId),
        gte(doseLogsTable.scheduledTime, weekAgo),
        lt(doseLogsTable.scheduledTime, now),
      ),
    );
  if (doses.length < 5) return;
  const taken = doses.filter((dose) => dose.status === "taken").length;
  if ((taken / doses.length) * 100 >= 50) return;

  const providers = (await careTeamProviderIds(patientId)).map((providerId) => ({ providerId }));
  const [patient] = await db
    .select({ name: patientsTable.name })
    .from(patientsTable)
    .where(eq(patientsTable.id, patientId))
    .limit(1);
  const recent = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  for (const { providerId } of providers) {
    const [existing] = await db
      .select({ id: notificationsTable.id })
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.userId, providerId),
          eq(notificationsTable.patientId, patientId),
          eq(notificationsTable.kind, "risk"),
          gte(notificationsTable.createdAt, recent),
        ),
      )
      .limit(1);
    if (existing) continue;
    await db.insert(notificationsTable).values({
      userId: providerId,
      patientId,
      kind: "risk",
      title: `Adherence needs attention${patient ? `: ${patient.name}` : ""}`,
      message: `Only ${Math.round((taken / doses.length) * 100)}% of doses in the last 7 days were taken. Review the schedule and consider a supportive check-in.`,
    });
  }
}
