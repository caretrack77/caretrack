import { sql } from "drizzle-orm";

import {
  boolean,
  date,
  datetime,
  index,
  int,
  json,
  float,
  mysqlTable,
  text,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

export const usersTable = mysqlTable(
  "caretrack_users",
  {
    id: int("id").autoincrement().primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull(),
    // Mobile number used for SMS login codes.
    phone: text("phone"),
    // Set when an admin creates the account or resets its password.
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("caretrack_users_email_idx").on(table.email)],
);

export const patientsTable = mysqlTable(
  "caretrack_patients",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    age: int("age").notNull(),
    sex: text("sex").notNull().default("not_specified"),
    phone: text("phone"),
    email: text("email"),
    conditions: json("conditions").$type<string[]>().notNull().default([]),
    allergies: json("allergies").$type<string[]>().notNull().default([]),
    notes: text("notes"),
    active: boolean("active").notNull().default(true),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("caretrack_patients_email_unique_idx").on(table.email),
    index("caretrack_patients_user_id_idx").on(table.userId),
    index("caretrack_patients_active_idx").on(table.active),
  ],
);

export const patientProviderAssignmentsTable = mysqlTable(
  "caretrack_patient_provider_assignments",
  {
    id: int("id").autoincrement().primaryKey(),
    patientId: int("patient_id")
      .notNull()
      .references(() => patientsTable.id, { onDelete: "cascade" }),
    providerId: int("provider_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("caretrack_patient_provider_unique_idx").on(
      table.patientId,
      table.providerId,
    ),
    index("caretrack_assignments_provider_idx").on(table.providerId),
  ],
);

export const patientCaregiverAssignmentsTable = mysqlTable(
  "caretrack_patient_caregiver_assignments",
  {
    id: int("id").autoincrement().primaryKey(),
    patientId: int("patient_id")
      .notNull()
      .references(() => patientsTable.id, { onDelete: "cascade" }),
    caregiverId: int("caregiver_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("caretrack_patient_caregiver_unique_idx").on(
      table.patientId,
      table.caregiverId,
    ),
    index("caretrack_caregiver_id_idx").on(table.caregiverId),
  ],
);

export const medicationsTable = mysqlTable(
  "caretrack_medications",
  {
    id: int("id").autoincrement().primaryKey(),
    patientId: int("patient_id")
      .notNull()
      .references(() => patientsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    dosage: text("dosage").notNull(),
    form: text("form").notNull().default("tablet"),
    frequency: text("frequency").notNull().default("daily"),
    timesPerDay: int("times_per_day").notNull().default(1),
    scheduleTimes: json("schedule_times").$type<string[]>().notNull().default([]),
    daysOfWeek: json("days_of_week").$type<number[]>().notNull().default([]),
    intervalHours: int("interval_hours"),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }),
    instructions: text("instructions"),
    prescribedBy: int("prescribed_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    active: boolean("active").notNull().default(true),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("caretrack_medications_patient_idx").on(table.patientId),
    index("caretrack_medications_active_idx").on(table.active),
  ],
);

export const doseLogsTable = mysqlTable(
  "caretrack_dose_logs",
  {
    id: int("id").autoincrement().primaryKey(),
    patientId: int("patient_id")
      .notNull()
      .references(() => patientsTable.id, { onDelete: "cascade" }),
    medicationId: int("medication_id")
      .notNull()
      .references(() => medicationsTable.id, { onDelete: "cascade" }),
    scheduledTime: datetime("scheduled_time").notNull(),
    takenTime: datetime("taken_time"),
    status: text("status").notNull().default("scheduled"),
    notes: text("notes"),
    // Who recorded the status, e.g. "Alex Morgan (patient)" or "System: not logged within 2 hours".
    loggedBy: text("logged_by"),
    // Set once the "dose due" in-app reminder has been sent.
    reminderSentAt: datetime("reminder_sent_at"),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("caretrack_dose_status_schedule_idx").on(
      table.status,
      table.scheduledTime,
    ),
    uniqueIndex("caretrack_dose_medication_schedule_idx").on(
      table.medicationId,
      table.scheduledTime,
    ),
    index("caretrack_dose_patient_schedule_idx").on(
      table.patientId,
      table.scheduledTime,
    ),
  ],
);

