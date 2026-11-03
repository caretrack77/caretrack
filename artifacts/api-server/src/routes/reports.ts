import { and, desc, eq, inArray, or } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateReportScheduleBody,
  DownloadReportCsvParams,
  DownloadReportPdfParams,
  GenerateReportBody,
  UpdateReportScheduleBody,
  UpdateReportScheduleParams,
} from "@workspace/api-zod";
import { db, reportSchedulesTable, reportsTable } from "@workspace/db";
import { authenticate, currentUser, requireRoles, requireUser } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { canManagePatient, getVisiblePatientIds } from "../lib/patient-access";
import { canAccessReport, createReport, visibleReports } from "../lib/report-service";
import { buildReportCsv, buildReportPdf } from "../lib/report-export";
import { nextRunFor } from "../lib/jobs";

const router: IRouter = Router();
router.use(authenticate, requireUser);

function serializeSchedule(schedule: typeof reportSchedulesTable.$inferSelect) {
  return {
    id: schedule.id,
    patientId: schedule.patientId,
    cadence: schedule.cadence,
    nextRunAt: schedule.nextRunAt.toISOString(),
    active: schedule.active,
  };
}

async function loadAccessibleReport(id: number, res: Parameters<typeof currentUser>[0]) {
  const user = currentUser(res)!;
  const [report] = await db
    .select()
    .from(reportsTable)
    .where(eq(reportsTable.id, id))
    .limit(1);
  if (!report || !(await canAccessReport(user, report))) return null;
  return report;
}

function fileName(report: typeof reportsTable.$inferSelect, extension: string) {
  return `caretrack-${report.period}-report-${report.rangeEnd}-${report.id}.${extension}`;
}

router.get("/reports", async (_req, res): Promise<void> => {
  res.json(await visibleReports(currentUser(res)!));
});

router.post(
  "/reports",
  requireRoles("admin", "provider"),
  async (req, res): Promise<void> => {
    const parsed = GenerateReportBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const report = await createReport(
        currentUser(res)!,
        parsed.data.period,
        parsed.data.patientId ?? null,
      );
      res.status(201).json(report);
    } catch (error) {
      if (error instanceof Error && error.message === "PATIENT_NOT_FOUND") {
        res.status(404).json({ error: "Patient not found." });
        return;
      }
      throw error;
    }
  },
);

router.get("/reports/:id/pdf", async (req, res): Promise<void> => {
  const params = DownloadReportPdfParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const report = await loadAccessibleReport(params.data.id, res);
  if (!report) {
    res.status(404).json({ error: "Report not found." });
    return;
  }
  const user = currentUser(res)!;
  const pdf = await buildReportPdf(report, user);
  await writeAuditLog(user.id, "report_downloaded", "report", report.id, { format: "pdf" });
  res
    .status(200)
    .set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName(report, "pdf")}"`,
      "Content-Length": String(pdf.length),
    })
    .send(pdf);
});

router.get("/reports/:id/csv", async (req, res): Promise<void> => {
  const params = DownloadReportCsvParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const report = await loadAccessibleReport(params.data.id, res);
  if (!report) {
    res.status(404).json({ error: "Report not found." });
    return;
  }
  const user = currentUser(res)!;
  const csv = await buildReportCsv(report, user);
  await writeAuditLog(user.id, "report_downloaded", "report", report.id, { format: "csv" });
  res
    .status(200)
    .set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName(report, "csv")}"`,
    })
    .send(csv);
});

router.get("/report-schedules", async (_req, res): Promise<void> => {
  const user = currentUser(res)!;
  const query = db
    .select()
    .from(reportSchedulesTable)
    .orderBy(desc(reportSchedulesTable.createdAt));
  if (user.role === "admin") {
    res.json((await query).map(serializeSchedule));
    return;
  }
  const visibleIds = await getVisiblePatientIds(user);
  const rows = await query.where(
    visibleIds.length > 0
      ? or(
          eq(reportSchedulesTable.createdBy, user.id),
          inArray(reportSchedulesTable.patientId, visibleIds),
        )
      : eq(reportSchedulesTable.createdBy, user.id),
  );
  res.json(rows.map(serializeSchedule));
});

router.post(
  "/report-schedules",
  requireRoles("admin", "provider"),
  async (req, res): Promise<void> => {
    const parsed = CreateReportScheduleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const user = currentUser(res)!;
    const patientId = parsed.data.patientId ?? null;
    if (patientId !== null && !(await canManagePatient(user, patientId))) {
      res.status(404).json({ error: "Patient not found." });
      return;
    }
    const inserted = await db
      .insert(reportSchedulesTable)
      .values({
        createdBy: user.id,
        patientId,
        cadence: parsed.data.cadence,
        nextRunAt: nextRunFor(parsed.data.cadence),
        active: true,
      })
      ;
    const [schedule] = await db.select().from(reportSchedulesTable).where(eq(reportSchedulesTable.id, Number(inserted[0].insertId))).limit(1);
    await writeAuditLog(user.id, "report_schedule_created", "report_schedule", schedule.id, {
      patientId,
      cadence: schedule.cadence,
    });
    res.status(201).json(serializeSchedule(schedule));
  },
);

router.patch(
  "/report-schedules/:id",
  requireRoles("admin", "provider"),
  async (req, res): Promise<void> => {
    const params = UpdateReportScheduleParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = UpdateReportScheduleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const user = currentUser(res)!;
    const ownership =
      user.role === "admin"
        ? eq(reportSchedulesTable.id, params.data.id)
        : and(
            eq(reportSchedulesTable.id, params.data.id),
            eq(reportSchedulesTable.createdBy, user.id),
          );
    const [existing] = await db.select().from(reportSchedulesTable).where(ownership).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Report schedule not found." });
      return;
    }
    await db
      .update(reportSchedulesTable)
      .set({
        active: parsed.data.active,
        // Resuming a paused schedule should not fire immediately for missed runs.
        ...(parsed.data.active && !existing.active && existing.nextRunAt < new Date()
          ? { nextRunAt: nextRunFor(existing.cadence) }
          : {}),
      })
      .where(eq(reportSchedulesTable.id, existing.id))
      ;
    const [schedule] = await db.select().from(reportSchedulesTable).where(eq(reportSchedulesTable.id, existing.id)).limit(1);
    await writeAuditLog(user.id, "report_schedule_updated", "report_schedule", schedule.id, {
      active: schedule.active,
    });
    res.json(serializeSchedule(schedule));
  },
);

export default router;
