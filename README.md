# CareTrack

**An AI-assisted patient-care platform for medication adherence tracking, health monitoring, and care-team reporting.**

CareTrack helps patients, caregivers, and doctors coordinate medication schedules and follow-up. It records scheduled doses and health observations, highlights adherence and health concerns, provides guarded AI decision support, and generates downloadable reports. It is a demonstration and care-coordination aid, not a medical device or a substitute for clinical judgment.

## What is new

The recent implementation work extended the original adherence tracker with health-aware risk prediction and reports, patient health recording, caregiver recording permissions, guarded chatbot answers, mobile/offline support, and authenticated live updates. The feature walkthrough below explains the user experience and the data flow; the change log records the corresponding implementation areas and how to demonstrate them.

## Technology and architecture

| Layer | Technology |
|---|---|
| Web app | React 19, Vite, Tailwind CSS, Recharts, TanStack Query, Wouter |
| API | Node.js, Express 5, TypeScript |
| Database | PostgreSQL (Supabase) with Drizzle ORM |
| Authentication | HTTP-only session cookies, bcrypt password hashes, role and patient-access checks |
| AI | Custom TypeScript Random Forest, optional Anthropic Claude insights, optional Groq chatbot |
| Reports | PDFKit PDF and CSV export |
| API contract | OpenAPI 3.1, generated React Query client and Zod validators (Orval) |
| Offline support | Installable PWA, service worker, IndexedDB schedule cache and offline dose queue |

```text
artifacts/
  api-server/
    src/routes/        Express endpoints, including clinical, health, AI,
                       messaging, notification and report routes
    src/lib/           Authentication, access control, scheduler, analytics,
                       audit, AI, encryption and report services
    scripts/seed.mjs   Fictional demo data
  caretrack/
    src/App.tsx        React app, pages and user flows
    public/sw.js       PWA service worker and offline reminder support
lib/
  db/                  Drizzle schema and PostgreSQL connection
  api-spec/            OpenAPI contract and code generation config
  api-client-react/    Generated React Query hooks
  api-zod/             Generated request/response validators
docs/
  ALIGNMENT.md         Requirement status, evidence plan and paper notes
  evidence/            Manual offline/realtime test steps
```

## Setup

**Requirements:** Node.js 22+ and pnpm 10+.

1. Install dependencies:
   ```bash
   pnpm install
   ```
2. Copy `.env.example` to `.env`. Set `DATABASE_URL` to the Supabase **Session pooler** connection string and set `SESSION_SECRET` to a long random value. The direct `db.<ref>.supabase.co` host may require IPv6.
3. Create/update the database schema and seed demo records:
   ```bash
   pnpm db:push
   pnpm db:seed
   ```
   The seed contains fictional patients and demo accounts. It is safe to rerun for a demo reset.
4. Start the API and web app:
   ```bash
   pnpm dev
   ```
   Open http://localhost:5173. The API listens on port 8080 by default; Vite forwards `/api` requests.

### Environment variables

| Variable | Required | Purpose |
|---|---:|---|
| `DATABASE_URL` | Yes | PostgreSQL/Supabase connection string |
| `SESSION_SECRET` | Yes | Secret used by session authentication |
| `PORT`, `WEB_PORT` | No | API and web development ports (8080 and 5173 by default) |
| `ANTHROPIC_API_KEY` | No | Enables Claude-generated insights; rule-based insights remain available without it |
| `GROQ_API_KEY`, `GROQ_MODEL` | No | Enables guarded Groq chatbot replies; model defaults to `llama-3.3-70b-versatile` |
| `OTP_ENABLED` | No | Enables the second login step; enabled in the example configuration |
| `OTP_OFFLINE_FALLBACK` | No | Shows a code in the local demo if delivery is unavailable; disable for production. Production defaults to disabled. |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | No | Gmail app-password delivery for login codes |
| `SMS_PROVIDER` | No | `semaphore`, `twilio`, or `android-gateway` SMS delivery |
| `SEMAPHORE_*`, `TWILIO_*` | No | Credentials and sender details for the selected SMS provider |
| `SMS_GATEWAY_URL`, `SMS_GATEWAY_USER`, `SMS_GATEWAY_PASSWORD` | No | Optional Android SMS Gateway on the same local network |

