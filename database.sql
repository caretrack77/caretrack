-- ============================================================
-- Health Monitoring and Medication Adherence System
-- Revised schema (v2)
-- Target: MySQL 8.0+ (InnoDB, utf8mb4)
--
-- Modules covered:
--   ADMIN PANEL   : Users Management, Roles and Permissions,
--                   System Logs (audit and login history), System Settings
--   CLINICAL      : Patients, Doctors, Caregivers, Medical History
--   MONITORING    : Health Logs, Health Metrics (vital signs), Symptoms
--   MEDICATION    : Medication, Schedule, Reminder Log
--   INTELLIGENCE  : AI Analysis, Alerts, Reports, Notifications
--
-- Scope note: laboratory results (for example cholesterol, HbA1c,
-- creatinine, CBC) are NOT included, because the system does not
-- integrate with a Laboratory Information System (LIS). Only vital
-- signs and values that a patient or caregiver can measure at home
-- are supported.
-- ============================================================

CREATE DATABASE IF NOT EXISTS health_monitoring
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE health_monitoring;

-- ============================================================
-- 1. ADMIN PANEL: ROLES AND PERMISSIONS (RBAC)
-- ============================================================

CREATE TABLE roles (
    role_id      TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    role_name    VARCHAR(30)  NOT NULL UNIQUE,
    description  VARCHAR(255) NULL,
    is_system    BOOLEAN      NOT NULL DEFAULT FALSE,  -- system roles cannot be deleted
    created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE permissions (
    permission_id  SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    module         VARCHAR(50)  NOT NULL,   -- for example: user_management
    action         VARCHAR(30)  NOT NULL,   -- for example: view, create, update
    description    VARCHAR(255) NULL,
    UNIQUE KEY uq_permission (module, action)
) ENGINE=InnoDB;

CREATE TABLE role_permissions (
    role_id        TINYINT UNSIGNED  NOT NULL,
    permission_id  SMALLINT UNSIGNED NOT NULL,
    PRIMARY KEY (role_id, permission_id),
    CONSTRAINT fk_rp_role
        FOREIGN KEY (role_id) REFERENCES roles (role_id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_rp_permission
        FOREIGN KEY (permission_id) REFERENCES permissions (permission_id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- ============================================================
-- 2. ADMIN PANEL: USERS MANAGEMENT
-- ============================================================

CREATE TABLE user_account (
    user_id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    role_id                 TINYINT UNSIGNED NOT NULL,
    email                   VARCHAR(255) NOT NULL UNIQUE,
    password_hash           VARCHAR(255) NOT NULL,
    account_status          ENUM('pending', 'active', 'inactive', 'suspended') NOT NULL DEFAULT 'pending',
    failed_login_attempts   TINYINT UNSIGNED NOT NULL DEFAULT 0,
    last_login              DATETIME NULL,
    email_verified_at       DATETIME NULL,
    created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_user_role
        FOREIGN KEY (role_id) REFERENCES roles (role_id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE admin_profile (
    admin_id        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id         INT UNSIGNED NOT NULL UNIQUE,
    full_name       VARCHAR(150) NOT NULL,
    contact_number  VARCHAR(30)  NULL,
    position        VARCHAR(100) NULL,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_admin_user
        FOREIGN KEY (user_id) REFERENCES user_account (user_id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- ============================================================
-- 3. ADMIN PANEL: SYSTEM LOGS
-- ============================================================

-- Audit trail: who did what, in which module, and when.
CREATE TABLE system_log (
    system_log_id  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id        INT UNSIGNED NULL,
    module         VARCHAR(50)  NOT NULL,           -- for example: user_management
    action         VARCHAR(50)  NOT NULL,           -- for example: create, update, delete, export
    entity_table   VARCHAR(64)  NULL,
    entity_id      BIGINT UNSIGNED NULL,
    description    VARCHAR(500) NULL,
    old_values     JSON NULL,
    new_values     JSON NULL,
    log_level      ENUM('info', 'warning', 'error') NOT NULL DEFAULT 'info',
    ip_address     VARCHAR(45)  NULL,
    user_agent     VARCHAR(255) NULL,
    created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_syslog_user
        FOREIGN KEY (user_id) REFERENCES user_account (user_id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

-- Login attempts (successful and failed), used for security monitoring.
CREATE TABLE login_history (
    login_id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id          INT UNSIGNED NULL,
    email_attempted  VARCHAR(255) NOT NULL,
    status           ENUM('success', 'failed', 'locked') NOT NULL,
    ip_address       VARCHAR(45)  NULL,
    user_agent       VARCHAR(255) NULL,
    attempted_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_login_user
        FOREIGN KEY (user_id) REFERENCES user_account (user_id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

-- ============================================================
-- 4. ADMIN PANEL: SYSTEM SETTINGS
-- ============================================================

CREATE TABLE system_settings (
    setting_key         VARCHAR(100) PRIMARY KEY,
    setting_value       VARCHAR(500) NOT NULL,
    description         VARCHAR(255) NULL,
    updated_by_user_id  INT UNSIGNED NULL,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_settings_user
        FOREIGN KEY (updated_by_user_id) REFERENCES user_account (user_id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

-- ============================================================
-- 5. PEOPLE: PATIENTS, DOCTORS, CAREGIVERS
-- (email is stored only in user_account to avoid duplication)
-- ============================================================

CREATE TABLE doctor (
    doctor_id       INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id         INT UNSIGNED NOT NULL UNIQUE,
    full_name       VARCHAR(150) NOT NULL,
    contact_number  VARCHAR(30)  NULL,
    specialization  VARCHAR(100) NULL,
    license_number  VARCHAR(50)  NULL UNIQUE,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_doctor_user
        FOREIGN KEY (user_id) REFERENCES user_account (user_id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE patient (
    patient_id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id            INT UNSIGNED NOT NULL UNIQUE,
    full_name          VARCHAR(150) NOT NULL,
    birthdate          DATE NULL,
    gender             ENUM('male', 'female', 'other') NULL,
    contact_number     VARCHAR(30)  NULL,
    address            VARCHAR(255) NULL,
    emergency_name     VARCHAR(150) NULL,
    emergency_contact  VARCHAR(30)  NULL,
    relationship       VARCHAR(50)  NULL,   -- relationship of the emergency contact
    created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_patient_user
        FOREIGN KEY (user_id) REFERENCES user_account (user_id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE caregiver (
    caregiver_id    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id         INT UNSIGNED NOT NULL UNIQUE,
    full_name       VARCHAR(150) NOT NULL,
    address         VARCHAR(255) NULL,
    contact_number  VARCHAR(30)  NULL,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_caregiver_user
        FOREIGN KEY (user_id) REFERENCES user_account (user_id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- A caregiver can look after many patients, and a patient can have many caregivers.
CREATE TABLE caregiver_patient (
    caregiver_patient_id     INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    caregiver_id             INT UNSIGNED NOT NULL,
    patient_id               INT UNSIGNED NOT NULL,
    relationship_to_patient  VARCHAR(50) NULL,
    is_primary               BOOLEAN NOT NULL DEFAULT FALSE,
    assigned_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_caregiver_patient (caregiver_id, patient_id),
    CONSTRAINT fk_cp_caregiver
        FOREIGN KEY (caregiver_id) REFERENCES caregiver (caregiver_id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_cp_patient
        FOREIGN KEY (patient_id) REFERENCES patient (patient_id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- Doctor assignment: shows which doctor is responsible for which patient.
CREATE TABLE doctor_patient (
    assignment_id  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    doctor_id      INT UNSIGNED NOT NULL,
    patient_id     INT UNSIGNED NOT NULL,
    status         ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    assigned_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_doctor_patient (doctor_id, patient_id),
    CONSTRAINT fk_dp_doctor
        FOREIGN KEY (doctor_id) REFERENCES doctor (doctor_id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_dp_patient
        FOREIGN KEY (patient_id) REFERENCES patient (patient_id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE medical_history (
    history_id      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    patient_id      INT UNSIGNED NOT NULL,
    `condition`     VARCHAR(150) NOT NULL,
    description     TEXT NULL,
    notes           TEXT NULL,
    diagnosed_date  DATE NULL,
    status          ENUM('active', 'managed', 'resolved') NOT NULL DEFAULT 'active',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_history_patient
        FOREIGN KEY (patient_id) REFERENCES patient (patient_id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- ============================================================
-- 6. HEALTH MONITORING
-- ============================================================

-- Lookup table: the exact list of health metrics the system accepts.
-- Vital signs and home-measurable values only (no laboratory tests).
CREATE TABLE metric_type (
    metric_type_id  SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    code            VARCHAR(30)  NOT NULL UNIQUE,
    name            VARCHAR(100) NOT NULL,
    category        ENUM('vital_sign', 'body_measurement', 'self_monitored') NOT NULL,
    unit            VARCHAR(20)  NOT NULL,
    normal_min      DECIMAL(7,2) NULL,   -- lower limit of the normal range
    normal_max      DECIMAL(7,2) NULL,   -- upper limit of the normal range
    critical_min    DECIMAL(7,2) NULL,   -- at or below this value: critical
    critical_max    DECIMAL(7,2) NULL,   -- at or above this value: critical
    description     VARCHAR(255) NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;

CREATE TABLE symptom (
    symptom_id  SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100) NOT NULL UNIQUE,
    category    VARCHAR(50)  NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;

CREATE TABLE health_log (
    log_id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    patient_id              INT UNSIGNED NOT NULL,
    recorded_by_user_id     INT UNSIGNED NULL,   -- patient or caregiver who entered the log
    reviewed_by_doctor_id   INT UNSIGNED NULL,
    reviewed_at             DATETIME NULL,
    overall_status          ENUM('stable', 'needs_attention', 'critical') NULL,
    notes                   TEXT NULL,
    log_date                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_healthlog_patient
        FOREIGN KEY (patient_id) REFERENCES patient (patient_id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_healthlog_recorder
        FOREIGN KEY (recorded_by_user_id) REFERENCES user_account (user_id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_healthlog_doctor
        FOREIGN KEY (reviewed_by_doctor_id) REFERENCES doctor (doctor_id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

-- One row per measurement. The patient is found through health_log.
CREATE TABLE health_metrics (
    metric_id       BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    log_id          INT UNSIGNED NOT NULL,
    metric_type_id  SMALLINT UNSIGNED NOT NULL,
    value           DECIMAL(7,2) NOT NULL,
    measured_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    source          ENUM('manual', 'device') NOT NULL DEFAULT 'manual',
    is_abnormal     BOOLEAN NOT NULL DEFAULT FALSE,   -- set by the application using metric_type ranges
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_metrics_log
        FOREIGN KEY (log_id) REFERENCES health_log (log_id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_metrics_type
        FOREIGN KEY (metric_type_id) REFERENCES metric_type (metric_type_id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

-- Structured symptoms per health log (replaces the free-text symptoms field).
CREATE TABLE health_log_symptom (
    log_symptom_id  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    log_id          INT UNSIGNED NOT NULL,
    symptom_id      SMALLINT UNSIGNED NOT NULL,
    severity        ENUM('mild', 'moderate', 'severe') NOT NULL DEFAULT 'mild',
    UNIQUE KEY uq_log_symptom (log_id, symptom_id),
    CONSTRAINT fk_hls_log
        FOREIGN KEY (log_id) REFERENCES health_log (log_id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_hls_symptom
        FOREIGN KEY (symptom_id) REFERENCES symptom (symptom_id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

-- ============================================================
-- 7. MEDICATION
-- ============================================================

CREATE TABLE medication (
    medication_id  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    generic_name   VARCHAR(150) NOT NULL,
    brand_name     VARCHAR(150) NULL,
    dosage_form    ENUM('tablet', 'capsule', 'syrup', 'injection', 'inhaler', 'drops', 'cream', 'other') NOT NULL DEFAULT 'tablet',
    strength       VARCHAR(50)  NULL,   -- for example: 500 mg
    description    TEXT NULL,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Dosage and frequency are set per patient, so they are stored here.
CREATE TABLE schedule (
    schedule_id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    patient_id               INT UNSIGNED NOT NULL,
    medication_id            INT UNSIGNED NOT NULL,
    prescribed_by_doctor_id  INT UNSIGNED NULL,
    dosage                   VARCHAR(50)  NOT NULL,   -- for example: 1 tablet
    frequency                VARCHAR(50)  NOT NULL,   -- for example: twice a day
    intake_time              TIME NOT NULL,
    start_date               DATE NOT NULL,
    end_date                 DATE NULL,
    instructions             TEXT NULL,
    status                   ENUM('active', 'paused', 'completed', 'discontinued') NOT NULL DEFAULT 'active',
    created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_schedule_patient
        FOREIGN KEY (patient_id) REFERENCES patient (patient_id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_schedule_medication
        FOREIGN KEY (medication_id) REFERENCES medication (medication_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_schedule_doctor
        FOREIGN KEY (prescribed_by_doctor_id) REFERENCES doctor (doctor_id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT chk_schedule_dates CHECK (end_date IS NULL OR end_date >= start_date)
) ENGINE=InnoDB;

-- status replaces the old is_taken column (one source of truth).
CREATE TABLE reminder_log (
    reminder_id     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    schedule_id     INT UNSIGNED NOT NULL,
    scheduled_time  DATETIME NOT NULL,
    sent_time       DATETIME NULL,
    taken_time      DATETIME NULL,
    status          ENUM('pending', 'sent', 'taken', 'missed', 'skipped') NOT NULL DEFAULT 'pending',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_reminder_schedule
        FOREIGN KEY (schedule_id) REFERENCES schedule (schedule_id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- ============================================================
-- 8. AI ANALYSIS, ALERTS, REPORTS, NOTIFICATIONS
-- ============================================================

CREATE TABLE ai_analysis (
    analysis_id       INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    log_id            INT UNSIGNED NOT NULL,
    model_version     VARCHAR(50)  NULL,
    risk_level        ENUM('low', 'moderate', 'high', 'critical') NOT NULL,
    prediction        TEXT NULL,
    confidence_score  DECIMAL(5,4) NULL,
    recommendation    TEXT NULL,
    created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_analysis_log
        FOREIGN KEY (log_id) REFERENCES health_log (log_id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT chk_confidence CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 1)
) ENGINE=InnoDB;



-- An alert can come from an AI analysis or from a missed medication reminder.
CREATE TABLE alert (
    alert_id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    patient_id               INT UNSIGNED NOT NULL,
    analysis_id              INT UNSIGNED NULL,
    reminder_id              BIGINT UNSIGNED NULL,
    alert_type               ENUM('health_risk', 'abnormal_metric', 'missed_medication', 'system') NOT NULL,
    severity                 ENUM('low', 'moderate', 'high', 'critical') NOT NULL DEFAULT 'moderate',
    status                   ENUM('open', 'acknowledged', 'resolved') NOT NULL DEFAULT 'open',
    message                  TEXT NOT NULL,
    acknowledged_by_user_id  INT UNSIGNED NULL,
    acknowledged_at          DATETIME NULL,
    resolved_at              DATETIME NULL,
    created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_alert_patient
        FOREIGN KEY (patient_id) REFERENCES patient (patient_id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_alert_analysis
        FOREIGN KEY (analysis_id) REFERENCES ai_analysis (analysis_id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_alert_reminder
        FOREIGN KEY (reminder_id) REFERENCES reminder_log (reminder_id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_alert_ack_user
        FOREIGN KEY (acknowledged_by_user_id) REFERENCES user_account (user_id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE report (
    report_id       INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    alert_id        INT UNSIGNED NOT NULL,
    doctor_id       INT UNSIGNED NOT NULL,
    report_date     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    summary         TEXT NULL,
    action_taken    TEXT NULL,
    follow_up       TEXT NULL,
    follow_up_date  DATE NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_report_alert
        FOREIGN KEY (alert_id) REFERENCES alert (alert_id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_report_doctor
        FOREIGN KEY (doctor_id) REFERENCES doctor (doctor_id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

-- Every notification has a clear recipient (recipient_user_id) and a source.
CREATE TABLE notification (
    notification_id    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    recipient_user_id  INT UNSIGNED NOT NULL,
    patient_id         INT UNSIGNED NULL,
    log_id             INT UNSIGNED NULL,
    alert_id           INT UNSIGNED NULL,
    reminder_id        BIGINT UNSIGNED NULL,
    type               ENUM('medication_reminder', 'health_alert', 'report', 'system') NOT NULL,
    title              VARCHAR(150) NOT NULL,
    message            TEXT NULL,
    sent_time          DATETIME NULL,
    is_read            BOOLEAN NOT NULL DEFAULT FALSE,
    read_at            DATETIME NULL,
    created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_notif_user
        FOREIGN KEY (recipient_user_id) REFERENCES user_account (user_id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_notif_patient
        FOREIGN KEY (patient_id) REFERENCES patient (patient_id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_notif_log
        FOREIGN KEY (log_id) REFERENCES health_log (log_id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_notif_alert
        FOREIGN KEY (alert_id) REFERENCES alert (alert_id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_notif_reminder
        FOREIGN KEY (reminder_id) REFERENCES reminder_log (reminder_id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

-- ============================================================
-- 9. INDEXES
-- ============================================================

CREATE INDEX idx_user_role_status       ON user_account (role_id, account_status);
CREATE INDEX idx_syslog_user_date       ON system_log (user_id, created_at);
CREATE INDEX idx_syslog_module_date     ON system_log (module, created_at);
CREATE INDEX idx_login_email_date       ON login_history (email_attempted, attempted_at);
CREATE INDEX idx_healthlog_patient_date ON health_log (patient_id, log_date);
CREATE INDEX idx_metrics_log            ON health_metrics (log_id);
CREATE INDEX idx_metrics_type_date      ON health_metrics (metric_type_id, measured_at);
CREATE INDEX idx_schedule_patient       ON schedule (patient_id, status);
CREATE INDEX idx_reminder_sched_time    ON reminder_log (schedule_id, scheduled_time);
CREATE INDEX idx_analysis_log           ON ai_analysis (log_id);
CREATE INDEX idx_alert_patient_status   ON alert (patient_id, status);
CREATE INDEX idx_notif_user_read        ON notification (recipient_user_id, is_read);

-- ============================================================
-- 10. SEED DATA
-- ============================================================

-- ---- Roles ----
INSERT INTO roles (role_name, description, is_system) VALUES
    ('admin',     'System administrator. Manages users, roles, logs and settings.', TRUE),
    ('doctor',    'Reviews patient records, alerts and prescribes medication schedules.', TRUE),
    ('patient',   'Records own health logs and follows the medication schedule.', TRUE),
    ('caregiver', 'Assists assigned patients with health logs and medication.', TRUE);

-- ---- Permissions (grouped by module) ----
INSERT INTO permissions (module, action, description) VALUES
    ('user_management',  'view',         'View the list of user accounts'),
    ('user_management',  'create',       'Create a user account'),
    ('user_management',  'update',       'Edit a user account'),
    ('user_management',  'deactivate',   'Deactivate or suspend a user account'),
    ('user_management',  'reset_password','Reset a user password'),
    ('role_management',  'view',         'View roles and permissions'),
    ('role_management',  'create',       'Create a role'),
    ('role_management',  'update',       'Edit a role and its permissions'),
    ('role_management',  'delete',       'Delete a non-system role'),
    ('system_logs',      'view',         'View audit logs and login history'),
    ('system_logs',      'export',       'Export system logs'),
    ('system_settings',  'view',         'View system settings'),
    ('system_settings',  'update',       'Update system settings'),
    ('patient_records',  'view',         'View patient profile and medical history'),
    ('patient_records',  'update',       'Update patient profile and medical history'),
    ('health_logs',      'view',         'View health logs and metrics'),
    ('health_logs',      'create',       'Record a health log'),
    ('health_logs',      'review',       'Review a health log as a doctor'),
    ('medication',       'view',         'View medication and schedules'),
    ('medication',       'manage',       'Create and update medication schedules'),
    ('alerts',           'view',         'View alerts'),
    ('alerts',           'acknowledge',  'Acknowledge or resolve alerts'),
    ('reports',          'view',         'View reports'),
    ('reports',          'create',       'Create reports'),
    ('notifications',    'view',         'View notifications');

-- ---- Role-permission mapping ----
-- Admin: administrative modules only (no access to clinical data, for privacy).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
JOIN permissions p ON p.module IN ('user_management', 'role_management', 'system_logs', 'system_settings')
WHERE r.role_name = 'admin';


-- Doctor
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
JOIN permissions p ON (p.module, p.action) IN (
    ('patient_records', 'view'), ('patient_records', 'update'),
    ('health_logs', 'view'), ('health_logs', 'review'),
    ('medication', 'view'), ('medication', 'manage'),
    ('alerts', 'view'), ('alerts', 'acknowledge'),
    ('reports', 'view'), ('reports', 'create'),
    ('notifications', 'view'))
WHERE r.role_name = 'doctor';

-- Patient
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
JOIN permissions p ON (p.module, p.action) IN (
    ('patient_records', 'view'), ('patient_records', 'update'),
    ('health_logs', 'view'), ('health_logs', 'create'),
    ('medication', 'view'),
    ('alerts', 'view'),
    ('reports', 'view'),
    ('notifications', 'view'))
WHERE r.role_name = 'patient';

-- Caregiver
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
JOIN permissions p ON (p.module, p.action) IN (
    ('patient_records', 'view'),
    ('health_logs', 'view'), ('health_logs', 'create'),
    ('medication', 'view'),
    ('alerts', 'view'),
    ('notifications', 'view'))
WHERE r.role_name = 'caregiver';

-- ---- Health metrics included in the system ----
-- The ranges below are general adult reference values for the prototype.
-- Have them validated by a licensed doctor before final use.
INSERT INTO metric_type
    (code, name, category, unit, normal_min, normal_max, critical_min, critical_max, description) VALUES
    ('BP_SYS',   'Systolic Blood Pressure',  'vital_sign',       'mmHg',     90,   120,   70,  180, 'Upper blood pressure reading'),
    ('BP_DIA',   'Diastolic Blood Pressure', 'vital_sign',       'mmHg',     60,    80,   40,  120, 'Lower blood pressure reading'),
    ('HR',       'Heart Rate (Pulse)',       'vital_sign',       'bpm',      60,   100,   40,  130, 'Beats per minute at rest'),
    ('RR',       'Respiratory Rate',         'vital_sign',       'breaths/min', 12, 20,    8,   30, 'Breaths per minute at rest'),
    ('TEMP',     'Body Temperature',         'vital_sign',       'C',      36.1,  37.2, 35.0, 39.5, 'Body temperature in degrees Celsius'),
    ('SPO2',     'Oxygen Saturation (SpO2)', 'vital_sign',       '%',        95,   100,   90, NULL, 'Measured with a pulse oximeter'),
    ('GLU_FBS',  'Blood Glucose (Fasting)',  'self_monitored',   'mg/dL',    70,    99,   54,  250, 'Measured with a glucometer after fasting'),
    ('GLU_RBS',  'Blood Glucose (Random)',   'self_monitored',   'mg/dL',    70,   140,   54,  300, 'Measured with a glucometer at any time'),
    ('WEIGHT',   'Body Weight',              'body_measurement', 'kg',     NULL,  NULL, NULL, NULL, 'Tracked for trends, no fixed normal range'),
    ('HEIGHT',   'Height',                   'body_measurement', 'cm',     NULL,  NULL, NULL, NULL, 'Used to compute BMI'),
    ('BMI',      'Body Mass Index',          'body_measurement', 'kg/m2',  18.5,  24.9, NULL, NULL, 'Computed from weight and height'),
    ('PAIN',     'Pain Level',               'self_monitored',   'score (0-10)', 0,  3, NULL,    8, 'Self-reported pain scale from 0 (none) to 10 (worst)');

-- ---- Symptoms the patient can select ----
INSERT INTO symptom (name, category) VALUES
    ('Headache',                'General'),
    ('Dizziness',               'General'),
    ('Fatigue / weakness',      'General'),
    ('Fever',                   'General'),
    ('Chest pain',              'Cardiovascular'),
    ('Palpitations',            'Cardiovascular'),
    ('Swelling of legs or feet','Cardiovascular'),
    ('Shortness of breath',     'Respiratory'),
    ('Cough',                   'Respiratory'),
    ('Nausea / vomiting',       'Digestive'),
    ('Abdominal pain',          'Digestive'),
    ('Blurred vision',          'Neurological'),
    ('Numbness or tingling',    'Neurological'),
    ('Excessive thirst',        'Metabolic'),
    ('Frequent urination',      'Metabolic'),
    ('Loss of appetite',        'General'),
    ('Difficulty sleeping',     'General');

-- ---- Default system settings ----
INSERT INTO system_settings (setting_key, setting_value, description) VALUES
    ('max_failed_login_attempts', '5',   'Number of failed logins before the account is locked'),
    ('session_timeout_minutes',   '30',  'Idle time before the user is logged out'),
    ('reminder_lead_minutes',     '10',  'Minutes before the scheduled time that a reminder is sent'),
    ('missed_dose_after_minutes', '60',  'Minutes after the scheduled time before a dose is marked as missed'),
    ('log_retention_days',        '365', 'Number of days system logs are kept');

-- ============================================================
-- 11. CARETRACK APPLICATION COMPATIBILITY TABLES
-- ============================================================
-- These tables retain the current API's feature set while the clinical
-- tables above remain the canonical relational model for the supplied schema.

CREATE TABLE IF NOT EXISTS caretrack_users (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name                VARCHAR(150) NOT NULL,
    email               VARCHAR(255) NOT NULL UNIQUE,
    password_hash       VARCHAR(255) NOT NULL,
    role                VARCHAR(30) NOT NULL,
    phone               VARCHAR(30) NULL,
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    active              BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS caretrack_patients (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id     INT UNSIGNED NULL,
    name        VARCHAR(150) NOT NULL,
    age         INT NOT NULL,
    sex         VARCHAR(30) NOT NULL DEFAULT 'not_specified',
    phone       VARCHAR(30) NULL,
    email       VARCHAR(255) NULL UNIQUE,
    conditions  JSON NOT NULL,
    allergies   JSON NOT NULL,
    notes       TEXT NULL,
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_ct_patient_user FOREIGN KEY (user_id) REFERENCES caretrack_users (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS caretrack_patient_provider_assignments (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    patient_id  INT UNSIGNED NOT NULL,
    provider_id INT UNSIGNED NOT NULL,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY caretrack_patient_provider_unique (patient_id, provider_id),
    CONSTRAINT fk_ct_provider_patient FOREIGN KEY (patient_id) REFERENCES caretrack_patients (id) ON DELETE CASCADE,
    CONSTRAINT fk_ct_provider_user FOREIGN KEY (provider_id) REFERENCES caretrack_users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS caretrack_patient_caregiver_assignments (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    patient_id  INT UNSIGNED NOT NULL,
    caregiver_id INT UNSIGNED NOT NULL,
    UNIQUE KEY caretrack_patient_caregiver_unique (patient_id, caregiver_id),
    CONSTRAINT fk_ct_caregiver_patient FOREIGN KEY (patient_id) REFERENCES caretrack_patients (id) ON DELETE CASCADE,
    CONSTRAINT fk_ct_caregiver_user FOREIGN KEY (caregiver_id) REFERENCES caretrack_users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS caretrack_medications (
    id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    patient_id     INT UNSIGNED NOT NULL,
    name           VARCHAR(150) NOT NULL,
    dosage         VARCHAR(100) NOT NULL,
    form           VARCHAR(50) NOT NULL DEFAULT 'tablet',
    frequency      VARCHAR(50) NOT NULL DEFAULT 'daily',
    times_per_day  INT NOT NULL DEFAULT 1,
    schedule_times JSON NOT NULL,
    days_of_week   JSON NOT NULL,
    interval_hours INT NULL,
    start_date     DATE NOT NULL,
    end_date       DATE NULL,
    instructions   TEXT NULL,
    prescribed_by  INT UNSIGNED NULL,
    active         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ct_med_patient FOREIGN KEY (patient_id) REFERENCES caretrack_patients (id) ON DELETE CASCADE,
    CONSTRAINT fk_ct_med_user FOREIGN KEY (prescribed_by) REFERENCES caretrack_users (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS caretrack_dose_logs (
    id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    patient_id       INT UNSIGNED NOT NULL,
    medication_id    INT UNSIGNED NOT NULL,
    scheduled_time   DATETIME NOT NULL,
    taken_time       DATETIME NULL,
    status           VARCHAR(30) NOT NULL DEFAULT 'scheduled',
    notes            TEXT NULL,
    logged_by        VARCHAR(255) NULL,
    reminder_sent_at DATETIME NULL,
    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY caretrack_dose_schedule_unique (medication_id, scheduled_time),
    CONSTRAINT fk_ct_dose_patient FOREIGN KEY (patient_id) REFERENCES caretrack_patients (id) ON DELETE CASCADE,
    CONSTRAINT fk_ct_dose_med FOREIGN KEY (medication_id) REFERENCES caretrack_medications (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS caretrack_sessions (
    token_hash VARCHAR(128) PRIMARY KEY,
    user_id    INT UNSIGNED NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ct_session_user FOREIGN KEY (user_id) REFERENCES caretrack_users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS caretrack_audit_logs (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id     INT UNSIGNED NULL,
    action      VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id   INT NULL,
    details     JSON NOT NULL,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ct_audit_user FOREIGN KEY (user_id) REFERENCES caretrack_users (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS caretrack_notifications (
    id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id    INT UNSIGNED NOT NULL,
    patient_id INT UNSIGNED NULL,
    kind       VARCHAR(50) NOT NULL DEFAULT 'info',
    title      VARCHAR(255) NOT NULL,
    message    TEXT NOT NULL,
    `read`     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ct_notification_user FOREIGN KEY (user_id) REFERENCES caretrack_users (id) ON DELETE CASCADE,
    CONSTRAINT fk_ct_notification_patient FOREIGN KEY (patient_id) REFERENCES caretrack_patients (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS caretrack_ai_insights (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    patient_id      INT UNSIGNED NOT NULL,
    generated_by    INT UNSIGNED NULL,
    summary         TEXT NOT NULL,
    risk_level      VARCHAR(30) NOT NULL,
    recommendations JSON NOT NULL,
    source          VARCHAR(50) NOT NULL DEFAULT 'rules',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ct_insight_patient FOREIGN KEY (patient_id) REFERENCES caretrack_patients (id) ON DELETE CASCADE,
    CONSTRAINT fk_ct_insight_user FOREIGN KEY (generated_by) REFERENCES caretrack_users (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS caretrack_reports (
    id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    patient_id     INT UNSIGNED NULL,
    generated_by   INT UNSIGNED NULL,
    period         VARCHAR(50) NOT NULL,
    range_start    DATE NOT NULL,
    range_end      DATE NOT NULL,
    adherence_rate INT NOT NULL DEFAULT 0,
    summary        TEXT NOT NULL,
    report_data    JSON NOT NULL,
    created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ct_report_patient FOREIGN KEY (patient_id) REFERENCES caretrack_patients (id) ON DELETE SET NULL,
    CONSTRAINT fk_ct_report_user FOREIGN KEY (generated_by) REFERENCES caretrack_users (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS caretrack_report_schedules (
    id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    created_by INT UNSIGNED NOT NULL,
    patient_id INT UNSIGNED NULL,
    cadence    VARCHAR(50) NOT NULL,
    next_run_at DATETIME NOT NULL,
    active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ct_report_schedule_user FOREIGN KEY (created_by) REFERENCES caretrack_users (id) ON DELETE CASCADE,
    CONSTRAINT fk_ct_report_schedule_patient FOREIGN KEY (patient_id) REFERENCES caretrack_patients (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS caretrack_otp_challenges (
    id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    token_hash     VARCHAR(128) NOT NULL UNIQUE,
    user_id        INT UNSIGNED NOT NULL,
    code_hash      VARCHAR(255) NULL,
    channel        VARCHAR(30) NULL,
    code_expires_at DATETIME NULL,
    last_sent_at   DATETIME NULL,
    attempts       INT NOT NULL DEFAULT 0,
    expires_at     DATETIME NOT NULL,
    consumed_at    DATETIME NULL,
    created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ct_otp_user FOREIGN KEY (user_id) REFERENCES caretrack_users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS caretrack_messages (
    id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    patient_id INT UNSIGNED NOT NULL,
    sender_id  INT UNSIGNED NULL,
    body       TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ct_message_patient FOREIGN KEY (patient_id) REFERENCES caretrack_patients (id) ON DELETE CASCADE,
    CONSTRAINT fk_ct_message_sender FOREIGN KEY (sender_id) REFERENCES caretrack_users (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS caretrack_message_reads (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id     INT UNSIGNED NOT NULL,
    patient_id  INT UNSIGNED NOT NULL,
    last_read_at DATETIME NOT NULL,
    UNIQUE KEY caretrack_message_read_unique (user_id, patient_id),
    CONSTRAINT fk_ct_read_user FOREIGN KEY (user_id) REFERENCES caretrack_users (id) ON DELETE CASCADE,
    CONSTRAINT fk_ct_read_patient FOREIGN KEY (patient_id) REFERENCES caretrack_patients (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS caretrack_provider_coverage (
    id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    absent_provider_id  INT UNSIGNED NOT NULL,
    covering_provider_id INT UNSIGNED NOT NULL,
    start_date          DATE NOT NULL,
    end_date            DATE NULL,
    reason              TEXT NULL,
    created_by          INT UNSIGNED NULL,
    ended_at            DATETIME NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ct_coverage_absent FOREIGN KEY (absent_provider_id) REFERENCES caretrack_users (id) ON DELETE CASCADE,
    CONSTRAINT fk_ct_coverage_covering FOREIGN KEY (covering_provider_id) REFERENCES caretrack_users (id) ON DELETE CASCADE,
    CONSTRAINT fk_ct_coverage_creator FOREIGN KEY (created_by) REFERENCES caretrack_users (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS caretrack_model_runs (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    algorithm           VARCHAR(100) NOT NULL,
    trees               INT NOT NULL,
    max_depth           INT NOT NULL,
    samples             INT NOT NULL,
    class_distribution  JSON NOT NULL,
    oob_accuracy        FLOAT NULL,
    feature_importance  JSON NOT NULL,
    trained_by          INT UNSIGNED NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ct_model_user FOREIGN KEY (trained_by) REFERENCES caretrack_users (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS caretrack_risk_predictions (
    id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    patient_id     INT UNSIGNED NOT NULL,
    model_run_id   INT UNSIGNED NULL,
    risk_level     VARCHAR(30) NOT NULL,
    risk_score     INT NOT NULL,
    prob_low       FLOAT NOT NULL,
    prob_moderate  FLOAT NOT NULL,
    prob_high      FLOAT NOT NULL,
    features       JSON NOT NULL,
    factors        JSON NOT NULL,
    created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ct_risk_patient FOREIGN KEY (patient_id) REFERENCES caretrack_patients (id) ON DELETE CASCADE,
    CONSTRAINT fk_ct_risk_model FOREIGN KEY (model_run_id) REFERENCES caretrack_model_runs (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS caretrack_lab_results (
    id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    patient_id     INT UNSIGNED NOT NULL,
    uploaded_by    INT UNSIGNED NULL,
    category       VARCHAR(50) NOT NULL DEFAULT 'lab',
    title          VARCHAR(255) NOT NULL,
    file_name      VARCHAR(255) NOT NULL,
    mime_type      VARCHAR(100) NOT NULL,
    size_bytes     INT NOT NULL,
    encrypted_data LONGTEXT NOT NULL,
    notes          TEXT NULL,
    review_comment TEXT NULL,
    reviewed_by    INT UNSIGNED NULL,
    reviewed_at    DATETIME NULL,
    created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ct_lab_patient FOREIGN KEY (patient_id) REFERENCES caretrack_patients (id) ON DELETE CASCADE,
    CONSTRAINT fk_ct_lab_uploader FOREIGN KEY (uploaded_by) REFERENCES caretrack_users (id) ON DELETE SET NULL,
    CONSTRAINT fk_ct_lab_reviewer FOREIGN KEY (reviewed_by) REFERENCES caretrack_users (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS caretrack_appointments (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    patient_id      INT UNSIGNED NOT NULL,
    provider_id     INT UNSIGNED NULL,
    scheduled_at    DATETIME NOT NULL,
    reason          VARCHAR(255) NOT NULL,
    status          VARCHAR(50) NOT NULL DEFAULT 'scheduled',
    notes           TEXT NULL,
    reminder_sent_at DATETIME NULL,
    created_by      INT UNSIGNED NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ct_appointment_patient FOREIGN KEY (patient_id) REFERENCES caretrack_patients (id) ON DELETE CASCADE,
    CONSTRAINT fk_ct_appointment_provider FOREIGN KEY (provider_id) REFERENCES caretrack_users (id) ON DELETE SET NULL,
    CONSTRAINT fk_ct_appointment_creator FOREIGN KEY (created_by) REFERENCES caretrack_users (id) ON DELETE SET NULL
) ENGINE=InnoDB;