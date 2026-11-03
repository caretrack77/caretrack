import { asc, count, eq, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  GetMedicationProgressParams,
  GetMedicationProgressResponse,
} from "@workspace/api-zod";
import { db, doseLogsTable, medicationsTable } from "@workspace/db";
import { authenticate, currentUser, requireUser } from "../lib/auth";
import { canAccessPatient } from "../lib/patient-access";
import {
  ensureDoseEventsForDate,
  manilaDate,
  timesForMedication,
} from "../lib/dose-scheduler";

const router: IRouter = Router();
router.use(authenticate, requireUser);

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / DAY_MS,
  );
}

/** Number of doses a medication course plans in total, or null when it has no end date. */
function plannedDoses(medication: typeof medicationsTable.$inferSelect): number | null {
  if (!medication.endDate) return null;
  const perDay = timesForMedication(medication).length;
  if (medication.frequency !== "specific_days" || medication.daysOfWeek.length === 0) {
    return (daysBetween(medication.startDate, medication.endDate) + 1) * perDay;
  }
  let total = 0;
  for (
    let day = new Date(`${medication.startDate}T00:00:00Z`);
    day <= new Date(`${medication.endDate}T00:00:00Z`);
    day = new Date(day.getTime() + DAY_MS)
  ) {
    if ((medication.daysOfWeek as unknown as number[]).includes(day.getUTCDay())) total += perDay;
  }
  return total;
}

router.get("/patients/:id/medication-progress", async (req, res): Promise<void> => {
  const params = GetMedicationProgressParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const user = currentUser(res)!;
  const patientId = params.data.id;
  if (!(await canAccessPatient(user, patientId))) {
    res.status(404).json({ error: "Patient not found." });
    return;
  }
  const today = manilaDate();
  await ensureDoseEventsForDate(today, [patientId]);

  const medications = await db
    .select()
    .from(medicationsTable)
    .where(eq(medicationsTable.patientId, patientId))
    .orderBy(asc(medicationsTable.startDate), asc(medicationsTable.name));

  const now = new Date();
  // Dose counts per medication and status, split into "already due" and "later today".
  const counts = await db
    .select({
      medicationId: doseLogsTable.medicationId,
      status: doseLogsTable.status,
      total: count(),
      due: sql<number>`sum(case when ${doseLogsTable.scheduledTime} <= ${now} then 1 else 0 end)`,
    })
    .from(doseLogsTable)
    .where(eq(doseLogsTable.patientId, patientId))
    .groupBy(doseLogsTable.medicationId, doseLogsTable.status);

  const progress = medications.map((medication) => {
    const rows = counts.filter((row) => row.medicationId === medication.id);
    const sum = (status: string, part: "all" | "due" | "later" = "all") =>
      rows
        .filter((row) => row.status === status)
        .reduce(
          (total, row) =>
            total +
            (part === "all"
              ? Number(row.total)
              : part === "due"
                ? Number(row.due)
                : Number(row.total) - Number(row.due)),
          0,
        );
    const takenCount = sum("taken");
    const missedCount = sum("missed");
    const skippedCount = sum("skipped");
    // Due but not yet marked: the patient has not checked these off.
    const pendingCount = sum("scheduled", "due");
    const upcomingCount = sum("scheduled", "later");
    const logged = takenCount + missedCount + skippedCount;
    const adherenceRate = logged === 0 ? 0 : Math.round((takenCount / logged) * 100);
    const totalDays = medication.endDate
      ? daysBetween(medication.startDate, medication.endDate) + 1
      : null;
    const elapsed = daysBetween(medication.startDate, today) + 1;
    const status = !medication.active
      ? "inactive"
      : today < medication.startDate
        ? "upcoming"
        : medication.endDate && today > medication.endDate
          ? "completed"
          : "active";
    // Green >= 80%, yellow 50-79%, red < 50%. A due dose left unchecked lowers green to yellow.
    let riskLevel: "green" | "yellow" | "red" | "none" =
      logged === 0
        ? pendingCount > 0
          ? "yellow"
          : "none"
        : adherenceRate >= 80
          ? "green"
          : adherenceRate >= 50
            ? "yellow"
            : "red";
    if (riskLevel === "green" && pendingCount > 0) riskLevel = "yellow";
    return {
      medicationId: medication.id,
      name: medication.name,
      dosage: medication.dosage,
      active: medication.active,
      startDate: medication.startDate,
      endDate: medication.endDate,
      status,
      totalDays,
      dayNumber: Math.max(0, totalDays ? Math.min(elapsed, totalDays) : elapsed),
      plannedDoses: plannedDoses(medication),
      takenCount,
      missedCount,
      skippedCount,
      pendingCount,
      upcomingCount,
      adherenceRate,
      riskLevel,
    };
  });
  res.json(GetMedicationProgressResponse.parse(progress));
});

export default router;
