# CareTrack

**An AI-Driven Patient Care Platform for Medication Adherence Tracking and Data-Analytics-Based Automated Reporting**

CareTrack helps healthcare providers, patients, and caregivers stay on top of medication schedules. It tracks every scheduled dose, calculates adherence, flags patients who need support, generates AI-assisted insights, and produces automated PDF/CSV reports.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, Tailwind CSS, Recharts, TanStack Query, Wouter |
| Backend | Node.js, Express 5, TypeScript |
| Database | Local MySQL 8 with Drizzle ORM |
| Auth | Session cookies (HTTP-only), bcrypt password hashing, role-based access control |
| AI | Anthropic Claude API, with a rule-based fallback |
| Reports | PDFKit (PDF) and CSV export |
| API contract | OpenAPI 3.1 spec, with a generated React Query client and Zod validators (Orval) |

## Project structure

```
artifacts/
  api-server/          Express API
    src/routes/        HTTP endpoints (auth, users, patients, medications, doses,
                       analytics, insights, notifications, reports, admin)
    src/lib/           Business logic: auth, access control, dose scheduler,
                       analytics, AI insights, reports, PDF/CSV export, background jobs
    scripts/seed.mjs   Demo data seeder
  caretrack/           React web app (src/App.tsx holds the pages)
lib/
  db/                  Drizzle schema (src/schema/caretrack.ts) and DB connection
  api-spec/            OpenAPI spec (openapi.yaml) and code generation config
  api-client-react/    Generated React Query hooks
  api-zod/             Generated Zod request/response validators
```

## Setup

**Requirements:** Node.js 22+, pnpm 10+ (`npm install -g pnpm`), and MySQL 8.0+.

On Windows, make sure the MySQL service is running. If the service is named
`MySQL90`, open PowerShell as Administrator and run:

```powershell
Start-Service MySQL90
```

If you are using **Command Prompt (cmd.exe)** instead of PowerShell, run:

```cmd
net start MySQL90
```

If Command Prompt reports **System error 1058**, the service is disabled.
From an Administrator Command Prompt, enable it first:

```cmd
sc config MySQL90 start= auto
net start MySQL90
```

If the service is stopped, the app and seed command fail with
`ECONNREFUSED 127.0.0.1:3306`. Check the service status with:

```powershell
Get-Service MySQL90
```

The status must be `Running` before starting CareTrack.

If `mysql` is not recognized, use the full client path or add this directory
to your PATH:

```text
C:\Program Files\MySQL\MySQL Server 9.0\bin
```

1. **Install dependencies**
   ```bash
   pnpm install
   ```
2. **Configure the environment.** Copy `.env.example` to `.env` and replace the placeholders:
   - `DATABASE_URL`: use the MySQL username and password from your local installation, for example `mysql://root:YOUR_MYSQL_PASSWORD@127.0.0.1:3306/health_monitoring`.
   - `SESSION_SECRET`: any long random string.
   - `ANTHROPIC_API_KEY` *(optional)*: enables Claude-generated insights. Without it, CareTrack uses its rule-based engine.
3. **Create the MySQL database and tables.** Run this from **Command Prompt** so `<` is treated as input redirection:
   ```bash
   mysql -u root -p < database.sql
   ```
   On Windows, if `mysql` is not in PATH, run this from **Command Prompt**:
   ```cmd
   "C:\Program Files\MySQL\MySQL Server 9.0\bin\mysql.exe" -u root -p < database.sql
   ```
   Enter the MySQL root password when prompted. This password is created during MySQL installation; it is not defined by `database.sql` or `.env.example`.
   The SQL creates the `health_monitoring` database, loads the supplied clinical tables and seed data, and adds the `caretrack_*` compatibility tables required by the current API.
4. **Apply Drizzle schema updates when needed.** Run this only when the Drizzle schema changes; do not use it as a replacement for importing `database.sql`.
   ```bash
   pnpm db:push
   ```
5. **Load the demo data** after the database import:
   ```bash
   pnpm db:seed
   ```
   The seed command is intended for a newly imported database. It resets demo reports,
   insights, and notifications, but repeated runs may require cleaning or re-importing
   the database if duplicate medication records cause a foreign-key error.
6. **Start the app**
   ```bash
   pnpm dev
   ```
   Open **http://localhost:5173**. The API runs on port 8080, and Vite forwards `/api` requests to it.

### Windows run sequence

From the repository root, run these commands in order. Use an Administrator PowerShell
to start MySQL:

