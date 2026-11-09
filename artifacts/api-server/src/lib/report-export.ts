import PDFDocument from "pdfkit";
import { and, asc, desc, eq, gte, lt } from "drizzle-orm";
import {
  db,
  healthMetricsTable,
  medicationsTable,
  patientsTable,
  reportsTable,
  riskPredictionsTable,
} from "@workspace/db";
import type { CurrentUser } from "./auth";
import { reportDoseRows } from "./report-service";
import { recommendationsFor, type RiskFactor } from "./ml/risk-model";
import { csvCell } from "./csv-protection";

type ReportRecord = typeof reportsTable.$inferSelect;

type StoredAnalytics = {
  totalPatients: number;
  totalDoses: number;
  takenCount: number;
  missedCount: number;
  skippedCount: number;
  adherenceRate: number;
  trend: Array<{ date: string; adherenceRate: number }>;
  byMedication: Array<{
    medicationName: string;
    adherenceRate: number;
    scheduledCount: number;
    missedCount: number;
  }>;
  byTimeOfDay: Array<{ period: string; missedCount: number; scheduledCount: number }>;
  riskPatients: Array<{
    patientName: string;
    adherenceRate: number;
    riskLevel: string;
    missedCount: number;
  }>;
};

type StoredReportData = {
  analytics?: StoredAnalytics;
  recommendations?: string[];
  source?: string;
};

const COLORS = {
  ink: "#1c424f",
  muted: "#6b8389",
  teal: "#2b8f86",
  tealSoft: "#e4f4f0",
  line: "#dce8e8",
  green: "#34785d",
  yellow: "#b2852f",
  red: "#b2513f",
};

function riskLabel(rate: number): { label: string; color: string } {
  if (rate >= 80) return { label: "Green - on track (>= 80%)", color: COLORS.green };
  if (rate >= 50) return { label: "Yellow - monitor (50-79%)", color: COLORS.yellow };
  return { label: "Red - needs support (< 50%)", color: COLORS.red };
}

function shortDate(value: string | Date): string {
  const text = typeof value === "string" ? value : value.toISOString();
  return text.slice(0, 10);
}

export 

type ReportHealthMetric = typeof healthMetricsTable.$inferSelect;
type ReportRiskPrediction = typeof riskPredictionsTable.$inferSelect;

async function reportHealthAndAi(
  report: ReportRecord,
  patientId: number | null,
) {
  if (patientId === null) {
    return { metrics: [] as ReportHealthMetric[], prediction: null as ReportRiskPrediction | null };
  }
  const startAt = new Date(`${report.rangeStart}T00:00:00+08:00`);
  const endAt = new Date(`${report.rangeEnd}T00:00:00+08:00`);
  endAt.setDate(endAt.getDate() + 1);
  const [metrics, predictionRows] = await Promise.all([
    db.select().from(healthMetricsTable).where(and(
      eq(healthMetricsTable.patientId, patientId),
      eq(healthMetricsTable.active, true),
      gte(healthMetricsTable.recordedAt, startAt),
      lt(healthMetricsTable.recordedAt, endAt),
    )).orderBy(asc(healthMetricsTable.recordedAt)),
    db.select().from(riskPredictionsTable).where(
      eq(riskPredictionsTable.patientId, patientId),
    ).orderBy(desc(riskPredictionsTable.createdAt)).limit(1),
  ]);
  return { metrics, prediction: predictionRows[0] ?? null };
}

const metricLabel = (type: string) =>
  ({ blood_pressure: "Blood pressure", blood_sugar: "Blood sugar", heart_rate: "Heart rate", weight: "Weight", temperature: "Temperature" }[type] ?? type.replace(/_/g, " "));

function metricValue(metric: ReportHealthMetric) {
  return metric.secondaryValue === null
    ? `${metric.value} ${metric.unit}`
    : `${metric.value}/${metric.secondaryValue} ${metric.unit}`;
}

function healthSummaries(metrics: ReportHealthMetric[]) {
  const groups = new Map<string, ReportHealthMetric[]>();
  for (const metric of metrics) groups.set(metric.metricType, [...(groups.get(metric.metricType) ?? []), metric]);
  return [...groups.entries()].map(([type, readings]) => {
    const latest = readings[readings.length - 1];
    const average = readings.reduce((total, item) => total + item.value, 0) / readings.length;
    return {
      type,
      latest: metricValue(latest),
      average: `${average.toFixed(1)}${latest.unit ? ` ${latest.unit}` : ""}`,
      outOfRangeCount: readings.filter((item) => item.outOfRange).length,
    };
  });
}

