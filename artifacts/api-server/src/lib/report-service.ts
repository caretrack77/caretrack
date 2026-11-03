import { and, desc, eq, gte, inArray, lt, or } from "drizzle-orm";
import {
  db,
  doseLogsTable,
  medicationsTable,
  notificationsTable,
  patientsTable,
  reportsTable,
} from "@workspace/db";
import type { CurrentUser } from "./auth";
import { calculateAnalytics } from "./analytics";
import { createAiSuggestion } from "./ai-insights";
import { canAccessPatient, getVisiblePatientIds } from "./patient-access";
import { manilaDate } from "./dose-scheduler";
import { writeAuditLog } from "./audit";

function daysBefore(date: string, amount: number): string {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() - amount);
  return result.toISOString().slice(0, 10);
}

export function reportWindow(period: string, endDate = manilaDate()) {
  return {
    from: daysBefore(endDate, period === "monthly" ? 29 : 6),
    to: endDate,
  };
}

export function serializeReport(
  report: typeof reportsTable.$inferSelect,
  patientName: string | null,
) {
  return {
    id: report.id,
    patientId: report.patientId,
    patientName,
    period: report.period,
    rangeStart: report.rangeStart,
    rangeEnd: report.rangeEnd,
    adherenceRate: report.adherenceRate,
    summary: report.summary,
    generatedBy: report.generatedBy,
    createdAt: report.createdAt.toISOString(),
  };
}

export async function createReport(
  user: CurrentUser,
  period: "weekly" | "monthly",
  patientId: number | null,
) {
  if (patientId !== null && !(await canAccessPatient(user, patientId))) {
    throw new Error("PATIENT_NOT_FOUND");
  }
  const window = reportWindow(period);
  const analytics = await calculateAnalytics(user, {
    from: window.from,
    to: window.to,
    patientId: patientId ?? undefined,
  });
  const fallbackSummary =
    analytics.totalDoses === 0
      ? `No dose events were logged during this ${period} reporting period.`
      : `${analytics.adherenceRate}% of ${analytics.totalDoses} scheduled doses were logged as taken during this ${period} reporting period. ${analytics.missedCount} doses were missed and ${analytics.skippedCount} were skipped.`;
  const suggestion = await createAiSuggestion(
    {
      reportPeriod: period,
      scheduledDoseCount: analytics.totalDoses,
      takenCount: analytics.takenCount,
      missedCount: analytics.missedCount,
      skippedCount: analytics.skippedCount,
      overallAdherencePercent: analytics.adherenceRate,
      adherenceTrendPercent: analytics.trend.map((item) => item.adherenceRate),
      timeOfDayCounts: analytics.byTimeOfDay,
      medicationAdherencePercent: analytics.byMedication.map((item) => ({
        adherenceRate: item.adherenceRate,
        scheduledCount: item.scheduledCount,
        missedCount: item.missedCount,
      })),
    },
    fallbackSummary,
    [
      "Review missed-dose patterns and discuss practical reminder support with the care team.",
      "Continue logging doses consistently so future reports reflect a complete picture.",
    ],
  );
  const [patient] =
    patientId === null
      ? []
      : await db
          .select({ name: patientsTable.name })
          .from(patientsTable)
          .where(eq(patientsTable.id, patientId))
          .limit(1);
  const [report] = await db
    .insert(reportsTable)
    .values({
      patientId,
      generatedBy: user.id,
      period,
      rangeStart: window.from,
      rangeEnd: window.to,
      adherenceRate: analytics.adherenceRate,
      summary: suggestion.summary,
      reportData: {
        analytics,
        recommendations: suggestion.recommendations,
        source: suggestion.source,
      },
    })
    .returning();
  await db.insert(notificationsTable).values({
    userId: user.id,
    patientId,
    kind: "report",
    title: "Report ready",
    message: `Your ${period} CareTrack adherence report is ready to download.`,
  });
  await writeAuditLog(user.id, "report_generated", "report", report.id, {
    patientId,
    period,
    source: suggestion.source,
  });
  return serializeReport(report, patient?.name ?? null);
}

export async function visibleReports(user: CurrentUser) {
  const visibleIds = await getVisiblePatientIds(user);
  const query = db
    .select({ report: reportsTable, patientName: patientsTable.name })
    .from(reportsTable)
    .leftJoin(patientsTable, eq(patientsTable.id, reportsTable.patientId))
    .orderBy(desc(reportsTable.createdAt));
  const rows =
    user.role === "admin"
      ? await query
      : await query.where(
          visibleIds.length > 0
            ? or(
                eq(reportsTable.generatedBy, user.id),
                inArray(reportsTable.patientId, visibleIds),
              )
            : eq(reportsTable.generatedBy, user.id),
        );
  return rows.map((row) => serializeReport(row.report, row.patientName ?? null));
}

export async function canAccessReport(
  user: CurrentUser,
  report: typeof reportsTable.$inferSelect,
): Promise<boolean> {
  if (user.role === "admin") return true;
  if (report.patientId !== null) {
    return canAccessPatient(user, report.patientId);
  }
  return report.generatedBy === user.id;
}

export async function reportDoseRows(
  report: typeof reportsTable.$inferSelect,
  user: CurrentUser,
) {
  const visibleIds =
    report.patientId !== null
      ? [report.patientId]
      : await getVisiblePatientIds(user);
  if (visibleIds.length === 0) return [];
  const startAt = new Date(`${report.rangeStart}T00:00:00+08:00`);
  const endAt = new Date(`${report.rangeEnd}T00:00:00+08:00`);
  endAt.setDate(endAt.getDate() + 1);
  return db
    .select({
      patientName: patientsTable.name,
      medicationName: medicationsTable.name,
      dosage: medicationsTable.dosage,
      dose: doseLogsTable,
    })
    .from(doseLogsTable)
    .innerJoin(
      medicationsTable,
      eq(doseLogsTable.medicationId, medicationsTable.id),
    )
    .innerJoin(
      patientsTable,
      eq(doseLogsTable.patientId, patientsTable.id),
    )
    .where(
      and(
        inArray(doseLogsTable.patientId, visibleIds),
        gte(doseLogsTable.scheduledTime, startAt),
        lt(doseLogsTable.scheduledTime, endAt),
      ),
    )
    .orderBy(doseLogsTable.scheduledTime);
}
