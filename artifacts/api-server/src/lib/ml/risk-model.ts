import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  doseLogsTable,
  medicationsTable,
  modelRunsTable,
  notificationsTable,
  patientsTable,
  riskPredictionsTable,
} from "@workspace/db";
import { RandomForest, type Sample } from "./random-forest";
import { careTeamProviderIds } from "../coverage";
import { logger } from "../logger";

/**
 * Health-risk prediction: will this patient have poor medication adherence in the next 7 days?
 *
 * Input parameters (computed from the last 14 days of each patient's history):
 * adherence rates, trend, missed-dose streak, time-of-day patterns, lateness, skips,
 * regimen complexity, age and number of conditions.
 *
 * Output classes: 0 = low risk (>= 80% expected adherence), 1 = moderate (50-79%), 2 = high (< 50%).
 */

const DAY = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 14;
const HORIZON_DAYS = 7;
export const RISK_LEVELS = ["low", "moderate", "high"] as const;

export const FEATURES = [
  { key: "adherence14", label: "14-day adherence", unit: "%", riskWhenHigh: false },
  { key: "adherence7", label: "7-day adherence", unit: "%", riskWhenHigh: false },
  { key: "trend", label: "Weekly adherence trend", unit: " pts", riskWhenHigh: false },
  { key: "missedStreak", label: "Missed doses in a row", unit: "", riskWhenHigh: true },
  { key: "eveningMissRate", label: "Evening doses missed", unit: "%", riskWhenHigh: true },
  { key: "morningMissRate", label: "Morning doses missed", unit: "%", riskWhenHigh: true },
  { key: "lateRate", label: "Doses taken late (>1 hour)", unit: "%", riskWhenHigh: true },
  { key: "skipRate", label: "Doses skipped", unit: "%", riskWhenHigh: true },
  { key: "dailyDoses", label: "Doses per day", unit: "", riskWhenHigh: true },
  { key: "activeMeds", label: "Active medications", unit: "", riskWhenHigh: true },
  { key: "age", label: "Age", unit: " yrs", riskWhenHigh: true },
  { key: "conditions", label: "Number of conditions", unit: "", riskWhenHigh: true },
] as const;
type FeatureKey = (typeof FEATURES)[number]["key"];

type Dose = {
  patientId: number;
  medicationId: number;
  scheduledTime: Date;
  takenTime: Date | null;
  status: string;
};
type PatientInfo = { id: number; name: string; age: number; conditions: string[] };

function manilaHour(date: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(date)
      .find((p) => p.type === "hour")?.value ?? 0,
  );
}

const pct = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((part / whole) * 100));

/** The 12 model inputs for one patient at a reference time, from the 14 days before it. */
function featuresAt(patient: PatientInfo, doses: Dose[], at: Date): Record<FeatureKey, number> | null {
  const start = at.getTime() - WINDOW_DAYS * DAY;
  const mid = at.getTime() - 7 * DAY;
  const window = doses.filter(
    (d) => d.scheduledTime.getTime() >= start && d.scheduledTime.getTime() < at.getTime() && d.status !== "scheduled",
  );
  if (window.length < 5) return null;
  const recent = window.filter((d) => d.scheduledTime.getTime() >= mid);
  const earlier = window.filter((d) => d.scheduledTime.getTime() < mid);
  const taken = (list: Dose[]) => list.filter((d) => d.status === "taken").length;
  const evening = window.filter((d) => manilaHour(d.scheduledTime) >= 17);
  const morning = window.filter((d) => manilaHour(d.scheduledTime) < 12);
  const takenList = window.filter((d) => d.status === "taken" && d.takenTime);
  let streak = 0;
  for (const d of [...window].sort((a, b) => b.scheduledTime.getTime() - a.scheduledTime.getTime())) {
    if (d.status === "taken") break;
    streak += 1;
  }
  const adherence7 = pct(taken(recent), recent.length);
  return {
    adherence14: pct(taken(window), window.length),
    adherence7,
    trend: earlier.length ? adherence7 - pct(taken(earlier), earlier.length) : 0,
    missedStreak: streak,
    eveningMissRate: pct(evening.filter((d) => d.status !== "taken").length, evening.length),
    morningMissRate: pct(morning.filter((d) => d.status !== "taken").length, morning.length),
    lateRate: pct(
      takenList.filter((d) => d.takenTime!.getTime() - d.scheduledTime.getTime() > 60 * 60 * 1000).length,
      takenList.length,
    ),
    skipRate: pct(window.filter((d) => d.status === "skipped").length, window.length),
    dailyDoses: Math.round((window.length / WINDOW_DAYS) * 10) / 10,
    activeMeds: new Set(window.map((d) => d.medicationId)).size,
    age: patient.age,
    conditions: patient.conditions.length,
  };
}

