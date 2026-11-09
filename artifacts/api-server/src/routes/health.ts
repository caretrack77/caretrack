import { and, desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db, healthLogsTable, healthMetricRangesTable, healthMetricsTable, notificationsTable } from "@workspace/db";
import { authenticate, currentUser, requireUser } from "../lib/auth";
import { canAccessPatient, canManagePatient } from "../lib/patient-access";
import { writeAuditLog } from "../lib/audit";
import { careTeamProviderIds } from "../lib/coverage";
import { patientSideUsers } from "../lib/notifications";
import { manilaDate } from "../lib/dose-scheduler";
import { DEFAULT_HEALTH_RANGES, healthReadingIsOutOfRange } from "../lib/health-ranges";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

const metricInput = z.object({
  metricType: z.enum(["blood_pressure", "blood_sugar", "weight", "heart_rate", "temperature"]),
  value: z.number().finite(),
  secondaryValue: z.number().finite().optional(),
  unit: z.string().trim().min(1).max(20),
  recordedAt: z.string().datetime().optional(),
  note: z.string().trim().max(500).optional(),
});

const healthLogInput = z.object({
  symptoms: z.array(z.string().trim().min(1).max(80)).max(20),
  notes: z.string().trim().max(1000).optional(),
  recordedAt: z.string().datetime().optional(),
});

router.use("/patients/:patientId/health-metrics", authenticate, requireUser);
router.use("/patients/:patientId/health-logs", authenticate, requireUser);

router.get("/patients/:patientId/health-metrics", async (req, res) => {
  const patientId = Number(req.params.patientId);
  const user = currentUser(res)!;
  if (!(await canAccessPatient(user, patientId))) { res.status(404).json({ error: "Patient not found." }); return; }
  const rows = await db.select().from(healthMetricsTable).where(and(eq(healthMetricsTable.patientId, patientId), eq(healthMetricsTable.active, true))).orderBy(desc(healthMetricsTable.recordedAt));
  res.json(rows);
});

router.post("/patients/:patientId/health-metrics", async (req, res) => {
  const patientId = Number(req.params.patientId);
  const user = currentUser(res)!;
  if (!(await canManagePatient(user, patientId))) { res.status(403).json({ error: "Not allowed to record health metrics for this patient." }); return; }
  const parsed = metricInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  if (parsed.data.recordedAt && manilaDate(new Date(parsed.data.recordedAt)) < manilaDate()) {
    res.status(400).json({ error: "Health measurements cannot be recorded with a past date." });
    return;
  }
  const [range] = await db.select().from(healthMetricRangesTable).where(and(eq(healthMetricRangesTable.patientId, patientId), eq(healthMetricRangesTable.metricType, parsed.data.metricType))).limit(1);
  const defaults = DEFAULT_HEALTH_RANGES;
  const [defaultMin, defaultMax] = defaults[parsed.data.metricType];
  const min = range?.minValue ?? defaultMin;
  const max = parsed.data.metricType === "blood_pressure" && range?.secondaryMaxValue != null ? range.secondaryMaxValue : (range?.maxValue ?? defaultMax);
  const outOfRange = healthReadingIsOutOfRange(parsed.data.metricType, parsed.data.value, parsed.data.secondaryValue, min, max);
  const [created] = await db.insert(healthMetricsTable).values({
    patientId,
    metricType: parsed.data.metricType,
    value: parsed.data.value,
    secondaryValue: parsed.data.secondaryValue ?? null,
    unit: parsed.data.unit,
    recordedAt: parsed.data.recordedAt ? new Date(parsed.data.recordedAt) : new Date(),
    recordedBy: user.id,
    note: parsed.data.note ?? null,
    outOfRange,
  }).returning();
  await writeAuditLog(user.id, "health_metric_recorded", "health_metric", created.id, { patientId, metricType: parsed.data.metricType, outOfRange });
  if (outOfRange) {
    const recipients = [...new Set([...await patientSideUsers(patientId), ...await careTeamProviderIds(patientId)])];
    await db.insert(notificationsTable).values(recipients.map((recipientId) => ({
      userId: recipientId,
      patientId,
      kind: "critical",
      title: "Critical patient reading",
      message: `${parsed.data.metricType.replaceAll("_", " ")} reading is outside the configured safe range.`,
    })));
  }
  res.status(201).json(created);
});

router.get("/patients/:patientId/health-logs", async (req, res) => {
  const patientId = Number(req.params.patientId);
  const user = currentUser(res)!;
  if (!(await canAccessPatient(user, patientId))) { res.status(404).json({ error: "Patient not found." }); return; }
  const rows = await db.select().from(healthLogsTable).where(and(eq(healthLogsTable.patientId, patientId), eq(healthLogsTable.active, true))).orderBy(desc(healthLogsTable.recordedAt));
  res.json(rows);
});

router.post("/patients/:patientId/health-logs", async (req, res) => {
  const patientId = Number(req.params.patientId);
  const user = currentUser(res)!;
  if (!(await canManagePatient(user, patientId))) { res.status(403).json({ error: "Not allowed to record health observations for this patient." }); return; }
  const parsed = healthLogInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  if (parsed.data.recordedAt && manilaDate(new Date(parsed.data.recordedAt)) < manilaDate()) {
    res.status(400).json({ error: "Health logs cannot be recorded with a past date." });
    return;
  }
  const [created] = await db.insert(healthLogsTable).values({
    patientId,
    symptoms: parsed.data.symptoms,
    notes: parsed.data.notes ?? null,
    recordedAt: parsed.data.recordedAt ? new Date(parsed.data.recordedAt) : new Date(),
    recordedBy: user.id,
  }).returning();
  await writeAuditLog(user.id, "health_log_recorded", "health_log", created.id, { patientId, symptoms: parsed.data.symptoms });
  res.status(201).json(created);
});

export default router;