Never put API keys, app passwords, session secrets, or real patient information in source control. Configure real recipient contact details before testing live OTP delivery; seeded demo addresses and phone numbers are fictional.

### Production

```bash
pnpm build
pnpm start
```

The production server listens on `PORT` (8080 by default) and serves the API and built web app. Configure HTTPS at the hosting/reverse-proxy layer. Database availability, backups, and service uptime depend on the selected hosting providers.

## Demo accounts

All demo accounts use **`caretrack-demo`** as their initial password. New users must change temporary passwords when prompted. Patient and caregiver accounts are blocked on desktop browsers: use a physical phone, Android emulator, or browser device emulation for the defense demonstration. Keep this policy enabled in production.

| Role | Email | Demo scope |
|---|---|---|
| Admin | `admin@caretrack.demo` | User/team management, all patients, audit activity |
| Doctor | `provider@caretrack.demo` | Dr. Mira Santos and five assigned patients |
| Doctor | `doctor2@caretrack.demo` | Dr. Joel Reyes and five assigned patients; also covers Dr. Mira Santos's patients in the seed |
| Patient | `patient@caretrack.demo` | Alex Morgan's own schedule and health/adherence views; mobile browser only |
| Caregiver | `caregiver@caretrack.demo` | Jordan Morgan's linked-patient support; mobile browser only |

The database/API retains the internal role identifier `provider` for doctors. Product-facing roles are Admin, Doctor, Patient, and Caregiver.

## Feature walkthrough: what users can do and how it works

### Accounts, privacy, and permissions

- Users sign in with a password and, when OTP is enabled, verify a 6-digit one-time code by SMS or email. Codes expire, attempts are limited, and a resend cooldown applies.
- The admin can create, edit, deactivate, and reset team accounts. Temporary passwords must be changed at first use. Users can change their password from My account; password changes invalidate other sessions.
- A versioned privacy-consent record is required before protected application APIs are available.
- The interface is role-specific, but authorization is also enforced on the API. Doctors see assigned or covered patients, caregivers see linked patients, and patients see their own records. Caregivers can record supported patient doses and health observations but cannot edit medication/profile data or send messages.

### Patient records and clinical workflow