/** What actually happened in the 7 days after the reference time: the training label. */
function labelAt(doses: Dose[], at: Date): number | null {
  const end = at.getTime() + HORIZON_DAYS * DAY;
  const next = doses.filter(
    (d) => d.scheduledTime.getTime() >= at.getTime() && d.scheduledTime.getTime() < end && d.status !== "scheduled",
  );
  if (next.length < 3) return null;
  const rate = pct(next.filter((d) => d.status === "taken").length, next.length);
  return rate >= 80 ? 0 : rate >= 50 ? 1 : 2;
}

const vector = (f: Record<FeatureKey, number>) => FEATURES.map((x) => f[x.key]);

async function loadData() {
  const patients = await db
    .select({ id: patientsTable.id, name: patientsTable.name, age: patientsTable.age, conditions: patientsTable.conditions })
    .from(patientsTable)
    .where(eq(patientsTable.active, true));
  const doses = await db
    .select({
      patientId: doseLogsTable.patientId,
      medicationId: doseLogsTable.medicationId,
      scheduledTime: doseLogsTable.scheduledTime,
      takenTime: doseLogsTable.takenTime,
      status: doseLogsTable.status,
    })
    .from(doseLogsTable)
    .innerJoin(medicationsTable, eq(medicationsTable.id, doseLogsTable.medicationId));
  const byPatient = new Map<number, Dose[]>();
  for (const d of doses) byPatient.set(d.patientId, [...(byPatient.get(d.patientId) ?? []), d]);
  return { patients, byPatient };
}

type Stats = { mean: number[]; std: number[]; direction: number[] };

/** Population mean/std, and whether higher values go with higher risk (from the training labels). */
function statsFor(samples: Sample[]): Stats {
  const n = samples.length;
  const k = samples[0].features.length;
  const mean = new Array(k).fill(0);
  const std = new Array(k).fill(0);
  const direction = new Array(k).fill(0);
  const labelMean = samples.reduce((s, x) => s + x.label, 0) / n;
  for (let f = 0; f < k; f += 1) {
    mean[f] = samples.reduce((s, x) => s + x.features[f], 0) / n;
    std[f] = Math.sqrt(samples.reduce((s, x) => s + (x.features[f] - mean[f]) ** 2, 0) / n) || 1;
    const cov = samples.reduce((s, x) => s + (x.features[f] - mean[f]) * (x.label - labelMean), 0);
    direction[f] = cov === 0 ? (FEATURES[f].riskWhenHigh ? 1 : -1) : Math.sign(cov);
  }
  return { mean, std, direction };
}

export type RiskFactor = {
  feature: string;
  label: string;
  value: number;
  typical: number;
  impact: number;
  text: string;
};

function describe(key: FeatureKey, value: number, typical: number): string {
  const t = Math.round(typical);
  switch (key) {
    case "adherence14": return `Took ${value}% of doses in the last 14 days (typical patient: ${t}%).`;
    case "adherence7": return `Took ${value}% of doses in the last 7 days (typical patient: ${t}%).`;
    case "trend": return value < 0 ? `Adherence dropped ${Math.abs(value)} points compared with the week before.` : `Adherence changed by +${value} points this week.`;
    case "missedStreak": return `${value} dose${value === 1 ? "" : "s"} missed in a row most recently.`;
    case "eveningMissRate": return `Misses ${value}% of evening doses (typical: ${t}%).`;
    case "morningMissRate": return `Misses ${value}% of morning doses (typical: ${t}%).`;
    case "lateRate": return `${value}% of doses are taken more than an hour late (typical: ${t}%).`;
    case "skipRate": return `Skips ${value}% of doses (typical: ${t}%).`;
    case "dailyDoses": return `Has ${value} doses a day to manage, more than typical (${typical.toFixed(1)}).`;
    case "activeMeds": return `Takes ${value} different medications, more than typical (${typical.toFixed(1)}).`;
    case "age": return `Age ${value}, older than the typical patient (${t}); may need more support.`;
    case "conditions": return `Manages ${value} health conditions (typical: ${typical.toFixed(1)}).`;
  }
}

