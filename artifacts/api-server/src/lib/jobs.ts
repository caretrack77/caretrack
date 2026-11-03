import { and, eq, lte } from "drizzle-orm";
import { db, patientsTable, reportSchedulesTable, usersTable } from "@workspace/db";
import { logger } from "./logger";
import {
  ensureDoseEventsForDate,
  manilaDate,
  markOverdueDoses,
  sendDueReminders,
} from "./dose-scheduler";
import { createReport } from "./report-service";
import { trainAndPredict } from "./ml/risk-model";
import { sendAppointmentReminders } from "../routes/care";

// The Random Forest risk model is retrained on fresh data every 6 hours.
const MODEL_RETRAIN_MS = 6 * 60 * 60 * 1000;
let lastModelTraining = 0;

const JOB_INTERVAL_MS = 60 * 1000;

export function nextRunFor(cadence: string, from = new Date()): Date {
  const next = new Date(from);
  if (cadence === "monthly") {
    next.setMonth(next.getMonth() + 1);
  } else {
    next.setDate(next.getDate() + 7);
  }
  return next;
}

/** Makes sure today's dose events exist for every active patient, so reminders fire on time. */
async function generateTodaysDoses(): Promise<void> {
  const patients = await db
    .select({ id: patientsTable.id })
    .from(patientsTable)
    .where(eq(patientsTable.active, true));
  await ensureDoseEventsForDate(
    manilaDate(),
    patients.map((patient) => patient.id),
  );
}

/** Generates reports for every active schedule whose next run time has arrived. */
async function runDueReportSchedules(): Promise<number> {
  const now = new Date();
  const due = await db
    .select({ schedule: reportSchedulesTable, creator: usersTable })
    .from(reportSchedulesTable)
    .innerJoin(usersTable, eq(usersTable.id, reportSchedulesTable.createdBy))
    .where(
      and(
        eq(reportSchedulesTable.active, true),
        lte(reportSchedulesTable.nextRunAt, now),
      ),
    );
  let generated = 0;
  for (const { schedule, creator } of due) {
    // Advance first so a failing report cannot be retried every minute.
    await db
      .update(reportSchedulesTable)
      .set({ nextRunAt: nextRunFor(schedule.cadence, now) })
      .where(eq(reportSchedulesTable.id, schedule.id));
    if (!creator.active) continue;
    try {
      await createReport(
        creator,
        schedule.cadence === "monthly" ? "monthly" : "weekly",
        schedule.patientId,
      );
      generated += 1;
    } catch (err) {
      logger.warn({ err, scheduleId: schedule.id }, "Scheduled report failed");
    }
  }
  return generated;
}

export type JobCycleResult = {
  reminders: number;
  missed: number;
  reports: number;
};

let running: Promise<JobCycleResult> | null = null;

/** Runs every background task once. Concurrent calls share the same run. */
export function runJobCycle(): Promise<JobCycleResult> {
  running ??= (async () => {
    try {
      await generateTodaysDoses();
      const reminders = await sendDueReminders();
      const missed = await markOverdueDoses();
      const reports = await runDueReportSchedules();
      await sendAppointmentReminders();
      if (Date.now() - lastModelTraining > MODEL_RETRAIN_MS) {
        lastModelTraining = Date.now();
        await trainAndPredict().catch((err) => logger.warn({ err }, "Risk model training failed"));
      }
      if (reminders || missed || reports) {
        logger.info({ reminders, missed, reports }, "Background jobs completed");
      }
      return { reminders, missed, reports };
    } finally {
      running = null;
    }
  })();
  return running;
}

export function startBackgroundJobs(): void {
  const tick = () =>
    runJobCycle().catch((err) => logger.error({ err }, "Background job cycle failed"));
  void tick();
  setInterval(tick, JOB_INTERVAL_MS).unref();
}