export async function buildReportCsv(
  report: ReportRecord,
  user: CurrentUser,
): Promise<string> {
  const rows = await reportDoseRows(report, user);
  const header = [
    "patient",
    "medication",
    "dosage",
    "scheduled_time",
    "taken_time",
    "status",
    "notes",
  ];
  const lines = rows.map((row) =>
    [
      row.patientName,
      row.medicationName,
      row.dosage,
      row.dose.scheduledTime.toISOString(),
      row.dose.takenTime?.toISOString() ?? "",
      row.dose.status,
      row.dose.notes ?? "",
    ]
      .map(csvCell)
      .join(","),
  );
  const { metrics, prediction } = await reportHealthAndAi(report, report.patientId);
  const summaries = healthSummaries(metrics);
  const factors = prediction?.factors as RiskFactor[] | undefined;
  const confidence = prediction
    ? Math.max(prediction.probLow, prediction.probModerate, prediction.probHigh)
    : null;
  const { care } = recommendationsFor(prediction?.riskLevel ?? "low", factors ?? []);
  const disclaimer = "AI suggestions support, not replace, clinical judgment. Predictions are decision support and not a diagnosis.";
  const sections = [
    [header.map(csvCell).join(","), ...lines].join("\n"),
    ["", "HEALTH METRIC SUMMARY", "metric", "latest", "average", "out_of_range_count"].map(csvCell).join(","),
    ...summaries.map((item) => [
      "", "", metricLabel(item.type), item.latest, item.average, item.outOfRangeCount,
    ].map(csvCell).join(",")),
    ["", "OUT OF RANGE READINGS", "metric", "value", "recorded_at", "note"].map(csvCell).join(","),
    ...metrics.filter((item) => item.outOfRange).map((item) => [
      "", "", metricLabel(item.metricType), metricValue(item), item.recordedAt.toISOString(), item.note ?? "",
    ].map(csvCell).join(",")),
    ["", "AI RISK", "risk_level", "confidence", "top_factors", "recommendations", "ai_disclaimer"].map(csvCell).join(","),
    ["", "", prediction?.riskLevel ?? "", confidence === null ? "" : `${(confidence * 100).toFixed(1)}%`,
      (factors ?? []).slice(0, 5).map((factor) => factor.text).join("; "),
      care.join("; "), disclaimer].map(csvCell).join(","),
  ];
  return sections.join("\n") + "\n";
}