/** Care-team actions and patient tasks for the factors driving the risk. */
export function recommendationsFor(level: string, factors: RiskFactor[]) {
  const keys = new Set(factors.map((f) => f.feature));
  const care: string[] = [];
  const tasks: string[] = [];
  if (level === "high") care.push("Contact the patient within 24 hours to understand what is getting in the way.");
  if (keys.has("missedStreak")) care.push("Recent doses were missed in a row. A same-day phone or SMS check-in is recommended.");
  if (keys.has("trend")) care.push("Adherence is declining. Schedule a follow-up check-up this week.");
  if (keys.has("eveningMissRate")) {
    care.push("Evening doses are the main gap. Consider whether the timing can be moved earlier, if clinically appropriate.");
    tasks.push("Keep your evening medicine next to something you use every night, like your toothbrush.");
  }
  if (keys.has("morningMissRate")) tasks.push("Take your morning medicine with breakfast so it becomes part of the routine.");
  if (keys.has("lateRate")) tasks.push("Turn on notification sounds and take your medicine as soon as the reminder appears.");
  if (keys.has("skipRate")) care.push("The patient often skips doses on purpose. Ask about side effects or cost.");
  if (keys.has("dailyDoses") || keys.has("activeMeds")) {
    care.push("The regimen is complex. Review whether doses can be combined or simplified.");
    tasks.push("Use a weekly pill organizer to prepare your doses ahead of time.");
  }
  if (keys.has("age")) care.push("Consider linking a caregiver account for extra support.");
  if (keys.has("adherence14") || keys.has("adherence7")) tasks.push("Mark each dose right after taking it so your record stays accurate.");
  if (level === "low") care.push("Adherence is stable. Continue the current plan and positive reinforcement.");
  if (tasks.length === 0) tasks.push("Keep following your schedule. You are doing well.");
  return { care: [...new Set(care)].slice(0, 4), tasks: [...new Set(tasks)].slice(0, 4) };
}

export const HEALTH_TIPS = [
  "Drink a full glass of water with tablets unless your doctor says otherwise.",
  "Store medicines in a cool, dry place, away from direct sunlight and the bathroom.",
  "Never double a dose to make up for a missed one unless your doctor tells you to.",
  "Bring your medicine list to every check-up, including vitamins and herbal products.",
  "Tell your doctor about side effects instead of stopping a medicine on your own.",
  "Refill your prescription a few days before it runs out.",
  "A short walk and regular sleep can make it easier to keep a daily routine.",
];

export type TrainResult = {
  run: typeof modelRunsTable.$inferSelect | null;
  predictions: number;
  reason?: string;
};

