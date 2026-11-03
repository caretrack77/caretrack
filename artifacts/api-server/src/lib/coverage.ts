import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import {
  db,
  patientProviderAssignmentsTable,
  providerCoverageTable,
  usersTable,
} from "@workspace/db";
import { manilaDate } from "./dose-scheduler";

/** Coverage rows in effect today: started, not past their end date, not ended early. */
function activeToday() {
  const today = manilaDate();
  return and(
    lte(providerCoverageTable.startDate, today),
    or(isNull(providerCoverageTable.endDate), gte(providerCoverageTable.endDate, today)),
    isNull(providerCoverageTable.endedAt),
  );
}

/** Providers this user is covering for today. */
export async function coveredProviderIds(userId: number): Promise<number[]> {
  const rows = await db
    .select({ id: providerCoverageTable.absentProviderId })
    .from(providerCoverageTable)
    .where(and(eq(providerCoverageTable.coveringProviderId, userId), activeToday()));
  return [...new Set(rows.map((row) => row.id))];
}

/** Map of absent provider -> covering provider (id and name) for coverage in effect today. */
export async function coveringFor(
  absentProviderIds: number[],
): Promise<Map<number, { id: number; name: string }>> {
  if (absentProviderIds.length === 0) return new Map();
  const rows = await db
    .select({
      absentId: providerCoverageTable.absentProviderId,
      coveringId: providerCoverageTable.coveringProviderId,
      coveringName: usersTable.name,
    })
    .from(providerCoverageTable)
    .innerJoin(usersTable, eq(usersTable.id, providerCoverageTable.coveringProviderId))
    .where(and(inArray(providerCoverageTable.absentProviderId, absentProviderIds), activeToday()));
  return new Map(rows.map((row) => [row.absentId, { id: row.coveringId, name: row.coveringName }]));
}

/** Everyone on a patient's care team today: assigned providers plus anyone covering for them. */
export async function careTeamProviderIds(patientId: number): Promise<number[]> {
  const assigned = await db
    .select({ id: patientProviderAssignmentsTable.providerId })
    .from(patientProviderAssignmentsTable)
    .where(eq(patientProviderAssignmentsTable.patientId, patientId));
  const ids = assigned.map((row) => row.id);
  const covering = await coveringFor(ids);
  return [...new Set([...ids, ...[...covering.values()].map((c) => c.id)])];
}
