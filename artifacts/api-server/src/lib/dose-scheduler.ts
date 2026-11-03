import { and, eq, gt, inArray, isNull, lt, lte } from "drizzle-orm";
import { db, doseLogsTable, medicationsTable } from "@workspace/db";
import { notifyDoseEvents, notifyProvidersForLowAdherence } from "./notifications";

export function manilaDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function dateTimeInManila(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+08:00`);
}

export function timesForMedication(medication: typeof medicationsTable.$inferSelect) {
  const configured =
    medication.scheduleTimes?.length > 0 ? medication.scheduleTimes : ["08:00"];
  if (
    medication.frequency !== "every_hours" ||
    !medication.intervalHours ||
    medication.intervalHours < 1
  ) {
    return configured;
  }
  const [startHour = "08", startMinute = "00"] = configured[0].split(":");
  const start = Number(startHour) * 60 + Number(startMinute);
  const interval = medication.intervalHours * 60;
  const times: string[] = [];
  for (let minute = start; minute < 24 * 60; minute += interval) {
    times.push(
      `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`,
    );
  }
  return times;
}

export async function ensureDoseEventsForDate(
  date: string,
  patientIds: number[],
): Promise<void> {
  if (patientIds.length === 0) return;
  const medications = await db
    .select()
    .from(medicationsTable)
    .where(
      and(
        inArray(medicationsTable.patientId, patientIds),
        eq(medicationsTable.active, true),
      ),
    );
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  const events: Array<{
    patientId: number;
    medicationId: number;
    scheduledTime: Date;
    status: string;
  }> = [];
  for (const medication of medications) {
    if (date < medication.startDate || (medication.endDate && date > medication.endDate)) {
      continue;
    }
    if (
      medication.frequency === "specific_days" &&
      medication.daysOfWeek?.length > 0 &&
      !medication.daysOfWeek.includes(weekday)
    ) {
      continue;
    }
    for (const time of timesForMedication(medication)) {
      events.push({
        patientId: medication.patientId,
        medicationId: medication.id,
        scheduledTime: dateTimeInManila(date, time),
        status: "scheduled",
      });
    }
  }
  if (events.length > 0) {
    await db.insert(doseLogsTable).values(events).onConflictDoNothing();
  }
}

export const MISSED_GRACE_PERIOD_MS = 2 * 60 * 60 * 1000;

/**
 * Marks scheduled doses as missed once the grace period has passed, then alerts
 * the patient/caregivers and checks whether providers should be warned.
 * Returns the number of doses that were newly marked as missed.
 */
export async function markOverdueDoses(): Promise<number> {
  const gracePeriod = new Date(Date.now() - MISSED_GRACE_PERIOD_MS);
  const missed = await db
    .update(doseLogsTable)
    .set({
      status: "missed",
      notes: "Automatically marked missed after the 2-hour grace period.",
      loggedBy: "System: not logged within 2 hours",
    })
    .where(
      and(
        eq(doseLogsTable.status, "scheduled"),
        lt(doseLogsTable.scheduledTime, gracePeriod),
      ),
    )
    .returning({
      patientId: doseLogsTable.patientId,
      medicationId: doseLogsTable.medicationId,
      scheduledTime: doseLogsTable.scheduledTime,
    });
  if (missed.length === 0) return 0;
  // Only alert about recent doses, not a backlog from days the server was offline.
  const recent = missed.filter(
    (dose) => dose.scheduledTime.getTime() > Date.now() - 24 * 60 * 60 * 1000,
  );
  await notifyDoseEvents("overdue", recent);
  for (const patientId of new Set(missed.map((dose) => dose.patientId))) {
    await notifyProvidersForLowAdherence(patientId);
  }
  return missed.length;
}

/** Sends a one-time in-app reminder for each dose that has just become due. */
export async function sendDueReminders(): Promise<number> {
  const now = new Date();
  const due = await db
    .update(doseLogsTable)
    .set({ reminderSentAt: now })
    .where(
      and(
        eq(doseLogsTable.status, "scheduled"),
        isNull(doseLogsTable.reminderSentAt),
        lte(doseLogsTable.scheduledTime, now),
        gt(doseLogsTable.scheduledTime, new Date(now.getTime() - MISSED_GRACE_PERIOD_MS)),
      ),
    )
    .returning({
      patientId: doseLogsTable.patientId,
      medicationId: doseLogsTable.medicationId,
      scheduledTime: doseLogsTable.scheduledTime,
    });
  await notifyDoseEvents("reminder", due);
  return due.length;
}