export async function buildReportPdf(
  report: ReportRecord,
  user: CurrentUser,
): Promise<Buffer> {
  const data = (report.reportData ?? {}) as StoredReportData;
  const analytics = data.analytics;
  const [patient] =
    report.patientId === null
      ? []
      : await db
          .select()
          .from(patientsTable)
          .where(eq(patientsTable.id, report.patientId))
          .limit(1);
  const medications = patient
    ? await db
        .select()
        .from(medicationsTable)
        .where(eq(medicationsTable.patientId, patient.id))
        .orderBy(asc(medicationsTable.name))
    : [];
  const doseRows = await reportDoseRows(report, user);
  const missedRows = doseRows
    .filter((row) => row.dose.status === "missed")
    .slice(-10)
    .reverse();
  const { metrics, prediction } = await reportHealthAndAi(report, report.patientId);
  const factors = prediction?.factors as RiskFactor[] | undefined;
  const confidence = prediction
    ? Math.max(prediction.probLow, prediction.probModerate, prediction.probHigh)
    : null;
  const riskRecommendations = recommendationsFor(prediction?.riskLevel ?? "low", factors ?? []).care;

  const doc = new PDFDocument({ size: "A4", margin: 48 });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  const ensureSpace = (height: number) => {
    if (doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage();
  };
  const heading = (text: string) => {
    ensureSpace(60);
    doc.moveDown(0.8);
    doc.font("Helvetica-Bold").fontSize(12).fillColor(COLORS.teal).text(text.toUpperCase(), left, doc.y, { characterSpacing: 0.6 });
    const y = doc.y + 3;
    doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.6).strokeColor(COLORS.line).stroke();
    doc.moveDown(0.6);
    doc.font("Helvetica").fontSize(10).fillColor(COLORS.ink);
  };
  const keyValue = (key: string, value: string) => {
    doc.font("Helvetica-Bold").fontSize(10).fillColor(COLORS.muted).text(`${key}: `, { continued: true });
    doc.font("Helvetica").fillColor(COLORS.ink).text(value);
  };

  // Header band
  doc.rect(0, 0, doc.page.width, 96).fill("#174353");
  doc.font("Helvetica-Bold").fontSize(20).fillColor("#ffffff").text("CareTrack Adherence Report", left, 30);
  doc.font("Helvetica").fontSize(10).fillColor("#bfe7df").text(
    `${report.period === "monthly" ? "Monthly" : "Weekly"} report  |  ${report.rangeStart} to ${report.rangeEnd}  |  Generated ${shortDate(report.createdAt)}`,
    left,
    60,
  );
  doc.y = 120;

  heading(patient ? "Patient information" : "Report scope");
  if (patient) {
    keyValue("Name", patient.name);
    keyValue("Age / Sex", `${patient.age} / ${patient.sex.replace("_", " ")}`);
    keyValue("Conditions", patient.conditions.length ? patient.conditions.join(", ") : "None recorded");
    keyValue("Allergies", patient.allergies.length ? patient.allergies.join(", ") : "None recorded");
  } else {
    keyValue("Scope", "Full caseload of patients visible to the report author");
    keyValue("Patients included", String(analytics?.totalPatients ?? 0));
  }

  heading("Adherence summary");
  const rate = analytics?.adherenceRate ?? report.adherenceRate;
  const risk = riskLabel(rate);
  const boxY = doc.y;
  const boxW = (width - 24) / 4;
  const stats: Array<[string, string]> = [
    ["Adherence", `${rate}%`],
    ["Taken", String(analytics?.takenCount ?? 0)],
    ["Missed", String(analytics?.missedCount ?? 0)],
    ["Skipped", String(analytics?.skippedCount ?? 0)],
  ];
  stats.forEach(([label, value], index) => {
    const x = left + index * (boxW + 8);
    doc.roundedRect(x, boxY, boxW, 54, 6).fill(COLORS.tealSoft);
    doc.font("Helvetica").fontSize(9).fillColor(COLORS.muted).text(label, x + 10, boxY + 9, { width: boxW - 20 });
    doc.font("Helvetica-Bold").fontSize(18).fillColor(COLORS.ink).text(value, x + 10, boxY + 24, { width: boxW - 20 });
  });
  doc.y = boxY + 66;
  doc.font("Helvetica-Bold").fontSize(10).fillColor(risk.color).text(`Risk flag: ${risk.label}`, left);
  doc.font("Helvetica").fontSize(9).fillColor(COLORS.muted).text(
    `Adherence rate = taken doses / scheduled doses x 100, across ${analytics?.totalDoses ?? 0} scheduled doses.`,
  );

  // Daily trend chart
  const trend = analytics?.trend ?? [];
  if (trend.length > 0) {
    heading("Daily adherence trend");
    ensureSpace(150);
    const chartTop = doc.y;
    const chartHeight = 110;
    const barGap = 3;
    const barWidth = Math.max(4, (width - 30) / trend.length - barGap);
    doc.font("Helvetica").fontSize(7).fillColor(COLORS.muted);
    [100, 50, 0].forEach((tick) => {
      const y = chartTop + chartHeight - (tick / 100) * chartHeight;
      doc.text(`${tick}%`, left, y - 3, { width: 24, align: "right" });
      doc.moveTo(left + 28, y).lineTo(left + width, y).lineWidth(0.4).strokeColor(COLORS.line).stroke();
    });
    trend.forEach((point, index) => {
      const value = Math.max(0, Math.min(100, point.adherenceRate));
      const barHeight = Math.max(1.5, (value / 100) * chartHeight);
      const x = left + 30 + index * (barWidth + barGap);
      const color = value >= 80 ? "#5bb69f" : value >= 50 ? "#d6ad5b" : "#cf7865";
      doc.rect(x, chartTop + chartHeight - barHeight, barWidth, barHeight).fill(color);
    });
    doc.fillColor(COLORS.muted).fontSize(7)
      .text(shortDate(trend[0].date), left + 30, chartTop + chartHeight + 4)
      .text(shortDate(trend[trend.length - 1].date), left, chartTop + chartHeight + 4, { width, align: "right" });
    doc.y = chartTop + chartHeight + 18;
  }

  if (patient) {
    heading("Medication list");
    if (medications.length === 0) {
      doc.text("No medications recorded.");
    }
    for (const medication of medications) {
      ensureSpace(30);
      doc.font("Helvetica-Bold").fontSize(10).fillColor(COLORS.ink).text(
        `${medication.name} ${medication.dosage} (${medication.form})${medication.active ? "" : "  - inactive"}`,
      );
      doc.font("Helvetica").fontSize(9).fillColor(COLORS.muted).text(
        `${medication.frequency.replace("_", " ")} at ${medication.scheduleTimes.join(", ") || "08:00"}  |  from ${medication.startDate}${medication.endDate ? ` to ${medication.endDate}` : ""}${medication.instructions ? `  |  ${medication.instructions}` : ""}`,
      );
      doc.moveDown(0.3);
    }
  }

  if ((analytics?.byMedication ?? []).length > 0) {
    heading("Adherence by medication");
    for (const item of analytics!.byMedication) {
      ensureSpace(20);
      const y = doc.y;
      doc.font("Helvetica").fontSize(10).fillColor(COLORS.ink).text(item.medicationName, left, y, { width: width * 0.45 });
      doc.fillColor(COLORS.muted).text(`${item.scheduledCount} scheduled, ${item.missedCount} missed`, left + width * 0.45, y, { width: width * 0.35 });
      doc.font("Helvetica-Bold").fillColor(riskLabel(item.adherenceRate).color).text(`${item.adherenceRate}%`, left + width * 0.8, y, { width: width * 0.2, align: "right" });
      doc.moveDown(0.2);
    }
  }

  heading("Missed-dose summary");
  for (const slot of analytics?.byTimeOfDay ?? []) {
    doc.font("Helvetica").fontSize(10).fillColor(COLORS.ink).text(
      `${slot.period}: ${slot.missedCount} missed of ${slot.scheduledCount} scheduled`,
    );
  }
  if (missedRows.length > 0) {
    doc.moveDown(0.4);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.muted).text("Most recent missed doses");
    for (const row of missedRows) {
      ensureSpace(14);
      doc.font("Helvetica").fontSize(9).fillColor(COLORS.ink).text(
        `${row.dose.scheduledTime.toISOString().slice(0, 16).replace("T", " ")} UTC  |  ${patient ? "" : `${row.patientName}  |  `}${row.medicationName} ${row.dosage}`,
      );
    }
  }

  if (!patient && (analytics?.riskPatients ?? []).length > 0) {
    heading("Patients by adherence");
    for (const item of analytics!.riskPatients) {
      ensureSpace(14);
      doc.font("Helvetica").fontSize(10).fillColor(riskLabel(item.adherenceRate).color).text(
        `${item.patientName}: ${item.adherenceRate}% (${item.missedCount} missed)`,
      );
    }
  }

  heading("Health metric summary");
  const summaries = healthSummaries(metrics);
  if (summaries.length === 0) {
    doc.text("No health readings recorded during this reporting period.");
  } else {
    for (const item of summaries) {
      ensureSpace(20);
      doc.font("Helvetica-Bold").fontSize(10).fillColor(COLORS.ink).text(metricLabel(item.type));
      doc.font("Helvetica").fontSize(9).fillColor(COLORS.muted).text(
        `Latest: ${item.latest}  |  Average: ${item.average}  |  Out of range: ${item.outOfRangeCount}`,
      );
    }
  }

  heading("Out-of-range readings");
  const outOfRangeMetrics = metrics.filter((item) => item.outOfRange);
  if (outOfRangeMetrics.length === 0) {
    doc.text("No out-of-range readings recorded during this reporting period.");
  } else {
    for (const item of outOfRangeMetrics) {
      ensureSpace(18);
      doc.font("Helvetica").fontSize(9).fillColor(COLORS.ink).text(
        `${shortDate(item.recordedAt)}  |  ${metricLabel(item.metricType)}: ${metricValue(item)}${item.note ? `  |  ${item.note}` : ""}`,
      );
    }
  }

  heading("AI risk assessment");
  if (prediction) {
    keyValue("Risk level", prediction.riskLevel);
    keyValue("Confidence", `${(confidence! * 100).toFixed(1)}%`);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.muted).text("Top risk factors");
    const topFactors = (factors ?? []).slice(0, 5);
    if (topFactors.length === 0) doc.font("Helvetica").fontSize(9).fillColor(COLORS.ink).text("No contributing factors recorded.");
    for (const factor of topFactors) {
      ensureSpace(18);
      doc.font("Helvetica").fontSize(9).fillColor(COLORS.ink).text(`-  ${factor.text}`);
    }
    if (riskRecommendations.length > 0) {
      doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.muted).text("Recommendations");
      for (const recommendation of riskRecommendations) {
        ensureSpace(18);
        doc.font("Helvetica").fontSize(9).fillColor(COLORS.ink).text(`-  ${recommendation}`);
      }
    }
  } else {
    doc.text("No AI risk prediction is available for this patient.");
  }

  heading(data.source === "claude" ? "AI narrative summary" : "Narrative summary");
  doc.font("Helvetica").fontSize(10).fillColor(COLORS.ink).text(report.summary, { lineGap: 2 });
  if ((data.recommendations ?? []).length > 0) {
    heading("Recommendations");
    for (const recommendation of data.recommendations!) {
      ensureSpace(20);
      doc.font("Helvetica").fontSize(10).fillColor(COLORS.ink).text(`-  ${recommendation}`, { lineGap: 2 });
    }
  }

  doc.moveDown(1.2);
  ensureSpace(40);
  doc.font("Helvetica-Oblique").fontSize(8.5).fillColor(COLORS.muted).text(
    `Generated by CareTrack${data.source === "claude" ? " with Claude AI assistance" : " using rule-based analysis"}. AI disclaimer: AI suggestions support, not replace, clinical judgment. Predictions are decision support and not a diagnosis.`,
    left,
    doc.y,
    { width },
  );

  doc.end();
  return finished;
}
