import { and, desc, eq, gte } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  GeneratePatientInsightParams,
  GeneratePatientInsightResponse,
  ListPatientInsightsParams,
  ListPatientInsightsResponse,
} from "@workspace/api-zod";
import { aiInsightsTable, db, doseLogsTable } from "@workspace/db";
import { authenticate, currentUser, requireRoles, requireUser } from "../lib/auth";
import { calculateAnalytics } from "../lib/analytics";
import { writeAuditLog } from "../lib/audit";
import { canAccessPatient } from "../lib/patient-access";
import { manilaDate } from "../lib/dose-scheduler";
import { createAiSuggestion } from "../lib/ai-insights";

const router: IRouter = Router();
router.use(authenticate, requireUser);

function thirtyDaysAgo(): string {
  const result = new Date(`${manilaDate()}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() - 29);
  return result.toISOString().slice(0, 10);
}

function responseShape(insight: typeof aiInsightsTable.$inferSelect) {
  return {
    id: insight.id,
    patientId: insight.patientId,
    summary: insight.summary,
    riskLevel: insight.riskLevel,
    recommendations: insight.recommendations,
    source: insight.source,
    createdAt: insight.createdAt.toISOString(),
  };
}

router.get("/patients/:id/insights", async (req, res): Promise<void> => {
  const params = ListPatientInsightsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const user = currentUser(res)!;
  if (!(await canAccessPatient(user, params.data.id))) {
    res.status(404).json({ error: "Patient not found." });
    return;
  }
  const rows = await db
    .select()
    .from(aiInsightsTable)
    .where(eq(aiInsightsTable.patientId, params.data.id))
    .orderBy(desc(aiInsightsTable.createdAt))
    .limit(12);
  res.json(ListPatientInsightsResponse.parse(rows.map(responseShape)));
});

router.post(
  "/patients/:id/insights",
  requireRoles("admin", "provider", "patient"),
  async (req, res): Promise<void> => {
    const params = GeneratePatientInsightParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const user = currentUser(res)!;
    if (!(await canAccessPatient(user, params.data.id))) {
      res.status(404).json({ error: "Patient not found." });
      return;
    }

    const from = thirtyDaysAgo();
    const analytics = await calculateAnalytics(user, {
      patientId: params.data.id,
      from,
    });
    const [missedSlot] = [...analytics.byTimeOfDay].sort(
      (a, b) =>
        b.missedCount / Math.max(1, b.scheduledCount) -
        a.missedCount / Math.max(1, a.scheduledCount),
    );
    const summary =
      analytics.totalDoses === 0
        ? "There is not enough recent dose history yet to identify a pattern. Keep logging doses to build a useful picture."
        : `Adherence was ${analytics.adherenceRate}% across ${analytics.totalDoses} scheduled doses over the last 30 days.${missedSlot?.missedCount ? ` ${missedSlot.period} doses were missed most often.` : " Most scheduled doses were logged as taken."}`;
    const recommendations = [
      missedSlot?.missedCount
        ? `Try pairing your ${missedSlot.period.toLowerCase()} reminder with a routine you already follow.`
        : "Keep using the reminders and routines that are working for you.",
      "A simple daily checklist can make it easier to remember each scheduled dose.",
      "If reminders are not helping, talk with your care team about practical support.",
    ];
    const suggestion = await createAiSuggestion(
      {
        periodDays: 30,
        scheduledDoseCount: analytics.totalDoses,
        takenCount: analytics.takenCount,
        missedCount: analytics.missedCount,
        skippedCount: analytics.skippedCount,
        overallAdherencePercent: analytics.adherenceRate,
        missedByTimeOfDay: analytics.byTimeOfDay.map((item) => ({
          timeOfDay: item.period,
          missedCount: item.missedCount,
          scheduledCount: item.scheduledCount,
        })),
        dailyAdherencePercent: analytics.trend.map((item) => item.adherenceRate),
      },
      summary,
      recommendations,
    );
    const riskLevel =
      analytics.adherenceRate >= 80
        ? "green"
        : analytics.adherenceRate >= 50
          ? "yellow"
          : "red";
    const [insight] = await db
      .insert(aiInsightsTable)
      .values({
        patientId: params.data.id,
        generatedBy: user.id,
        summary: suggestion.summary,
        riskLevel,
        recommendations: suggestion.recommendations,
        source: suggestion.source,
      })
      .returning();
    await writeAuditLog(user.id, "report_generated", "ai_insight", insight.id, {
      patientId: params.data.id,
      source: suggestion.source,
    });
    res
      .status(201)
      .json(GeneratePatientInsightResponse.parse(responseShape(insight)));
  },
);

export default router;
