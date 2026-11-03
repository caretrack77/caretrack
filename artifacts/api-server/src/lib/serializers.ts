import type {
  doseLogsTable,
  medicationsTable,
  patientsTable,
} from "@workspace/db";

export function serializePatient(
  patient: typeof patientsTable.$inferSelect,
  assignedProviderId: number | null = null,
  assignedProviderName: string | null = null,
  coveringProviderName: string | null = null,
) {
  return {
    id: patient.id,
    userId: patient.userId,
    name: patient.name,
    age: patient.age,
    sex: patient.sex,
    phone: patient.phone,
    email: patient.email,
    conditions: patient.conditions ?? [],
    allergies: patient.allergies ?? [],
    notes: patient.notes,
    assignedProviderId,
    assignedProviderName,
    coveringProviderName,
    active: patient.active,
    createdAt: patient.createdAt.toISOString(),
  };
}

export function serializeMedication(
  medication: typeof medicationsTable.$inferSelect,
  prescribedByName: string | null = null,
) {
  return {
    id: medication.id,
    patientId: medication.patientId,
    name: medication.name,
    dosage: medication.dosage,
    form: medication.form,
    frequency: medication.frequency,
    timesPerDay: medication.timesPerDay,
    scheduleTimes: medication.scheduleTimes ?? [],
    daysOfWeek: medication.daysOfWeek ?? [],
    intervalHours: medication.intervalHours,
    startDate: medication.startDate,
    endDate: medication.endDate,
    instructions: medication.instructions,
    prescribedBy: medication.prescribedBy,
    prescribedByName,
    active: medication.active,
  };
}

export function serializeDose(
  dose: typeof doseLogsTable.$inferSelect,
  medicationName: string,
  dosage: string,
) {
  return {
    id: dose.id,
    patientId: dose.patientId,
    medicationId: dose.medicationId,
    medicationName,
    dosage,
    scheduledTime: dose.scheduledTime.toISOString(),
    takenTime: dose.takenTime?.toISOString() ?? null,
    status: dose.status,
    notes: dose.notes,
    loggedBy: dose.loggedBy ?? null,
  };
}