/** Train a new forest on all patient history, then predict for every active patient. */
export async function trainAndPredict(trainedBy: number | null = null): Promise<TrainResult> {
  const { patients, byPatient } = await loadData();
  const now = Date.now();
  const samples: Sample[] = [];
  for (const patient of patients) {
    const doses = byPatient.get(patient.id) ?? [];
    if (doses.length === 0) continue;
    const first = Math.min(...doses.map((d) => d.scheduledTime.getTime()));
    // One training example per day: 14 days of history -> what happened in the following 7 days.
    for (let at = first + WINDOW_DAYS * DAY; at <= now - HORIZON_DAYS * DAY; at += DAY) {
      const f = featuresAt(patient, doses, new Date(at));
      const label = labelAt(doses, new Date(at));
      if (f && label !== null) samples.push({ features: vector(f), label });
    }
  }
  const classDistribution = { low: 0, moderate: 0, high: 0 };
  samples.forEach((s) => (classDistribution[RISK_LEVELS[s.label]] += 1));
  if (samples.length < 30 || new Set(samples.map((s) => s.label)).size < 2) {
    return { run: null, predictions: 0, reason: "Not enough dose history yet to train the model (needs at least 3 weeks)." };
  }

  const forest = new RandomForest({ classes: 3, trees: 60, maxDepth: 6, minSamplesLeaf: 3, seed: 42 }).fit(samples);
  const [run] = await db
    .insert(modelRunsTable)
    .values({
      algorithm: "Random Forest (CART, Gini impurity, bootstrap aggregation)",
      trees: forest.options.trees,
      maxDepth: forest.options.maxDepth,
      samples: samples.length,
      classDistribution,
      oobAccuracy: forest.oobAccuracy,
      featureImportance: FEATURES.map((f, i) => ({
        feature: f.key,
        label: f.label,
        importance: Math.round(forest.featureImportance[i] * 1000) / 1000,
      })).sort((a, b) => b.importance - a.importance),
      trainedBy,
    })
    .returning();

  const stats = statsFor(samples);
  let predictions = 0;
  for (const patient of patients) {
    const f = featuresAt(patient, byPatient.get(patient.id) ?? [], new Date(now));
    if (!f) continue;
    const x = vector(f);
    const [low, moderate, high] = forest.predictProba(x);
    const level = high >= moderate && high >= low ? "high" : moderate >= low ? "moderate" : "low";
    // Explanation: features that push this patient toward risk, weighted by how much the forest relies on them.
    const factors: RiskFactor[] = FEATURES.map((meta, i) => {
      const z = (x[i] - stats.mean[i]) / stats.std[i];
      return {
        feature: meta.key,
        label: meta.label,
        value: x[i],
        typical: Math.round(stats.mean[i] * 10) / 10,
        // Explanations follow the clinically expected direction (e.g. lower adherence = more risk).
        impact: Math.round(forest.featureImportance[i] * z * (meta.riskWhenHigh ? 1 : -1) * 1000) / 1000,
        text: describe(meta.key, x[i], stats.mean[i]),
      };
    })
      .filter((factor) => factor.impact > 0.005)
      .sort((a, b) => b.impact - a.impact)
      .slice(0, 4);

    const [previous] = await db
      .select({ riskLevel: riskPredictionsTable.riskLevel })
      .from(riskPredictionsTable)
      .where(eq(riskPredictionsTable.patientId, patient.id))
      .orderBy(desc(riskPredictionsTable.createdAt))
      .limit(1);
    await db.insert(riskPredictionsTable).values({
      patientId: patient.id,
      modelRunId: run.id,
      riskLevel: level,
      riskScore: Math.round((high + moderate * 0.5) * 100),
      probLow: low,
      probModerate: moderate,
      probHigh: high,
      features: f,
      factors,
    });
    predictions += 1;

    // Predictive alert: only when a patient newly becomes high risk.
    if (level === "high" && previous?.riskLevel !== "high") {
      const providers = await careTeamProviderIds(patient.id);
      const reason = factors[0]?.text ?? "";
      if (providers.length) {
        await db.insert(notificationsTable).values(
          providers.map((userId) => ({
            userId,
            patientId: patient.id,
            kind: "ai-risk",
            title: `AI risk alert: ${patient.name}`,
            message: `The Random Forest model predicts a ${Math.round(high * 100)}% chance of poor adherence in the next 7 days. ${reason}`,
          })),
        );
      }
    }
  }
  logger.info({ samples: samples.length, oobAccuracy: forest.oobAccuracy, predictions }, "Risk model trained");
  return { run, predictions };
}

/** Latest prediction per patient, for the given patients. */
export async function latestPredictions(patientIds: number[]) {
  if (patientIds.length === 0) return [];
  const rows = await db
    .selectDistinctOn([riskPredictionsTable.patientId], {
      prediction: riskPredictionsTable,
      name: patientsTable.name,
    })
    .from(riskPredictionsTable)
    .innerJoin(patientsTable, eq(patientsTable.id, riskPredictionsTable.patientId))
    .where(inArray(riskPredictionsTable.patientId, patientIds))
    .orderBy(riskPredictionsTable.patientId, desc(riskPredictionsTable.createdAt));
  return rows;
}

export async function latestModelRun() {
  const [run] = await db.select().from(modelRunsTable).orderBy(desc(modelRunsTable.createdAt)).limit(1);
  return run ?? null;
}

export async function predictionHistory(patientId: number) {
  return db
    .select({
      riskScore: riskPredictionsTable.riskScore,
      riskLevel: riskPredictionsTable.riskLevel,
      createdAt: riskPredictionsTable.createdAt,
    })
    .from(riskPredictionsTable)
    .where(and(eq(riskPredictionsTable.patientId, patientId)))
    .orderBy(desc(riskPredictionsTable.createdAt))
    .limit(14);
}