- Doctors and admins can manage patient profiles and provider assignments. Doctor coverage grants temporary access to another doctor's caseload for a date range; patients return to their original assignment when coverage ends.
- A dated medical-history API supports patient entries and doctor review/editing. Consultation records can capture a complaint, assessment, notes, follow-up, and optional check-up link.
- A doctor can create a prescription from a consultation. The API creates the medication and dose schedule and notifies the patient with the instructions. The patient prescription view also displays the medication instructions.
- Clinical history and medication edits/deletes have soft-delete and before/after record-history support in implemented routes. Coverage is not yet universal across every clinical entity; see [Known limitations](#known-limitations).
- The Check-ups page supports appointments and reminders. Lab results and uploaded prescription documents are stored encrypted.

### Medication schedules, adherence, and reminders

- Medication schedules support daily, twice-daily, every-X-hours, and selected-day recurrence. Dose events are generated from active schedules.
- Patients can mark doses Taken, Missed, or Skipped. The log records scheduled time, confirmation time, and who logged it. The patient dashboard shows recent adherence, streaks, charts, and course progress.
- A background job runs approximately once per minute. It ensures today's dose events exist, sends due reminders, marks doses missed after the two-hour grace period, sends alerts, and processes due reports and appointment reminders. The Random Forest is retrained periodically in the background.
- The demo's **Mark a dose due now** and **Simulate 2 hours** controls let a doctor exercise reminders and missed-dose handling without waiting for the real schedule.
- A per-patient reminder-escalation settings table has safe defaults, but the staged repeat/caregiver/doctor escalation flow is not yet wired into the scheduler or UI. Do not treat configurable escalation as an available feature yet.

### Health observations and caregiver recording

- Patients, doctors, and linked caregivers can record supported health metrics and symptom observations. Configurable ranges identify out-of-range readings; critical readings can generate notifications.
- Health records are persistent and included in patient views and reports. Caregiver permissions are patient-scoped and do not grant medication or profile editing rights.

### Random Forest risk prediction and AI insights

CareTrack predicts the risk of poor adherence in the following seven days as low, moderate, or high. The in-repository TypeScript Random Forest uses rolling 14-day input windows, 7-day outcome labels, 60 CART trees, bootstrap samples, a square-root-sized random feature subset, Gini impurity, maximum depth 6, minimum leaf size 3, and probability averaging (soft voting). Its 15 features combine adherence, regimen/demographic signals, and recent health signals.

The displayed confidence is the highest class probability. It is not calibrated clinical certainty. Feature importance and patient deviations are used to explain top factors and suggest follow-up actions. The model retrains on a schedule and can also be retrained from the AI risk prediction page. Demo data and model output have not been clinically validated; no generalizable accuracy claim is made here.

Claude is optional for care insights and report narratives. The server sends anonymized counts/rates rather than names, contact details, or clinical free text; if Claude is unavailable, rule-based recommendations are used. AI views carry the disclaimer: *“AI suggestions support, not replace, clinical judgment.”*

### Ask CareTrack chatbot

The Ask CareTrack widget is for patient and caregiver accounts. Requests pass server-side checks in this order:

1. Emergency and crisis wording gets fixed safety guidance.
2. Requests for diagnosis, dose changes, injections, or prompt injection are refused with fixed safe responses.
3. Off-topic questions are declined before patient context is fetched.
4. Supported medication, appointment, adherence, and lab questions can use verified CareTrack records.
5. Eligible questions may use Groq. Generated output is checked for unsafe dose-change advice before returning to the client.

Groq is optional. When it is not configured, fails, or times out, built-in schedule, adherence, appointment, medication, and health-tip answers remain available. Chatbot use is audited. Medical content must be reviewed by a licensed clinician, and deployments should configure local emergency guidance.

### Secure messages and live updates

- Patients and doctors can exchange messages and view conversation history. Caregivers can read linked conversations but cannot send.
- Messages are encrypted at rest with AES-256-GCM. API access checks remain in force when messages are read or sent.
- An authenticated, role-scoped Server-Sent Events stream signals new messages and notifications to active clients. React Query polling remains a fallback if the stream disconnects.

### Offline PWA reminders and dose sync

- When online, the app caches upcoming schedule data in IndexedDB. Where browser and OS permissions permit, the service worker schedules Notifications API reminders; while the app is open, it can also show an in-app alarm/chime.
- Dose confirmations made offline are queued locally with their original timestamps. On reconnect, the app syncs the queue and reports offline, syncing, and synced states.
- The PWA is installable from a supported mobile browser, but closed-app notifications and alarms depend on browser, OS, power-saving, and permission settings. This is not a guarantee of native background execution.
- Step-by-step manual checks are in [Offline and real-time evidence](docs/evidence/OFFLINE_REALTIME_MANUAL.md).

### Analytics, reports, notifications, and audit

- The Doctor analytics dashboard filters by date, patient, and medication. It charts adherence trends and dose outcomes, compares medications, and flags low-adherence patients.
- Weekly and monthly reports can be generated for a patient or caseload; recurring schedules are processed by the background job. PDF and CSV downloads include dose/adherence information, health metric latest/average/out-of-range summaries, out-of-range readings, and (when available) AI risk, confidence, top factors, recommendations, and the AI disclaimer.
- CSV fields are escaped and protected against spreadsheet formula injection.
- The notification center shows dose, missed-dose, health, appointment, report, message, and AI-risk notifications. Audit activity records important account and clinical actions for admin review.

## Security notes

- Passwords use bcrypt; session identifiers are random and only their hashes are persisted. Cookies are HTTP-only and secure in production.
- Role checks and patient-scope checks run at the API boundary. Request bodies and parameters are validated with Zod types generated from the OpenAPI contract.
- Login, OTP, password change, and chatbot endpoints are rate limited. Helmet security headers and a Vite/PWA-compatible Content Security Policy are configured.
- The privacy-consent gate blocks application API use until the current consent version is accepted. Disable OTP offline fallback for production.
- Claude receives anonymized aggregates; Groq receives the guarded care-plan context and current question, not user names, contact details, or clinical free text.
- Message and laboratory-file content is encrypted at rest. CSV exports use formula-injection protection.
- Keep secrets in the ignored `.env` file. Use HTTPS between browsers, the API, and cloud services in deployment; this repository cannot guarantee hosting configuration.

## Change log: implemented additions

This log records additions reflected in the current source, not items that remain planned.

| Addition | Implementation areas | How to see it |
|---|---|---|
| Health metric and symptom recording, ranges, alerts, and seed records | `lib/db/src/schema/caretrack.ts`; `artifacts/api-server/src/routes/health.ts`; `artifacts/api-server/scripts/seed.mjs` | Open the Health page as Alex or a linked caregiver; record a reading and review its range/notification behavior. |
| Caregiver-scoped dose and health recording | `artifacts/api-server/src/routes/doses.ts`; `artifacts/api-server/src/lib/patient-access.ts` | Use the caregiver account on a mobile browser and log an allowed dose or health observation. |
| Guarded Groq chatbot and safe fallback | `artifacts/api-server/src/routes/care.ts`; `.env.example` | Ask CareTrack a supported question; try a restricted/off-topic question and compare the fixed response. |
| Health-informed Random Forest features and confidence | `artifacts/api-server/src/lib/ml/risk-model.ts`; `artifacts/api-server/src/routes/ai.ts`; generated API packages; `artifacts/caretrack/src/App.tsx` | Open AI risk prediction or a patient risk card and inspect confidence and top factors. |
| Health and AI evidence in PDF/CSV reports | `artifacts/api-server/src/lib/report-export.ts`; `artifacts/api-server/src/lib/report-service.ts`; seeded report data | Generate/download a weekly report for Alex and inspect health summaries, out-of-range readings, and AI fields where a prediction exists. |
| Authenticated near-real-time message/notification events | `artifacts/api-server/src/routes/events.ts`; `artifacts/api-server/src/lib/realtime.ts`; `artifacts/api-server/src/routes/messages.ts`; `artifacts/caretrack/src/App.tsx`; `lib/api-spec/openapi.yaml` | Send a message between authorized sessions; observe the recipient update without refreshing. Disconnect the stream to see polling fallback. |
| Offline schedule reminders and dose synchronization | `artifacts/caretrack/public/sw.js`; `artifacts/caretrack/src/App.tsx`; `docs/evidence/OFFLINE_REALTIME_MANUAL.md` | Follow the offline manual: cache the schedule, disconnect, log a dose, reconnect, and confirm the preserved timestamp syncs. |
| Medical-history, consultation, prescription, and record-history API routes | `artifacts/api-server/src/routes/clinical.ts`; `artifacts/api-server/src/routes/medications.ts`; `lib/db/src/schema/caretrack.ts` | Exercise documented authenticated routes with an assigned patient; inspect the record-history endpoint as a doctor/admin. Full UI/entity coverage remains incomplete. |
| Rate limits, privacy consent, security headers, and production-safe OTP behavior | `artifacts/api-server/src/lib/auth.ts`; middleware; `artifacts/api-server/src/lib/security.test.ts`; `.env.example` | Accept the privacy notice on first use; review response headers and rate-limit behavior in a local test deployment. |
| Future-date checks and mobile-only patient/caregiver policy | API date validation and authentication; `artifacts/caretrack/public/manifest.webmanifest` | Try a patient/caregiver session on a physical phone, Android emulator, or browser device emulation; desktop sign-in is intentionally rejected. |

## Already implemented (verified, not new in this change log)

| Capability | Where to verify |
|---|---|
| Password/session authentication and role-based API access | `artifacts/api-server/src/lib/auth.ts`; route middleware |
| Dose scheduling, adherence analytics, recurring reports, and notifications | `artifacts/api-server/src/lib/dose-scheduler.ts`; `artifacts/api-server/src/lib/analytics.ts`; `artifacts/api-server/src/lib/jobs.ts` |
| Audit event storage and route-level audit calls | `lib/db/src/schema/caretrack.ts`; `artifacts/api-server/src/lib/audit.ts` |
| AES-256-GCM encryption utilities and encrypted message/file storage | `artifacts/api-server/src/lib/encryption.ts`; message and laboratory routes |
| OpenAPI contract with generated client and validators | `lib/api-spec/openapi.yaml`; `lib/api-client-react/`; `lib/api-zod/` |
| PWA installation shell and responsive React interface | `artifacts/caretrack/public/manifest.webmanifest`; `artifacts/caretrack/src/` |

## Useful commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Run API and web app together |
| `pnpm db:push` | Apply Drizzle schema to PostgreSQL |
| `pnpm db:seed` | Load/reset fictional demo data |
| `pnpm typecheck` | Typecheck workspace packages |
| `pnpm test` | Run the automated tests |
| `pnpm build` | Typecheck, run tests, and build workspace packages |
| `pnpm start` | Start the production API/static app server |
| `pnpm --filter @workspace/api-spec run codegen` | Regenerate API clients/validators after an OpenAPI change |

## Requirements traceability

Statuses indicate implementation evidence in this repository; “Partial” means the full requirement or its deployment/evidence claim is not yet verified.

| ID | Paper requirement | Status | Where / evidence and remaining gap |
|---|---|---|---|
| FR1 | Users securely create and manage accounts according to role | Done (already existed) | Session authentication, account management, role-specific UI, and API authorization. |
| FR2 | Patients manage personal information, medical history, symptoms and laboratory results | Partial | Profiles, symptoms, labs, and dated medical-history API exist; end-to-end patient UI coverage needs verification. |
| FR3 | Doctors manage patient records and prescribed medications | Done (already existed) | Patient/medication routes, assignment/coverage checks, and clinical API. |
| FR4 | Doctors create and manage medication schedules | Done (already existed) | Medication schedules generate dose events; course and schedule UI is present. |
| FR5 | Automated and offline medication reminders based on schedule | Done (added by us) | Server reminders and missed-dose jobs plus PWA local reminders; closed-app delivery remains browser/OS-dependent. |
| FR6 | Record medication intake; identify missed or delayed doses | Done (already existed) | Time-stamped dose logging, auto-missed processing, adherence and course views. |
| FR7 | Patients record health metrics and health observations | Done (added by us) | Health/symptom routes, configurable ranges, seed data, and supported caregiver recording. |
| FR8 | Analyze adherence and health data using the Random Forest Classifier | Done (added by us) | 15-feature model includes recent health signals; clinical validation is not claimed. |
| FR9 | Generate patient risk predictions and adherence insights | Done (added by us) | Risk prediction, confidence, risk factors, and insight UI/API. |
| FR10 | AI-assisted patient care recommendations from analyzed data | Done (already existed) | Optional Claude insights and rule-based recommendations; AI remains decision support. |
| FR11 | AI chatbot for medication help and common health inquiries | Done (added by us) | Groq-backed, guarded chatbot with verified-data and built-in fallback. |
| FR12 | Secure doctor-patient messaging with chat history | Done (added by us) | Encrypted message storage, authenticated SSE updates, and polling fallback. |
| FR13 | Caregivers receive patient adherence and health alerts | Done (already existed) | Linked-caregiver notifications and patient-access checks; caregiver messaging stays read-only. |
| FR14 | Doctor dashboard: records, adherence, health metrics, AI insights | Done (added by us) | Doctor patient pages, analytics, health data, and risk/insight views. |
| FR15 | Data-driven adherence and health reports for doctor review | Done (added by us) | PDF/CSV exports include dose, health, and available AI evidence with CSV formula protection. |
| NFR1 | User-friendly, responsive interface for mobile and web users | Partial | Responsive PWA exists; full 360/390/430 px page checks and screenshot evidence are not recorded here. |
| NFR2 | Secure authentication, access control, encryption | Done (added by us) | Rate limits, consent gate, role/patient checks, secure sessions, encrypted content; deployment review remains necessary. |
| NFR3 | HTTPS between components and cloud services | Partial | Production is HTTPS-ready, but actual TLS configuration depends on deployment/hosting and must be checked there. |
| NFR4 | Role-based access for patients, doctors, caregivers, admins | Done (already existed) | API and UI access rules for all four product roles. |
| NFR5 | Reliable offline medication reminders without internet | Partial | Cached schedule, local reminders and in-app alarm work where supported; browser/OS cannot guarantee closed-app alarms. |
| NFR6 | Sync locally recorded data to the cloud when back online | Done (added by us) | Offline dose queue syncs with original confirmation timestamps; follow the manual evidence steps. |
| NFR7 | Doctor-patient messages in near real time | Done (added by us) | Authenticated SSE with polling fallback; caregiver send remains forbidden. |
| NFR8 | Chatbot responds only to medication, health-info, system questions | Done (already existed) | Topic/safety guards, fixed refusals, verified-data answers, and output filtering. |
| NFR9 | AI prediction results in under 10 seconds | Partial | Performance benchmark on larger generated data is not recorded; do not claim a verified threshold yet. |
| NFR10 | Data integrity; prevent unauthorized modification or deletion | Partial | Soft delete and before/after history exist for implemented routes, but policy/history coverage is not universal. |
| NFR11 | Logs of important user activities and system transactions | Done (already existed) | Audit log records important account, clinical, messaging, AI, and report actions. |
| NFR12 | At least 95% availability for cloud services | Partial | Availability depends on Supabase and application hosting; this repository cannot certify uptime or recovery targets. |

## Known limitations

- This is a responsive installable PWA, not a verified native Android APK. Patients and caregivers are blocked from desktop sign-in. Demonstrate on a physical phone, Android emulator, or browser device emulation; do not bypass the production policy.
- Local reminders and offline sync depend on browser support and permissions. Closed-app alarm delivery is not guaranteed by the PWA.
- Reminder escalation settings have database defaults, but the staged repeat/caregiver/doctor escalation is not implemented end to end.
- Medical-history, consultation, prescription, and record-history API/schema work exists, but UI integration and consistent history/soft-delete behavior across every clinical entity still need verification.
- Mobile usability evidence at every target width and a larger-data Random Forest performance benchmark have not been recorded.
- The Random Forest uses demonstration data and is not clinically validated. Confidence is the highest class probability, not calibrated clinical certainty.
- Claude/Groq content is decision support only. A licensed clinician must review real clinical content and recommendations.
- Caregivers can read messages but cannot send them. Two-way caregiver messaging is not supported.
- OTP/SMS delivery requires configured providers and valid recipient contact details. Availability, HTTPS, backups, and recovery depend on deployment infrastructure.

## Alignment verification and remaining work

The requirement-by-requirement status, evidence checklist, planning notes, and capstone paper corrections are maintained in [docs/ALIGNMENT.md](docs/ALIGNMENT.md).
