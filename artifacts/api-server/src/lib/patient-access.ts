import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  patientCaregiverAssignmentsTable,
  patientProviderAssignmentsTable,
  patientsTable,
  usersTable,
} from "@workspace/db";
import type { CurrentUser } from "./auth";
import { coveredProviderIds } from "./coverage";

export async function getVisiblePatientIds(user: CurrentUser): Promise<number[]> {
  if (user.role === "admin") {
    const rows = await db
      .select({ id: patientsTable.id })
      .from(patientsTable)
      .where(eq(patientsTable.active, true));
    return rows.map((row) => row.id);
  }
  if (user.role === "provider") {
    const providerIds = [user.id, ...(await coveredProviderIds(user.id))];
    const rows = await db
      .select({ id: patientProviderAssignmentsTable.patientId })
      .from(patientProviderAssignmentsTable)
      .innerJoin(
        patientsTable,
        eq(patientProviderAssignmentsTable.patientId, patientsTable.id),
      )
      .where(
        and(
          inArray(patientProviderAssignmentsTable.providerId, providerIds),
          eq(patientsTable.active, true),
        ),
      );
    return [...new Set(rows.map((row) => row.id))];
  }
  if (user.role === "patient") {
    const rows = await db
      .select({ id: patientsTable.id })
      .from(patientsTable)
      .where(and(eq(patientsTable.userId, user.id), eq(patientsTable.active, true)));
    return rows.map((row) => row.id);
  }
  if (user.role === "caregiver") {
    const rows = await db
      .select({ id: patientCaregiverAssignmentsTable.patientId })
      .from(patientCaregiverAssignmentsTable)
      .innerJoin(
        patientsTable,
        eq(patientCaregiverAssignmentsTable.patientId, patientsTable.id),
      )
      .where(
        and(
          eq(patientCaregiverAssignmentsTable.caregiverId, user.id),
          eq(patientsTable.active, true),
        ),
      );
    return rows.map((row) => row.id);
  }
  return [];
}

export async function canAccessPatient(
  user: CurrentUser,
  patientId: number,
): Promise<boolean> {
  const ids = await getVisiblePatientIds(user);
  return ids.includes(patientId);
}

export async function canManagePatient(
  user: CurrentUser,
  patientId: number,
): Promise<boolean> {
  if (user.role === "admin") {
    const [patient] = await db
      .select({ id: patientsTable.id })
      .from(patientsTable)
      .where(eq(patientsTable.id, patientId))
      .limit(1);
    return Boolean(patient);
  }
  if (user.role !== "provider") return false;
  const providerIds = [user.id, ...(await coveredProviderIds(user.id))];
  const [assignment] = await db
    .select({ id: patientProviderAssignmentsTable.id })
    .from(patientProviderAssignmentsTable)
    .where(
      and(
        inArray(patientProviderAssignmentsTable.providerId, providerIds),
        eq(patientProviderAssignmentsTable.patientId, patientId),
      ),
    )
    .limit(1);
  return Boolean(assignment);
}

export type PatientRecord = typeof patientsTable.$inferSelect;
export type UserRecord = typeof usersTable.$inferSelect;
