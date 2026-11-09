# Alignment verification and remaining work

This document separates verified implementation behavior from requirements that still need implementation, UI integration, or deployment evidence. The canonical FR/NFR statuses are in the [README traceability table](../README.md#requirements-traceability).

## Current gaps and evidence

| Area | Status | Verification needed |
|---|---|---|
| Reminder escalation | Partial | Settings have safe database defaults, but repeated reminders and caregiver/doctor escalation stages are not connected to the minute scheduler or demonstrated in the UI. Implement/test before describing it as active. |
| Clinical history and data integrity | Partial | Medical-history/consultation/prescription endpoints and history records exist. Verify frontend integration and apply consistent soft delete/history/authorization to every clinical entity before claiming complete coverage. |
| Offline reminders | Partial | Cached schedules, local notifications, open-app alarm, and queued dose sync are present. Test on supported physical devices; record that closed-app reminders are browser/OS-limited. |
| Mobile layout | Partial | Record 360, 390, and 430 px checks for all patient/caregiver screens. Save screenshots in `docs/evidence/mobile/` once actual checks have been done; no screenshots or results should be fabricated. |
| Test coverage | Partial | `pnpm test` exists, but the current small suite is not the full planned matrix for RBAC, scheduler, reports, data integrity, and chatbot guards. Expand tests and record real output. |
| Prediction performance | Partial | Run a reproducible training/prediction benchmark on seed and larger generated datasets. Record sample counts, OOB accuracy, confidence, and elapsed time before making the under-10-second claim. |
| HTTPS and availability | Deployment-dependent | Verify TLS, database connectivity/reconnect, backups, monitoring, and uptime with the actual hosting configuration. Source code alone cannot establish 95% service availability. |

### Suggested defense evidence

Run these checks and record their actual output and environment:

1. `pnpm typecheck`, `pnpm test`, and `pnpm build`.
2. Apply schema and seed to a fresh test database with `pnpm db:push` and `pnpm db:seed`.
3. Exercise all four roles, assigned/covered/linked patient scopes, and caregiver read-only messaging.
4. Verify due reminders, two-hour auto-miss, offline queue timestamp preservation, SSE message delivery, and polling fallback.
5. Generate a weekly patient report and inspect health summary, out-of-range readings, AI evidence, and CSV formula protection.
6. Exercise chatbot emergency/crisis, dose-change, injection, prompt-injection, off-topic, and supported-data questions.
7. Benchmark Random Forest training and prediction on seed data and a larger generated dataset.
8. Test patient/caregiver mobile screens at 360, 390, and 430 px and record device/browser details.
9. Verify TLS, production cookie attributes, OTP behavior, hosting recovery, and availability with deployment-specific evidence.

Manual offline and SSE steps are maintained in [OFFLINE_REALTIME_MANUAL.md](evidence/OFFLINE_REALTIME_MANUAL.md).

## Planning estimates

The following are rough planning estimates copied from the original implementation brief; they are not current commitments or fresh estimates.

| Remaining area | Original estimate |
|---|---:|
| Reminder escalation | 2–3 days |
| Complete record history/soft delete coverage | 3–5 days |
| Clinical history and prescription UI integration | 2–6 days |
| Offline reminders/device verification | 3–4 days |
| Security/privacy review and test expansion | 3–7 days |
| Mobile layout fixes and evidence | 3–5 days |
| Performance and recovery evidence | 1–3 days |

## Capstone paper alignment edits

Use the following corrections when updating the paper. These notes describe the verified web/PWA implementation, not a native application or clinical validation.

### Technology stack

Update the Introduction, Background, Scope and Limitations, Technical Background, Software and Hardware sections, and Figures 1.1 and 3.1 to name the implemented technologies: React 19, Vite, Tailwind CSS, Node.js/Express 5, TypeScript, PostgreSQL on Supabase with Drizzle ORM, a custom TypeScript Random Forest, optional Claude insights, and optional Groq chatbot replies. Remove descriptions of Flutter/Dart, Firebase, or a Python model unless they refer only to prior/proposed work.

Suggested text:

> CareTrack is implemented as a React 19 and TypeScript web application built with Vite. Its Express 5 API runs on Node.js and stores application data in PostgreSQL through Supabase and Drizzle ORM. A custom TypeScript Random Forest estimates medication-adherence risk. Optional Claude and Groq integrations provide guarded insights and chatbot replies, with deterministic fallbacks when external AI services are unavailable.

### Mobile delivery and user roles

Update platform descriptions and figures to identify the patient/caregiver product as a responsive installable PWA. It is not a verified native Android APK. Patient and caregiver desktop sign-in is blocked; use a physical phone, Android emulator, or browser device emulation for demonstrations. Use the visible role names **Admin, Doctor, Patient, and Caregiver** throughout the paper. The database/API may retain the internal role identifier `provider`; visible interface labels should say Doctor.

Suggested text:

> Patients and caregivers use CareTrack through a responsive installable progressive web application in a supported mobile browser. The current delivery does not include a verified native Android APK. Browser and operating-system policies affect offline and closed-app notifications.

### Functional additions and architecture figures

Update the feature list and redraw the ERD from `lib/db/src/schema/caretrack.ts`, including health metrics, symptoms, medical history, consultations, prescriptions, record history, consent, and relevant relationships. Update the DFD to include the actual API, PostgreSQL, optional AI providers, OTP delivery, messaging, and offline synchronization flows. Correct the DFD numbering jump from 7.0 to 9.0. Distinguish Figures 1.1 and 1.2 with accurate, different captions; both should not be called “Conceptual Framework.”

Mention the implemented OTP delivery options (SMS and email), temporary doctor coverage, check-ups, medication-course progress, health observations, optional Claude/Groq features, caregiver health recording, privacy consent, and authenticated near-real-time message/notification updates. Describe reminder escalation only as planned until scheduler/UI stages are implemented.

### Offline behavior

Suggested text:

> The PWA caches upcoming dose schedules and can show reminders from local data where browser notifications are supported and permitted. Dose confirmations made offline are queued with their original timestamps and synchronized when connectivity returns. Background and closed-app notification delivery depends on the browser, device, and operating-system settings and is not guaranteed.

### Machine-learning methodology and limitations

Describe the implementation as a 15-feature TypeScript Random Forest using 14-day feature windows and labels from the following seven days, 60 CART trees, bootstrap sampling, a square-root feature subset at each split, Gini impurity, maximum depth 6, minimum leaf size 3, soft voting, and out-of-bag evaluation. Confidence is the maximum class probability and is not calibrated. Report measured OOB accuracy and inference time only after recording the dataset and benchmark procedure; demo data does not establish clinical validity.

Suggested limitation:

> Model outputs are based on demonstration data and have not been clinically validated. The confidence value is the highest predicted class probability, not calibrated clinical certainty. AI output supports, but does not replace, licensed clinical assessment.