```powershell
cd "D:\My Files\Downloads\Caretrack\caretrack"
Start-Service MySQL90
```

Then open **Command Prompt**, import the database, and return to the repository root:

```cmd
cd /d "D:\My Files\Downloads\Caretrack\caretrack"
"C:\Program Files\MySQL\MySQL Server 9.0\bin\mysql.exe" -u root -p < database.sql
```

Finally, from the repository root, run:

```bash
pnpm db:seed
pnpm dev
```

Alternatively, run `net start MySQL90` from an Administrator Command Prompt. Update
`DATABASE_URL` in `.env` with the MySQL username and password used by your
local installation before running the seed command.

### Production

```bash
pnpm build      # typecheck, then build the API and the web app
pnpm start      # one server on PORT (default 8080) serves both the API and the web app
```

## Demo accounts

All demo accounts use the password **`caretrack-demo`**. The login page has quick-pick buttons for each one.

| Role | Email | Sees |
|---|---|---|
| Admin | admin@caretrack.demo | All patients, user management, audit log |
| Provider | provider@caretrack.demo | Dr. Mira Santos: 5 assigned patients |
| Provider | nurse@caretrack.demo | Nurse Joel Reyes: 5 assigned patients |
| Patient | patient@caretrack.demo | Alex Morgan: own schedule and stats |
| Caregiver | caregiver@caretrack.demo | Jordan Morgan: read-only view of Alex |

The seed data includes 10 fictional patients with adherence between 37% and 96% (so there are green, yellow, and red risk flags), 45 days of dose history, 7 pre-generated reports, 10 AI insights, and a weekly report schedule.

## Login codes (OTP)

After entering a correct password, users choose to receive a 6-digit code by **text message (SMS)** or **Gmail**. Each code expires after 5 minutes and allows 5 attempts, and a new code can be requested after 30 seconds.

- **Online:** set `GMAIL_USER` and `GMAIL_APP_PASSWORD` for email codes, and `SMS_PROVIDER` for text messages. The SMS options are Semaphore, Twilio, or the *SMS Gateway for Android* app. See *Setting up real Gmail and SMS* below.
- **Offline:** the Android gateway sends SMS from a phone on the same Wi-Fi network, so it works without internet. If nothing is configured, or sending fails, the login screen shows the code in a yellow **Offline mode** box. This keeps the demo working without any setup. Set `OTP_OFFLINE_FALLBACK=false` for a real deployment.
- Demo accounts have fictional mobile numbers (09170000001–05), so SMS codes will only arrive if you change a number to your own under **Team access**.

### Setting up real Gmail and SMS

After changing `.env`, restart the server. Then go to **Team access > Login code delivery** and click **Send test** to confirm it works.

**Gmail**
1. Turn on 2-Step Verification for the Gmail account that will send the codes (Google Account > Security).
2. Go to https://myaccount.google.com/apppasswords, create an app password named "CareTrack", and copy the 16-character code.
3. In `.env`, set `GMAIL_USER=yourname@gmail.com` and `GMAIL_APP_PASSWORD=` followed by the 16-character code with no spaces.
4. Give each user a real email address under **Team access > Edit**. Codes can't reach the `@caretrack.demo` addresses.

**SMS: choose one**
- **SMS Gateway for Android (free, works offline over Wi-Fi):** install *SMS Gateway for Android* from the Play Store on a phone with load, and turn on its **Local server**. In `.env`, set `SMS_PROVIDER=android-gateway`, `SMS_GATEWAY_URL=http://<phone-ip>:8080`, and `SMS_GATEWAY_USER` / `SMS_GATEWAY_PASSWORD` to the values shown in the app. The phone and the computer must be on the same Wi-Fi network.
- **Semaphore (Philippines, paid credits):** create an account at semaphore.co. In `.env`, set `SMS_PROVIDER=semaphore` and `SEMAPHORE_API_KEY`.
- **Twilio (international, free trial):** in `.env`, set `SMS_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER`.

Then put real mobile numbers on the accounts under **Team access > Edit**.

When everything works, set `OTP_OFFLINE_FALLBACK=false` so codes are never shown on screen.

## Accounts and passwords

- The admin creates doctor accounts under **Team access > Add doctor**. A strong temporary password is generated automatically, and the eye button shows it. After saving, the screen displays the sign-in details to share with the doctor.
- At first sign-in, a new user must create their own password before they can use the app. The server blocks every other page until they do.
- Every user can change their password anytime under **My account**. Doing so signs out their other devices.
- An admin can reset a forgotten password from **Team access > Edit**. The user then gets another temporary password and must change it at next sign-in.
- All password fields have a show/hide (eye) button.

