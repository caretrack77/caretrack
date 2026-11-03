import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db, doseLogsTable, medicationsTable, patientsTable } from "@workspace/db";
import { GetAnalyticsResponse } from "@workspace/api-zod";
import type { CurrentUser } from "./auth";
import { getVisiblePatientIds } from "./patient-access";
import { manilaDate } from "./dose-scheduler";

function asDate(value: string | Date | undefined, fallback: string): string {
  if (value === undefined) return fallback;
  return typeof value === "string" ? value : value.toISOString().slice(0, 10);
}

function daysBefore(date: string, amount: number): string {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() - amount);
  return result.toISOString().slice(0, 10);
}

function timeOfDay(value: Date): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Manila",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(value)
      .find((part) => part.type === "hour")?.value ?? "0",
  );
  if (hour < 12) return "Morning";
  if (hour < 17) return "Afternoon";
  return "Evening";
}

function percent(taken: number, scheduled: number): number {
  return scheduled === 0 ? 0 : Math.round((taken / scheduled) * 100);
}

export async function calculateAnalytics(
  user: CurrentUser,
  filters: {
    from?: string | Date;
    to?: string | Date;
    patientId?: number;
    medicationId?: number;
  } = {},
) {
  const to = asDate(filters.to, manilaDate());
  const from = asDate(filters.from, daysBefore(to, 29));
  const visibleIds = await getVisiblePatientIds(user);
  const patientIds =
    filters.patientId === undefined
      ? visibleIds
      : visibleIds.includes(filters.patientId)
        ? [filters.patientId]
        : [];
  if (patientIds.length === 0) {
    return GetAnalyticsResponse.parse({
      totalPatients: 0,
      totalDoses: 0,
      takenCount: 0,
      missedCount: 0,
      skippedCount: 0,
      adherenceRate: 0,
      highRiskPatients: 0,
      trend: [],
      byMedication: [],
      byTimeOfDay: [],
      riskPatients: [],
    });
  }

  const startAt = new Date(`${from}T00:00:00+08:00`);
  const endAt = new Date(`${to}T00:00:00+08:00`);
  endAt.setDate(endAt.getDate() + 1);
  const conditions = [
    inArray(doseLogsTable.patientId, patientIds),
    gte(doseLogsTable.scheduledTime, startAt),
    lt(doseLogsTable.scheduledTime, endAt),
    lt(doseLogsTable.scheduledTime, new Date()),
  ];
  if (filters.medicationId !== undefined) {
    conditions.push(eq(doseLogsTable.medicationId, filters.medicationId));
  }
  const rows = await db
    .select({
      dose: doseLogsTable,
      medicationName: medicationsTable.name,
      patientName: patientsTable.name,
    })
    .from(doseLogsTable)
    .innerJoin(
      medicationsTable,
      eq(doseLogsTable.medicationId, medicationsTable.id),
    )
    .innerJoin(patientsTable, eq(doseLogsTable.patientId, patientsTable.id))
    .where(and(...conditions))
    .orderBy(asc(doseLogsTable.scheduledTime));

  const totals = { taken: 0, missed: 0, skipped: 0, scheduled: 0 };
  const daily = new Map<string, { taken: number; total: number }>();
  const medicationMap = new Map<
    number,
    { name: string; taken: number; missed: number; total: number }
  >();
  const patientMap = new Map<
    number,
    { name: string; taken: number; missed: number; total: number }
  >();
  const timeMap = new Map<
    string,
    { missedCount: number; scheduledCount: number }
  >();

  for (const row of rows) {
    const status = row.dose.status;
    totals.scheduled += 1;
    if (status === "taken") totals.taken += 1;
    if (status === "missed") totals.missed += 1;
    if (status === "skipped") totals.skipped += 1;

    const dateKey = manilaDate(row.dose.scheduledTime);
    const point = daily.get(dateKey) ?? { taken: 0, total: 0 };
    point.total += 1;
    if (status === "taken") point.taken += 1;
    daily.set(dateKey, point);

    const med = medicationMap.get(row.dose.medicationId) ?? {
      name: row.medicationName,
      taken: 0,
      missed: 0,
      total: 0,
    };
    med.total += 1;
    if (status === "taken") med.taken += 1;
    if (status === "missed") med.missed += 1;
    medicationMap.set(row.dose.medicationId, med);

    const patient = patientMap.get(row.dose.patientId) ?? {
      name: row.patientName,
      taken: 0,
      missed: 0,
      total: 0,
    };
    patient.total += 1;
    if (status === "taken") patient.taken += 1;
    if (status === "missed") patient.missed += 1;
    patientMap.set(row.dose.patientId, patient);

    const period = timeOfDay(row.dose.scheduledTime);
    const time = timeMap.get(period) ?? { missedCount: 0, scheduledCount: 0 };
    time.scheduledCount += 1;
    if (status === "missed") time.missedCount += 1;
    timeMap.set(period, time);
  }

  const riskPatients = Array.from(patientMap, ([patientId, patient]) => {
    const adherenceRate = percent(patient.taken, patient.total);
    return {
      patientId,
      patientName: patient.name,
      adherenceRate,
      riskLevel:
        adherenceRate >= 80 ? "green" : adherenceRate >= 50 ? "yellow" : "red",
      missedCount: patient.missed,
    };
  }).sort((a, b) => a.adherenceRate - b.adherenceRate);

  return GetAnalyticsResponse.parse({
    totalPatients: patientIds.length,
    totalDoses: totals.scheduled,
    takenCount: totals.taken,
    missedCount: totals.missed,
    skippedCount: totals.skipped,
    adherenceRate: percent(totals.taken, totals.scheduled),
    highRiskPatients: riskPatients.filter((patient) => patient.riskLevel === "red")
      .length,
    trend: Array.from(daily, ([date, data]) => ({
      date,
      adherenceRate: percent(data.taken, data.total),
    })),
    byMedication: Array.from(medicationMap, ([medicationId, medication]) => ({
      medicationId,
      medicationName: medication.name,
      adherenceRate: percent(medication.taken, medication.total),
      scheduledCount: medication.total,
      missedCount: medication.missed,
    })),
    byTimeOfDay: ["Morning", "Afternoon", "Evening"].map((period) => ({
      period,
      missedCount: timeMap.get(period)?.missedCount ?? 0,
      scheduledCount: timeMap.get(period)?.scheduledCount ?? 0,
    })),
    riskPatients,
  });
}