export const sessionsTable = mysqlTable(
  "caretrack_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: int("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    expiresAt: datetime("expires_at").notNull(),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("caretrack_sessions_expiry_idx").on(table.expiresAt)],
);

export const auditLogsTable = mysqlTable(
  "caretrack_audit_logs",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: int("entity_id"),
    details: json("details").notNull().default({}),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("caretrack_audit_user_time_idx").on(table.userId, table.createdAt),
    index("caretrack_audit_entity_idx").on(
      table.entityType,
      table.entityId,
    ),
  ],
);

export const notificationsTable = mysqlTable(
  "caretrack_notifications",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    patientId: int("patient_id").references(() => patientsTable.id, {
      onDelete: "cascade",
    }),
    kind: text("kind").notNull().default("info"),
    title: text("title").notNull(),
    message: text("message").notNull(),
    read: boolean("read").notNull().default(false),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("caretrack_notifications_user_time_idx").on(
      table.userId,
      table.createdAt,
    ),
    index("caretrack_notifications_unread_idx").on(table.userId, table.read),
  ],
);

export const aiInsightsTable = mysqlTable(
  "caretrack_ai_insights",
  {
    id: int("id").autoincrement().primaryKey(),
    patientId: int("patient_id")
      .notNull()
      .references(() => patientsTable.id, { onDelete: "cascade" }),
    generatedBy: int("generated_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    summary: text("summary").notNull(),
    riskLevel: text("risk_level").notNull(),
    recommendations: json("recommendations").$type<string[]>().notNull().default([]),
    source: text("source").notNull().default("rules"),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("caretrack_insights_patient_time_idx").on(
      table.patientId,
      table.createdAt,
    ),
  ],
);

export const reportsTable = mysqlTable(
  "caretrack_reports",
  {
    id: int("id").autoincrement().primaryKey(),
    patientId: int("patient_id").references(() => patientsTable.id, {
      onDelete: "set null",
    }),
    generatedBy: int("generated_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    period: text("period").notNull(),
    rangeStart: date("range_start", { mode: "string" }).notNull(),
    rangeEnd: date("range_end", { mode: "string" }).notNull(),
    adherenceRate: int("adherence_rate").notNull().default(0),
    summary: text("summary").notNull(),
    reportData: json("report_data").notNull().default({}),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("caretrack_reports_patient_time_idx").on(
      table.patientId,
      table.createdAt,
    ),
    index("caretrack_reports_creator_idx").on(table.generatedBy, table.createdAt),
  ],
);

export const reportSchedulesTable = mysqlTable(
  "caretrack_report_schedules",
  {
    id: int("id").autoincrement().primaryKey(),
    createdBy: int("created_by")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    patientId: int("patient_id").references(() => patientsTable.id, {
      onDelete: "cascade",
    }),
    cadence: text("cadence").notNull(),
    nextRunAt: datetime("next_run_at").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("caretrack_report_schedules_due_idx").on(
      table.active,
      table.nextRunAt,
    ),
    index("caretrack_report_schedules_creator_idx").on(table.createdBy),
  ],
);

/** Pending two-step logins: password verified, waiting for the one-time code. */
export const otpChallengesTable = mysqlTable(
  "caretrack_otp_challenges",
  {
    id: int("id").autoincrement().primaryKey(),
    tokenHash: text("token_hash").notNull(),
    userId: int("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    codeHash: text("code_hash"),
    channel: text("channel"),
    codeExpiresAt: datetime("code_expires_at"),
    lastSentAt: datetime("last_sent_at"),
    attempts: int("attempts").notNull().default(0),
    expiresAt: datetime("expires_at").notNull(),
    consumedAt: datetime("consumed_at"),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("caretrack_otp_token_idx").on(table.tokenHash),
    index("caretrack_otp_user_idx").on(table.userId),
  ],
);

/** Patient and care-team messages. Each patient has one shared conversation. */
export const messagesTable = mysqlTable(
  "caretrack_messages",
  {
    id: int("id").autoincrement().primaryKey(),
    patientId: int("patient_id")
      .notNull()
      .references(() => patientsTable.id, { onDelete: "cascade" }),
    senderId: int("sender_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    body: text("body").notNull(),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("caretrack_messages_patient_time_idx").on(
      table.patientId,
      table.createdAt,
    ),
  ],
);

/** When each user last read each patient's conversation, for unread counts. */
export const messageReadsTable = mysqlTable(
  "caretrack_message_reads",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    patientId: int("patient_id")
      .notNull()
      .references(() => patientsTable.id, { onDelete: "cascade" }),
    lastReadAt: datetime("last_read_at").notNull(),
  },
  (table) => [
    uniqueIndex("caretrack_message_reads_unique_idx").on(
      table.userId,
      table.patientId,
    ),
  ],
);

/**
 * Temporary coverage: while a provider is absent, the covering provider can see and
 * manage the absent provider's patients and receives their alerts and messages.
 */
export const providerCoverageTable = mysqlTable(
  "caretrack_provider_coverage",
  {
    id: int("id").autoincrement().primaryKey(),
    absentProviderId: int("absent_provider_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    coveringProviderId: int("covering_provider_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }),
    reason: text("reason"),
    createdBy: int("created_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    endedAt: datetime("ended_at"),
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("caretrack_coverage_absent_idx").on(table.absentProviderId),
    index("caretrack_coverage_covering_idx").on(table.coveringProviderId),
  ],
);

/** One training run of the Random Forest risk model, with its evaluation metrics. */
export const modelRunsTable = mysqlTable("caretrack_model_runs", {
  id: int("id").autoincrement().primaryKey(),
  algorithm: text("algorithm").notNull(),
  trees: int("trees").notNull(),
  maxDepth: int("max_depth").notNull(),
  samples: int("samples").notNull(),
  classDistribution: json("class_distribution").notNull().default({}),
  oobAccuracy: float("oob_accuracy"),
  featureImportance: json("feature_importance").notNull().default([]),
  trainedBy: int("trained_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

/** Predicted risk of non-adherence over the next 7 days, with the factors behind it. */
export const riskPredictionsTable = mysqlTable(
  "caretrack_risk_predictions",
  {
    id: int("id").autoincrement().primaryKey(),
    patientId: int("patient_id")
      .notNull()
      .references(() => patientsTable.id, { onDelete: "cascade" }),
    modelRunId: int("model_run_id").references(() => modelRunsTable.id, {
      onDelete: "set null",
    }),
    riskLevel: text("risk_level").notNull(),
    riskScore: int("risk_score").notNull(),
    probLow: float("prob_low").notNull(),
    probModerate: float("prob_moderate").notNull(),
    probHigh: float("prob_high").notNull(),
    features: json("features").notNull().default({}),
    factors: json("factors").notNull().default([]),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("caretrack_risk_patient_time_idx").on(table.patientId, table.createdAt),
  ],
);

/** Laboratory result files. File contents are stored AES-256-GCM encrypted. */
export const labResultsTable = mysqlTable(
  "caretrack_lab_results",
  {
    id: int("id").autoincrement().primaryKey(),
    patientId: int("patient_id")
      .notNull()
      .references(() => patientsTable.id, { onDelete: "cascade" }),
    uploadedBy: int("uploaded_by").references(() => usersTable.id, { onDelete: "set null" }),
    // "lab" for laboratory results, "prescription" for prescriptions uploaded by a doctor.
    category: text("category").notNull().default("lab"),
    title: text("title").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: int("size_bytes").notNull(),
    encryptedData: text("encrypted_data").notNull(),
    notes: text("notes"),
    reviewComment: text("review_comment"),
    reviewedBy: int("reviewed_by").references(() => usersTable.id, { onDelete: "set null" }),
    reviewedAt: datetime("reviewed_at"),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("caretrack_lab_results_patient_idx").on(table.patientId, table.createdAt)],
);

/** Follow-up check-ups between a patient and their doctor. */
export const appointmentsTable = mysqlTable(
  "caretrack_appointments",
  {
    id: int("id").autoincrement().primaryKey(),
    patientId: int("patient_id")
      .notNull()
      .references(() => patientsTable.id, { onDelete: "cascade" }),
    providerId: int("provider_id").references(() => usersTable.id, { onDelete: "set null" }),
    scheduledAt: datetime("scheduled_at").notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("scheduled"),
    notes: text("notes"),
    reminderSentAt: datetime("reminder_sent_at"),
    createdBy: int("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("caretrack_appointments_patient_idx").on(table.patientId, table.scheduledAt),
    index("caretrack_appointments_provider_idx").on(table.providerId, table.scheduledAt),
  ],
);