## Features (defense walkthrough)

1. **Authentication and access control.** Log in as each role and notice that the sidebar changes by role. The backend enforces the same rules: a provider calling `/api/users` gets a 403 error. Passwords are hashed with bcrypt, and sessions use HTTP-only cookies.
2. **User management (Admin > Team access).** Create, edit, and deactivate users. Deactivated users can no longer sign in.
3. **Audit log (Admin > Audit activity).** Records logins, logouts, logged doses, generated and downloaded reports, and changes to patients and medications.
4. **Patient management (Provider > Patients).** Add and edit patient profiles (age, sex, contact details, conditions, allergies) and assign them to providers. The patient detail page shows medications, adherence history, notes, and AI insights.
5. **Medication management.** Medications support daily, twice-daily, every-X-hours, and specific-day schedules. Dose events are generated automatically from the schedule.
6. **Adherence tracking (Patient > Today's doses).** Patients mark each dose as Taken, Missed, or Skipped, with timestamps. They also see their 30-day adherence rate, current streak, a 7-day chart, and a 4-week history.
7. **Reminders and missed doses.** Background jobs run every minute:
   - When a dose comes due, the patient and caregiver get a **"Dose due now"** notification.
   - Doses not logged within **2 hours** are automatically marked **Missed**, and an alert is sent.
   - If a patient's adherence over the last 7 days drops below 50%, their providers get a **risk alert**.
8. **Live demo tools (Provider > Overview):**
   - **Mark a dose due now:** creates a dose for Alex Morgan due immediately. Sign in as the patient or caregiver to see the reminder.
   - **Simulate 2 hours:** moves due doses past the grace period. They are marked missed, and alerts are sent.
9. **Analytics dashboard (Provider > Analytics).** Filter by date range, patient, and medication. Charts include an adherence trend line (with 80% and 50% guide lines), a taken/missed/skipped donut chart, adherence by medication (colored by risk flag), and missed doses by time of day. A risk-flag table lists patients from lowest to highest adherence: Green ≥80%, Yellow 50–79%, Red <50%.
10. **AI insights.** Generate an insight from the patient detail page, or from the patient's own dashboard to get friendly tips. Only anonymized counts and rates are sent to Claude. If the API key is missing or the call fails, CareTrack falls back to rule-based insights. Every AI view shows the disclaimer: *"AI suggestions support, not replace, clinical judgment."*
11. **Automated reports (Reports).** Generate weekly or monthly reports, either for one patient or for a whole caseload. You can also create recurring schedules, which the background job runs automatically. Download reports as a **PDF** (patient info, risk flag, trend chart, medication list, adherence by medication, missed-dose summary, narrative, recommendations) or as **CSV** (raw dose log). Past reports stay in the report history.
12. **Notification center.** The bell icon shows a badge with the unread count, and the list refreshes every 30 seconds.
13. **Medication course progress.** Each medication shows its course progress (for example, "Day 5 of 7") and a segmented dose bar: green for taken, red for missed, gray for skipped, and pulsing yellow for doses that are due but not checked yet. A traffic-light indicator summarizes it: green ≥80%, yellow 50–79% (or a dose waiting to be checked), and red below 50%. Doses left unchecked trigger a reminder and become missed after 2 hours. The seed data includes 7-day courses for Alex Morgan, Priya Nair, and Mateo Cruz.
14. **Add another course.** On a patient's profile, **Add new course** starts another medication course for the same patient. Pick a course length (3–30 days) to get a day-by-day progress bar.
15. **Patient status filter (Patients).** Filter the patient list by **Critical** (red), **Needs attention** (yellow), **Stable** (green), or **No data**, alongside the text search. Every patient card shows a status badge.
16. **Doctor coverage (Doctor coverage).** When a doctor is absent, the admin (or the doctor) hands their patients to a colleague for a date range. While coverage is active, the covering doctor:
    - sees those patients, marked "Covering: …"
    - can manage their medications
    - receives their risk alerts and messages

    When coverage ends, the patients return to their original doctor automatically. To move a patient permanently, use **Edit profile > Assigned doctor**. *Sample data: Dr. Mira Santos is away for 3 days, and Nurse Joel Reyes covers her 5 patients. Sign in as nurse@caretrack.demo to see all 10.*
17. **Doctor–patient messages (Messages).** Patients message their care team, and providers reply from a list of conversations with unread badges. Each new message notifies the other side. Caregivers can read the conversation but not send messages.

## AI component: Random Forest health-risk prediction

CareTrack predicts each patient's **risk of poor medication adherence in the next 7 days** (low / moderate / high) with a **Random Forest classifier**. The model is written from scratch in `artifacts/api-server/src/lib/ml/`, so every step can be explained.

| Step | What happens |
|---|---|
| 1. Data | Each patient's historical dose logs: scheduled time, taken time, and status (taken, missed, skipped). |
| 2. Parameters (12 features, from the last 14 days) | 14-day adherence, 7-day adherence, weekly trend, missed-dose streak, evening miss rate, morning miss rate, late-dose rate (more than 1 hour late), skip rate, doses per day, number of active medications, age, number of conditions |
| 3. Labels | What actually happened in the following 7 days: **low** ≥80% taken, **moderate** 50–79%, **high** <50%. One training example is built per patient per day (sliding window). |
| 4. Training | 60 CART decision trees. Each tree uses a bootstrap sample, √12 random features per split, Gini impurity, max depth 6, and at least 3 samples per leaf. |
| 5. Prediction | Soft voting: the class probabilities are averaged over all trees. Risk score = P(high) + ½·P(moderate). |
| 6. Evaluation | **Out-of-bag accuracy**: each tree is tested on the samples it never saw. On the demo data this is about 87%. |
| 7. Explainability | **Feature importance** is the mean decrease in Gini impurity. Each patient's **top risk factors** are weighted by importance × deviation from the typical patient. |
| 8. Decision support | Care-team recommendations, patient tasks and health tips. Doctors get an **AI risk alert** when a patient becomes high-risk. |

The model retrains automatically every 6 hours, and on demand from **AI risk prediction → Retrain model now**. AI suggestions support, not replace, clinical judgment.

## Panel recommendations implemented

| Recommendation | Where it is in the system |
|---|---|
| Specific AI/ML algorithm (Random Forest), health-risk prediction, patient parameters and historical data | **AI risk prediction** page; **AI risk** card on each patient |
| Predictive risk alerts for critical patients | Notification "AI risk alert: …" sent to the doctor (and any covering doctor) |
| Decision-making support, patient care recommendations, tasks, health tips | Recommended actions on the AI risk card; **My care plan** on the patient's Today page |
| Chatbot that only answers relevant questions | **Ask CareTrack** assistant: a topic guard declines off-topic questions, and urgent symptoms get emergency advice |
| Messages and data encrypted (Data Privacy Act, RA 10173) | AES-256-GCM encryption at rest for messages and lab files; HTTPS-ready; passwords hashed with bcrypt |
| Patient can upload laboratory results | **Lab results** panel: PDF/photo up to 5 MB, encrypted; the doctor reviews and comments |
| Follow-up / check-up | **Check-ups** page and patient-profile panel, with a reminder 1 day before |
| Distinguish the user action | Each dose shows **who logged it** (patient, caregiver, doctor, or system auto-miss), plus TAKEN LATE |
| Notification with sound, not annoying | Soft chime at most once a minute, mute toggle, quiet hours 10 PM–7 AM, optional pop-up alerts |
| SMS for patients without internet | SMS dose reminders and missed-dose alerts when an SMS provider is set |
| Fail-safe when the internet is down; offline monitoring | Offline mode: cached pages and data, and doses logged offline sync automatically with their real time |
| All functionality recorded in system logs | Audit log covers logins, doses, messages, lab files, AI training, assistant use, coverage, check-ups and reports |

## Security notes

- All database access goes through Drizzle's parameterized queries, so it is protected against SQL injection.
- Every request body and parameter is validated with Zod schemas generated from the OpenAPI spec.
- Users can only see patients they are linked to: providers see assigned patients, caregivers see linked patients, and patients see only themselves. This check runs on every endpoint.
- Session tokens are random 256-bit values, and only their hashes are stored in the database.
- Cookies are `secure` when the app runs over HTTPS.
- CSV exports are protected against spreadsheet formula injection.
- Secrets are kept in `.env`, which git ignores.

## Useful commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Run the API and the web app together |
| `mysql -u root -p < database.sql` | Create or initialize the local MySQL database |
| `pnpm db:push` | Apply Drizzle schema changes to the MySQL database |
| `pnpm db:seed` | Load or reset the demo data |
| `pnpm typecheck` | Typecheck every package |
| `pnpm --filter @workspace/api-spec run codegen` | Regenerate the API client and validators after editing `openapi.yaml` |
