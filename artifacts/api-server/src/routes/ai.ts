import { Router, type IRouter } from "express";
import { GetPatientRiskParams } from "@workspace/api-zod";
import type { modelRunsTable, riskPredictionsTable } from "@workspace/db";
import { authenticate, currentUser, requireRoles, requireUser } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { canAccessPatient, getVisiblePatientIds } from "../lib/patient-access";
import {
  FEATURES,
  HEALTH_TIPS,
  latestModelRun,
  latestPredictions,
  predictionHistory,
  recommendationsFor,
  trainAndPredict,
  type RiskFactor,
} from "../lib/ml/risk-model";

const router: IRouter = Router();
router.use(authenticate, requireUser);

function serializeModel(run: typeof modelRunsTable.$inferSelect | null) {
  if (!run) return null;
  const classes = run.classDistribution as { low?: number; moderate?: number; high?: number };
  return {
    id: run.id,
    algorithm: run.algorithm,
    trees: run.trees,
    maxDepth: run.maxDepth,
    samples: run.samples,
    classLow: classes.low ?? 0,
    classModerate: classes.moderate ?? 0,
    classHigh: classes.high ?? 0,
    oobAccuracy: run.oobAccuracy,
    featureImportance: run.featureImportance as { feature: string; label: string; importance: number }[],
    trainedAt: run.createdAt.toISOString(),
  };
}

function serializePrediction(p: typeof riskPredictionsTable.$inferSelect, patientName: string) {
  return {
    patientId: p.patientId,
    patientName,
    riskLevel: p.riskLevel,
    riskScore: p.riskScore,
    probLow: p.probLow,
    probModerate: p.probModerate,
    probHigh: p.probHigh,
    confidence: Math.max(p.probLow, p.probModerate, p.probHigh),
    factors: p.factors as RiskFactor[],
    createdAt: p.createdAt.toISOString(),
  };
}

router.get("/ai/model", requireRoles("admin", "provider"), async (_req, res): Promise<void> => {
  res.json({
    model: serializeModel(await latestModelRun()),
    parameters: FEATURES.map((f) => f.label),
    windowDays: 14,
    horizonDays: 7,
  });
});

router.post("/ai/model/train", requireRoles("admin", "provider"), async (_req, res): Promise<void> => {
  const user = currentUser(res)!;
  const result = await trainAndPredict(user.id);
  await writeAuditLog(user.id, "ai_model_trained", "model", result.run?.id ?? null, {
    samples: result.run?.samples ?? 0,
    oobAccuracy: result.run?.oobAccuracy ?? null,
    predictions: result.predictions,
  });
  res.json({
    model: serializeModel(result.run),
    predictions: result.predictions,
    message:
      result.reason ??
      `Trained ${result.run!.trees} trees on ${result.run!.samples} examples and updated ${result.predictions} patient predictions.`,
  });
});

router.get("/ai/predictions", requireRoles("admin", "provider"), async (_req, res): Promise<void> => {
  const ids = await getVisiblePatientIds(currentUser(res)!);
  const rows = await latestPredictions(ids);
  res.json(
    rows
      .map((row) => serializePrediction(row.prediction, row.name))
      .sort((a, b) => b.riskScore - a.riskScore),
  );
});

router.get("/patients/:id/risk-prediction", async (req, res): Promise<void> => {
  const params = GetPatientRiskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!(await canAccessPatient(currentUser(res)!, params.data.id))) {
    res.status(404).json({ error: "Patient not found." });
    return;
  }
  const [row] = await latestPredictions([params.data.id]);
  const prediction = row ? serializePrediction(row.prediction, row.name) : null;
  const { care, tasks } = recommendationsFor(prediction?.riskLevel ?? "low", prediction?.factors ?? []);
  // Rotate tips daily so patients see something new.
  const day = Math.floor(Date.now() / 86_400_000);
  const healthTips = [0, 1, 2].map((i) => HEALTH_TIPS[(day + i * 3) % HEALTH_TIPS.length]);
  res.json({
    prediction,
    history: (await predictionHistory(params.data.id))
      .map((h) => ({ ...h, createdAt: h.createdAt.toISOString() }))
      .reverse(),
    careRecommendations: care,
    patientTasks: tasks,
    healthTips,
  });
});

export default router;
