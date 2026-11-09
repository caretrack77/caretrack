import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  real,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const usersTable = pgTable(
  "caretrack_users",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull(),
    // Mobile number used for SMS login codes.
    phone: text("phone"),
    // Set when an admin creates the account or resets its password.
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("caretrack_users_email_idx").on(table.email)],
);

export const privacyConsentsTable = pgTable(
  "caretrack_privacy_consents",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("caretrack_privacy_consents_user_idx").on(table.userId)],
);

export const patientsTable = pgTable(
  "caretrack_patients",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    age: integer("age").notNull(),
    sex: text("sex").notNull().default("not_specified"),
    phone: text("phone"),
    email: text("email"),
    conditions: text("conditions").array().notNull().default([]),
    allergies: text("allergies").array().notNull().default([]),
    notes: text("notes"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("caretrack_patients_email_unique_idx").on(table.email),
    index("caretrack_patients_user_id_idx").on(table.userId),
    index("caretrack_patients_active_idx").on(table.active),
  ],
);

export const reminderEscalationSettingsTable = pgTable(
  "caretrack_reminder_escalation_settings",
  {
    id: serial("id").primaryKey(),
    patientId: integer("patient_id").notNull().unique().references(() => patientsTable.id, { onDelete: "cascade" }),
    missedBeforeEscalation: integer("missed_before_escalation").notNull().default(2),
    repeatIntervalMinutes: integer("repeat_interval_minutes").notNull().default(30),
    notifyCaregiver: boolean("notify_caregiver").notNull().default(true),
    notifyDoctor: boolean("notify_doctor").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
);

export const patientProviderAssignmentsTable = pgTable(
  "caretrack_patient_provider_assignments",
  {
    id: serial("id").primaryKey(),
    patientId: integer("patient_id")
      .notNull()
      .references(() => patientsTable.id, { onDelete: "cascade" }),
    providerId: integer("provider_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("caretrack_patient_provider_unique_idx").on(
      table.patientId,
      table.providerId,
    ),
    index("caretrack_assignments_provider_idx").on(table.providerId),
  ],
);

export const patientCaregiverAssignmentsTable = pgTable(
  "caretrack_patient_caregiver_assignments",
  {
    id: serial("id").primaryKey(),
    patientId: integer("patient_id")
      .notNull()
      .references(() => patientsTable.id, { onDelete: "cascade" }),
    caregiverId: integer("caregiver_id")
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

export const medicationsTable = pgTable(
  "caretrack_medications",
  {
    id: serial("id").primaryKey(),
    patientId: integer("patient_id")
      .notNull()
      .references(() => patientsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    dosage: text("dosage").notNull(),
    form: text("form").notNull().default("tablet"),
    frequency: text("frequency").notNull().default("daily"),
    timesPerDay: integer("times_per_day").notNull().default(1),
    scheduleTimes: text("schedule_times").array().notNull().default([]),
    daysOfWeek: integer("days_of_week").array().notNull().default([]),
    intervalHours: integer("interval_hours"),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }),
    instructions: text("instructions"),
    prescribedBy: integer("prescribed_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    active: boolean("active").notNull().default(true),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("caretrack_medications_patient_idx").on(table.patientId),
    index("caretrack_medications_active_idx").on(table.active),
  ],
);

/** Patient-owned medical history and clinician-entered clinical events. */
export const medicalHistoryTable = pgTable(
  "caretrack_medical_history",
  {
    id: serial("id").primaryKey(),
    patientId: integer("patient_id").notNull().references(() => patientsTable.id, { onDelete: "cascade" }),
    occurredOn: date("occurred_on", { mode: "string" }).notNull(),
    title: text("title").notNull(),
    notes: text("notes"),
    enteredBy: integer("entered_by").references(() => usersTable.id, { onDelete: "set null" }),
    enteredAt: timestamp("entered_at", { withTimezone: true }).notNull().defaultNow(),
    active: boolean("active").notNull().default(true),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [index("caretrack_medical_history_patient_idx").on(table.patientId, table.occurredOn)],
);

export const consultationsTable = pgTable(
  "caretrack_consultations",
  {
    id: serial("id").primaryKey(),
    patientId: integer("patient_id").notNull().references(() => patientsTable.id, { onDelete: "cascade" }),
    providerId: integer("provider_id").references(() => usersTable.id, { onDelete: "set null" }),
    appointmentId: integer("appointment_id").references(() => appointmentsTable.id, { onDelete: "set null" }),
    consultationDate: date("consultation_date", { mode: "string" }).notNull(),
    complaint: text("complaint").notNull(),
    assessment: text("assessment"),
    notes: text("notes"),
    followUp: text("follow_up"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    active: boolean("active").notNull().default(true),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [index("caretrack_consultations_patient_idx").on(table.patientId, table.consultationDate)],
);

export const prescriptionsTable = pgTable(
  "caretrack_prescriptions",
  {
    id: serial("id").primaryKey(),
    consultationId: integer("consultation_id").notNull().references(() => consultationsTable.id, { onDelete: "cascade" }),
    patientId: integer("patient_id").notNull().references(() => patientsTable.id, { onDelete: "cascade" }),
    providerId: integer("provider_id").references(() => usersTable.id, { onDelete: "set null" }),
    medicationName: text("medication_name").notNull(),
    dosage: text("dosage").notNull(),
    frequency: text("frequency").notNull(),
    durationDays: integer("duration_days").notNull(),
    instructions: text("instructions"),
    scheduleTimes: text("schedule_times").array().notNull().default([]),
    medicationId: integer("medication_id").references(() => medicationsTable.id, { onDelete: "set null" }),
    prescribedAt: timestamp("prescribed_at", { withTimezone: true }).notNull().defaultNow(),
    active: boolean("active").notNull().default(true),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [index("caretrack_prescriptions_patient_idx").on(table.patientId, table.prescribedAt)],
);

/** Immutable edit/delete audit trail shared by all soft-deleted clinical records. */
export const recordHistoryTable = pgTable(
  "caretrack_record_history",
  {
    id: serial("id").primaryKey(),
    entity: text("entity").notNull(),
    entityId: integer("entity_id").notNull(),
    action: text("action").notNull(),
    changedBy: integer("changed_by").references(() => usersTable.id, { onDelete: "set null" }),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
    before: jsonb("before").notNull().default({}),
    after: jsonb("after").notNull().default({}),
  },
  (table) => [index("caretrack_record_history_entity_idx").on(table.entity, table.entityId, table.changedAt)],
);

export const doseLogsTable = pgTable(
  "caretrack_dose_logs",
  {
    id: serial("id").primaryKey(),
    patientId: integer("patient_id")
      .notNull()
      .references(() => patientsTable.id, { onDelete: "cascade" }),
    medicationId: integer("medication_id")
      .notNull()
      .references(() => medicationsTable.id, { onDelete: "cascade" }),
    scheduledTime: timestamp("scheduled_time", {
      withTimezone: true,
    }).notNull(),
    takenTime: timestamp("taken_time", { withTimezone: true }),
    status: text("status").notNull().default("scheduled"),
    notes: text("notes"),
    // Who recorded the status, e.g. "Alex Morgan (patient)" or "System: not logged within 2 hours".
    loggedBy: text("logged_by"),
    // Set once the "dose due" in-app reminder has been sent.
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
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

export const sessionsTable = pgTable(
  "caretrack_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("caretrack_sessions_expiry_idx").on(table.expiresAt)],
);

export const auditLogsTable = pgTable(
  "caretrack_audit_logs",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id"),
    details: jsonb("details").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("caretrack_audit_user_time_idx").on(table.userId, table.createdAt),
    index("caretrack_audit_entity_idx").on(
      table.entityType,
      table.entityId,
    ),
  ],
);

export const notificationsTable = pgTable(
  "caretrack_notifications",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    patientId: integer("patient_id").references(() => patientsTable.id, {
      onDelete: "cascade",
    }),
    kind: text("kind").notNull().default("info"),
    title: text("title").notNull(),
    message: text("message").notNull(),
    read: boolean("read").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("caretrack_notifications_user_time_idx").on(
      table.userId,
      table.createdAt,
    ),
    index("caretrack_notifications_unread_idx").on(table.userId, table.read),
  ],
);

export const aiInsightsTable = pgTable(
  "caretrack_ai_insights",
  {
    id: serial("id").primaryKey(),
    patientId: integer("patient_id")
      .notNull()
      .references(() => patientsTable.id, { onDelete: "cascade" }),
    generatedBy: integer("generated_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    summary: text("summary").notNull(),
    riskLevel: text("risk_level").notNull(),
    recommendations: text("recommendations").array().notNull().default([]),
    source: text("source").notNull().default("rules"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("caretrack_insights_patient_time_idx").on(
      table.patientId,
      table.createdAt,
    ),
  ],
);

export const reportsTable = pgTable(
  "caretrack_reports",
  {
    id: serial("id").primaryKey(),
    patientId: integer("patient_id").references(() => patientsTable.id, {
      onDelete: "set null",
    }),
    generatedBy: integer("generated_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    period: text("period").notNull(),
    rangeStart: date("range_start", { mode: "string" }).notNull(),
    rangeEnd: date("range_end", { mode: "string" }).notNull(),
    adherenceRate: integer("adherence_rate").notNull().default(0),
    summary: text("summary").notNull(),
    reportData: jsonb("report_data").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("caretrack_reports_patient_time_idx").on(
      table.patientId,
      table.createdAt,
    ),
    index("caretrack_reports_creator_idx").on(table.generatedBy, table.createdAt),
  ],
);

export const reportSchedulesTable = pgTable(
  "caretrack_report_schedules",
  {
    id: serial("id").primaryKey(),
    createdBy: integer("created_by")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    patientId: integer("patient_id").references(() => patientsTable.id, {
      onDelete: "cascade",
    }),
    cadence: text("cadence").notNull(),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
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
export const otpChallengesTable = pgTable(
  "caretrack_otp_challenges",
  {
    id: serial("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    codeHash: text("code_hash"),
    channel: text("channel"),
    codeExpiresAt: timestamp("code_expires_at", { withTimezone: true }),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("caretrack_otp_token_idx").on(table.tokenHash),
    index("caretrack_otp_user_idx").on(table.userId),
  ],
);

/** Patient and care-team messages. Each patient has one shared conversation. */
export const messagesTable = pgTable(
  "caretrack_messages",
  {
    id: serial("id").primaryKey(),
    patientId: integer("patient_id")
      .notNull()
      .references(() => patientsTable.id, { onDelete: "cascade" }),
    senderId: integer("sender_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("caretrack_messages_patient_time_idx").on(
      table.patientId,
      table.createdAt,
    ),
  ],
);

/** When each user last read each patient's conversation, for unread counts. */
export const messageReadsTable = pgTable(
  "caretrack_message_reads",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    patientId: integer("patient_id")
      .notNull()
      .references(() => patientsTable.id, { onDelete: "cascade" }),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }).notNull(),
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
export const providerCoverageTable = pgTable(
  "caretrack_provider_coverage",
  {
    id: serial("id").primaryKey(),
    absentProviderId: integer("absent_provider_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    coveringProviderId: integer("covering_provider_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }),
    reason: text("reason"),
    createdBy: integer("created_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("caretrack_coverage_absent_idx").on(table.absentProviderId),
    index("caretrack_coverage_covering_idx").on(table.coveringProviderId),
  ],
);

/** One training run of the Random Forest risk model, with its evaluation metrics. */
export const modelRunsTable = pgTable("caretrack_model_runs", {
  id: serial("id").primaryKey(),
  algorithm: text("algorithm").notNull(),
  trees: integer("trees").notNull(),
  maxDepth: integer("max_depth").notNull(),
  samples: integer("samples").notNull(),
  classDistribution: jsonb("class_distribution").notNull().default({}),
  oobAccuracy: real("oob_accuracy"),
  featureImportance: jsonb("feature_importance").notNull().default([]),
  trainedBy: integer("trained_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Predicted risk of non-adherence over the next 7 days, with the factors behind it. */
export const riskPredictionsTable = pgTable(
  "caretrack_risk_predictions",
  {
    id: serial("id").primaryKey(),
    patientId: integer("patient_id")
      .notNull()
      .references(() => patientsTable.id, { onDelete: "cascade" }),
    modelRunId: integer("model_run_id").references(() => modelRunsTable.id, {
      onDelete: "set null",
    }),
    riskLevel: text("risk_level").notNull(),
    riskScore: integer("risk_score").notNull(),
    probLow: real("prob_low").notNull(),
    probModerate: real("prob_moderate").notNull(),
    probHigh: real("prob_high").notNull(),
    features: jsonb("features").notNull().default({}),
    factors: jsonb("factors").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("caretrack_risk_patient_time_idx").on(table.patientId, table.createdAt),
  ],
);

/** Laboratory result files. File contents are stored AES-256-GCM encrypted. */
export const labResultsTable = pgTable(
  "caretrack_lab_results",
  {
    id: serial("id").primaryKey(),
    patientId: integer("patient_id")
      .notNull()
      .references(() => patientsTable.id, { onDelete: "cascade" }),
    uploadedBy: integer("uploaded_by").references(() => usersTable.id, { onDelete: "set null" }),
    // "lab" for laboratory results, "prescription" for prescriptions uploaded by a doctor.
    category: text("category").notNull().default("lab"),
    title: text("title").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    encryptedData: text("encrypted_data").notNull(),
    notes: text("notes"),
    reviewComment: text("review_comment"),
    reviewedBy: integer("reviewed_by").references(() => usersTable.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("caretrack_lab_results_patient_idx").on(table.patientId, table.createdAt)],
);

/** Follow-up check-ups between a patient and their doctor. */
export const appointmentsTable = pgTable(
  "caretrack_appointments",
  {
    id: serial("id").primaryKey(),
    patientId: integer("patient_id")
      .notNull()
      .references(() => patientsTable.id, { onDelete: "cascade" }),
    providerId: integer("provider_id").references(() => usersTable.id, { onDelete: "set null" }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("scheduled"),
    notes: text("notes"),
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("caretrack_appointments_patient_idx").on(table.patientId, table.scheduledAt),
    index("caretrack_appointments_provider_idx").on(table.providerId, table.scheduledAt),
  ],
);

/** Structured health observations recorded by a patient, caregiver, or care team. */
export const healthMetricsTable = pgTable(
  "caretrack_health_metrics",
  {
    id: serial("id").primaryKey(),
    patientId: integer("patient_id").notNull().references(() => patientsTable.id, { onDelete: "cascade" }),
    metricType: text("metric_type").notNull(),
    value: real("value").notNull(),
    secondaryValue: real("secondary_value"),
    unit: text("unit").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    recordedBy: integer("recorded_by").references(() => usersTable.id, { onDelete: "set null" }),
    note: text("note"),
    outOfRange: boolean("out_of_range").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("caretrack_health_metrics_patient_time_idx").on(table.patientId, table.recordedAt),
    index("caretrack_health_metrics_patient_type_idx").on(table.patientId, table.metricType),
  ],
);

export const healthLogsTable = pgTable(
  "caretrack_health_logs",
  {
    id: serial("id").primaryKey(),
    patientId: integer("patient_id").notNull().references(() => patientsTable.id, { onDelete: "cascade" }),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    symptoms: text("symptoms").array().notNull().default([]),
    notes: text("notes"),
    recordedBy: integer("recorded_by").references(() => usersTable.id, { onDelete: "set null" }),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("caretrack_health_logs_patient_time_idx").on(table.patientId, table.recordedAt),
  ],
);

export const healthMetricRangesTable = pgTable(
  "caretrack_health_metric_ranges",
  {
    id: serial("id").primaryKey(),
    patientId: integer("patient_id").notNull().references(() => patientsTable.id, { onDelete: "cascade" }),
    metricType: text("metric_type").notNull(),
    minValue: real("min_value"),
    maxValue: real("max_value"),
    secondaryMaxValue: real("secondary_max_value"),
    configuredBy: integer("configured_by").references(() => usersTable.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("caretrack_health_ranges_patient_type_idx").on(table.patientId, table.metricType)],
);
