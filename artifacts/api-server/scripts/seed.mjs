import bcrypt from "bcryptjs";
import pg from "pg";

const { Pool } = pg;
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to seed CareTrack.");
}

// Hosted databases such as Supabase require TLS; local Postgres usually does not.
const isLocal = /@(localhost|127\.0\.0\.1)(:|\/)/.test(process.env.DATABASE_URL);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});
const client = await pool.connect();

// Every demo account uses the same password so the login page quick-pick buttons work.
const DEMO_PASSWORD = "caretrack-demo";

const demoUsers = [
  { key: "admin", name: "Carla Mendoza", email: "admin@caretrack.demo", role: "admin", phone: "09170000001" },
  { key: "provider1", name: "Dr. Mira Santos", email: "provider@caretrack.demo", role: "provider", phone: "09170000002" },
  { key: "provider2", name: "Dr. Joel Reyes", email: "doctor2@caretrack.demo", role: "provider", phone: "09170000003" },
  { key: "patient", name: "Alex Morgan", email: "patient@caretrack.demo", role: "patient", phone: "09170000004" },
  { key: "caregiver", name: "Jordan Morgan", email: "caregiver@caretrack.demo", role: "caregiver", phone: "09170000005" },
];

const patientSeed = [
  ["Alex Morgan", 58, "male", ["Hypertension"], ["Penicillin"], 0.96],
  ["Sofia Rivera", 64, "female", ["Type 2 diabetes"], [], 0.91],
  ["Noah Kim", 72, "male", ["High cholesterol"], ["Sulfa"], 0.86],
  ["Lena Patel", 49, "female", ["Hypertension", "Migraine"], [], 0.82],
  ["Ethan Brooks", 67, "male", ["Type 2 diabetes"], [], 0.77],
  ["Amara Johnson", 55, "female", ["High cholesterol"], ["Latex"], 0.71],
  ["Mateo Cruz", 76, "male", ["Hypertension"], [], 0.66],
  ["Nina Chen", 61, "female", ["Anxiety"], [], 0.58],
  ["Caleb Davis", 70, "male", ["Type 2 diabetes", "Hypertension"], [], 0.48],
  ["Priya Nair", 53, "female", ["Reflux"], ["Ibuprofen"], 0.37],
];

const medicationTemplates = [
  { name: "Lisinopril", dosage: "10 mg", form: "Tablet", frequency: "daily", times: ["08:00"], instructions: "Take with water." },
  { name: "Metformin", dosage: "500 mg", form: "Tablet", frequency: "daily", times: ["08:00", "20:00"], instructions: "Take with meals." },
  { name: "Atorvastatin", dosage: "20 mg", form: "Tablet", frequency: "daily", times: ["20:00"], instructions: "Take in the evening." },
  { name: "Amlodipine", dosage: "5 mg", form: "Tablet", frequency: "daily", times: ["08:00"], instructions: "Take at the same time each day." },
  { name: "Losartan", dosage: "50 mg", form: "Tablet", frequency: "daily", times: ["08:00"], instructions: "Take with water." },
  { name: "Vitamin D3", dosage: "1,000 IU", form: "Capsule", frequency: "daily", times: ["08:00"], instructions: "Take with breakfast." },
  { name: "Sertraline", dosage: "50 mg", form: "Tablet", frequency: "daily", times: ["08:00"], instructions: "Take once daily." },
  { name: "Omeprazole", dosage: "20 mg", form: "Capsule", frequency: "daily", times: ["07:30"], instructions: "Take before breakfast." },
];

function manilaDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function dayOffset(date, days) {
  const day = new Date(`${date}T00:00:00.000Z`);
  day.setUTCDate(day.getUTCDate() - days);
  return day.toISOString().slice(0, 10);
}

function dateTime(date, time) {
  return new Date(`${date}T${time}:00+08:00`);
}

function stablePercent(patientIndex, medicationIndex, dayIndex, doseIndex) {
  return ((patientIndex * 37 + medicationIndex * 19 + dayIndex * 13 + doseIndex * 7) % 100) / 100;
}

const userIds = {};
const patientIds = [];

try {
  await client.query("BEGIN");

  for (const user of demoUsers) {
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
    const result = await client.query(
      `INSERT INTO caretrack_users (name, email, password_hash, role, phone, active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (email) DO UPDATE SET
         name = EXCLUDED.name,
         password_hash = EXCLUDED.password_hash,
         role = EXCLUDED.role,
         phone = EXCLUDED.phone,
         must_change_password = false,
         active = true
       RETURNING id`,
      [user.name, user.email, passwordHash, user.role, user.phone],
    );
    userIds[user.key] = result.rows[0].id;
  }

  for (let index = 0; index < patientSeed.length; index += 1) {
    const [name, age, sex, conditions, allergies] = patientSeed[index];
    const email = `patient${index + 1}@caretrack.test`;
    const userId = index === 0 ? userIds.patient : null;
    const result = await client.query(
      `INSERT INTO caretrack_patients
         (user_id, name, age, sex, email, conditions, allergies, notes, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
       ON CONFLICT (email) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         name = EXCLUDED.name,
         age = EXCLUDED.age,
         sex = EXCLUDED.sex,
         conditions = EXCLUDED.conditions,
         allergies = EXCLUDED.allergies,
         notes = EXCLUDED.notes,
         active = true
       RETURNING id`,
      [
        userId,
        name,
        age,
        sex,
        email,
        conditions,
        allergies,
        "Fictional capstone demonstration profile. Not for clinical use.",
      ],
    );
    const patientId = result.rows[0].id;
    patientIds.push(patientId);
    const providerId = index < 5 ? userIds.provider1 : userIds.provider2;
    await client.query(
      `INSERT INTO caretrack_patient_provider_assignments (patient_id, provider_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [patientId, providerId],
    );
  }

  await client.query(
    `INSERT INTO caretrack_patient_caregiver_assignments (patient_id, caregiver_id)
     VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [patientIds[0], userIds.caregiver],
  );

  const medicationIds = [];
  for (let patientIndex = 0; patientIndex < patientIds.length; patientIndex += 1) {
    const template = medicationTemplates[patientIndex % medicationTemplates.length];
    const templates =
      patientIndex === 0 || patientIndex === 1 || patientIndex === 5
        ? [template, medicationTemplates[(patientIndex + 2) % medicationTemplates.length]]
        : [template];
    for (let medicationIndex = 0; medicationIndex < templates.length; medicationIndex += 1) {
      const medication = templates[medicationIndex];
      const existing = await client.query(
        `SELECT id FROM caretrack_medications WHERE patient_id = $1 AND name = $2 LIMIT 1`,
        [patientIds[patientIndex], medication.name],
      );
      let medicationId;
      if (existing.rows[0]) {
        const updated = await client.query(
          `UPDATE caretrack_medications
           SET dosage = $1, form = $2, frequency = $3, times_per_day = $4,
               schedule_times = $5, days_of_week = $6, start_date = $7,
               instructions = $8, prescribed_by = $9, active = true
           WHERE id = $10 RETURNING id`,
          [
            medication.dosage,
            medication.form,
            medication.frequency,
            medication.times.length,
            medication.times,
            [],
            dayOffset(manilaDate(), 60),
            medication.instructions,
            patientIndex < 5 ? userIds.provider1 : userIds.provider2,
            existing.rows[0].id,
          ],
        );
        medicationId = updated.rows[0].id;
      } else {
        const inserted = await client.query(
          `INSERT INTO caretrack_medications
             (patient_id, name, dosage, form, frequency, times_per_day, schedule_times,
              days_of_week, start_date, instructions, prescribed_by, active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)
           RETURNING id`,
          [
            patientIds[patientIndex],
            medication.name,
            medication.dosage,
            medication.form,
            medication.frequency,
            medication.times.length,
            medication.times,
            [],
            dayOffset(manilaDate(), 60),
            medication.instructions,
            patientIndex < 5 ? userIds.provider1 : userIds.provider2,
          ],
        );
        medicationId = inserted.rows[0].id;
      }
      medicationIds.push({
        id: medicationId,
        patientIndex,
        medicationIndex,
        name: medication.name,
        times: medication.times,
        adherence: patientSeed[patientIndex][5],
      });
    }
  }

  const courses = [
    // [patientIndex, name, dosage, form, times, started days ago, course length in days, instructions]
    [0, "Prednisone", "10 mg", "Tablet", ["08:00"], 4, 7, "Take with breakfast. Complete the full 7-day course."],
    [9, "Ciprofloxacin", "500 mg", "Tablet", ["08:00", "20:00"], 5, 7, "Take every 12 hours with water. Complete the full course."],
    [6, "Cetirizine", "10 mg", "Tablet", ["21:00"], 2, 7, "Take at bedtime for 7 days."],
  ];
  for (const [patientIndex, name, dosage, form, times, startedDaysAgo, length, instructions] of courses) {
    const startDate = dayOffset(manilaDate(), startedDaysAgo);
    const endDate = dayOffset(startDate, -(length - 1));
    await client.query(
      `DELETE FROM caretrack_medications WHERE patient_id = $1 AND name = $2`,
      [patientIds[patientIndex], name],
    );
    const inserted = await client.query(
      `INSERT INTO caretrack_medications
         (patient_id, name, dosage, form, frequency, times_per_day, schedule_times,
          days_of_week, start_date, end_date, instructions, prescribed_by, active)
       VALUES ($1, $2, $3, $4, 'daily', $5, $6, '{}', $7, $8, $9, $10, true)
       RETURNING id`,
      [
        patientIds[patientIndex],
        name,
        dosage,
        form,
        times.length,
        times,
        startDate,
        endDate,
        instructions,
        patientIndex < 5 ? userIds.provider1 : userIds.provider2,
      ],
    );
    medicationIds.push({
      id: inserted.rows[0].id,
      patientIndex,
      medicationIndex: 7,
      name,
      times,
      adherence: patientSeed[patientIndex][5],
      startDate,
      endDate,
    });
  }

  const today = manilaDate();
  const now = new Date();
  const events = [];
  for (let daysAgo = 44; daysAgo >= 0; daysAgo -= 1) {
    const date = dayOffset(today, daysAgo);
    for (const medication of medicationIds) {
      if (medication.startDate && (date < medication.startDate || date > medication.endDate)) continue;
      for (let doseIndex = 0; doseIndex < medication.times.length; doseIndex += 1) {
        const scheduledTime = dateTime(date, medication.times[doseIndex]);
        const chance = stablePercent(
          medication.patientIndex,
          medication.medicationIndex,
          daysAgo,
          doseIndex,
        );
        let status = chance < medication.adherence ? "taken" : chance < medication.adherence + 0.08 ? "skipped" : "missed";
        let takenTime = null;
        if (scheduledTime > now) {
          status = "scheduled";
        } else if (status === "taken") {
          const minutesAfter = 5 + ((medication.patientIndex * 11 + daysAgo * 3 + doseIndex * 17) % 70);
          takenTime = new Date(scheduledTime.getTime() + minutesAfter * 60_000);
        }
        events.push([
          patientIds[medication.patientIndex],
          medication.id,
          scheduledTime,
          takenTime,
          status,
          status === "missed" ? "Not logged during the scheduled window." : null,
          // Who recorded it: the patient for taken/skipped, the system for auto-missed doses.
          status === "missed"
            ? "System: not logged within 2 hours"
            : status === "scheduled"
              ? null
              : `${patientSeed[medication.patientIndex][0]} (patient)`,
        ]);
      }
    }
  }

  const chunkSize = 150;
  for (let offset = 0; offset < events.length; offset += chunkSize) {
    const chunk = events.slice(offset, offset + chunkSize);
    const values = [];
    const tuples = chunk.map((row, rowIndex) => {
      const base = rowIndex * 7;
      values.push(...row);
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
    });
    await client.query(
      `INSERT INTO caretrack_dose_logs
        (patient_id, medication_id, scheduled_time, taken_time, status, notes, logged_by)
       VALUES ${tuples.join(",")}
       ON CONFLICT (medication_id, scheduled_time) DO NOTHING`,
      values,
    );
  }


  // ---------------------------------------------------------------------------
  // Pre-generated reports, AI insights, notifications and a report schedule.
  // Re-running the seed resets these demo records.
  // ---------------------------------------------------------------------------
  const medicationById = new Map(medicationIds.map((medication) => [medication.id, medication]));
  const pastEvents = events
    .filter(([, , scheduledTime]) => scheduledTime <= now)
    .map(([patientId, medicationId, scheduledTime, , status]) => ({
      patientId,
      medicationId,
      scheduledTime,
      status,
    }));
  const patientNameById = new Map(
    patientIds.map((id, index) => [id, patientSeed[index][0]]),
  );

  const percent = (taken, total) => (total === 0 ? 0 : Math.round((taken / total) * 100));
  const riskOf = (rate) => (rate >= 80 ? "green" : rate >= 50 ? "yellow" : "red");
  const periodOf = (time) => {
    const hour = Number(
      new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", hour: "2-digit", hourCycle: "h23" })
        .formatToParts(time)
        .find((part) => part.type === "hour")?.value ?? "0",
    );
    return hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";
  };

  // Mirrors calculateAnalytics() in the API so stored report data has the same shape.
  function analyticsFor(patientIdList, fromDate, toDate) {
    const startAt = new Date(`${fromDate}T00:00:00+08:00`);
    const endAt = new Date(`${toDate}T00:00:00+08:00`);
    endAt.setDate(endAt.getDate() + 1);
    const rows = pastEvents.filter(
      (row) =>
        patientIdList.includes(row.patientId) &&
        row.scheduledTime >= startAt &&
        row.scheduledTime < endAt,
    );
    const totals = { taken: 0, missed: 0, skipped: 0 };
    const daily = new Map();
    const meds = new Map();
    const patients = new Map();
    const times = new Map();
    for (const row of rows) {
      if (row.status in totals) totals[row.status] += 1;
      const day = manilaDate(row.scheduledTime);
      const point = daily.get(day) ?? { taken: 0, total: 0 };
      point.total += 1;
      if (row.status === "taken") point.taken += 1;
      daily.set(day, point);
      for (const [map, key, name] of [
        [meds, row.medicationId, medicationById.get(row.medicationId)?.name ?? "Medication"],
        [patients, row.patientId, patientNameById.get(row.patientId)],
      ]) {
        const entry = map.get(key) ?? { name, taken: 0, missed: 0, total: 0 };
        entry.total += 1;
        if (row.status === "taken") entry.taken += 1;
        if (row.status === "missed") entry.missed += 1;
        map.set(key, entry);
      }
      const slot = periodOf(row.scheduledTime);
      const time = times.get(slot) ?? { missedCount: 0, scheduledCount: 0 };
      time.scheduledCount += 1;
      if (row.status === "missed") time.missedCount += 1;
      times.set(slot, time);
    }
    const riskPatients = [...patients]
      .map(([patientId, entry]) => {
        const adherenceRate = percent(entry.taken, entry.total);
        return {
          patientId,
          patientName: entry.name,
          adherenceRate,
          riskLevel: riskOf(adherenceRate),
          missedCount: entry.missed,
        };
      })
      .sort((a, b) => a.adherenceRate - b.adherenceRate);
    return {
      totalPatients: patientIdList.length,
      totalDoses: rows.length,
      takenCount: totals.taken,
      missedCount: totals.missed,
      skippedCount: totals.skipped,
      adherenceRate: percent(totals.taken, rows.length),
      highRiskPatients: riskPatients.filter((item) => item.riskLevel === "red").length,
      trend: [...daily].map(([date, point]) => ({ date, adherenceRate: percent(point.taken, point.total) })),
      byMedication: [...meds].map(([medicationId, entry]) => ({
        medicationId,
        medicationName: entry.name,
        adherenceRate: percent(entry.taken, entry.total),
        scheduledCount: entry.total,
        missedCount: entry.missed,
      })),
      byTimeOfDay: ["Morning", "Afternoon", "Evening"].map((period) => ({
        period,
        missedCount: times.get(period)?.missedCount ?? 0,
        scheduledCount: times.get(period)?.scheduledCount ?? 0,
      })),
      riskPatients,
    };
  }

  function narrativeFor(analytics, label) {
    const worstSlot = [...analytics.byTimeOfDay]
      .filter((slot) => slot.scheduledCount > 0)
      .sort((a, b) => b.missedCount / b.scheduledCount - a.missedCount / a.scheduledCount)[0];
    const pattern =
      worstSlot && worstSlot.missedCount > 0
        ? ` ${worstSlot.period} doses were missed most often (${worstSlot.missedCount} of ${worstSlot.scheduledCount}).`
        : " Doses were logged consistently across the day.";
    const tone =
      analytics.adherenceRate >= 80
        ? "Adherence is on track."
        : analytics.adherenceRate >= 50
          ? "Adherence is moderate and worth monitoring."
          : "Adherence is low and a supportive check-in is recommended.";
    return `${label}: ${analytics.adherenceRate}% of ${analytics.totalDoses} scheduled doses were taken, with ${analytics.missedCount} missed and ${analytics.skippedCount} skipped. ${tone}${pattern}`;
  }

  function recommendationsFor(analytics) {
    const worstSlot = [...analytics.byTimeOfDay].sort((a, b) => b.missedCount - a.missedCount)[0];
    const items = [];
    if (worstSlot?.missedCount > 0) {
      items.push(`Pair the ${worstSlot.period.toLowerCase()} dose with an existing daily routine, such as a meal or brushing teeth.`);
    }
    if (analytics.adherenceRate < 80) {
      items.push("Schedule a brief check-in to discuss barriers such as cost, side effects or forgetfulness.");
    } else {
      items.push("Keep using the reminders and routines that are already working.");
    }
    items.push("Continue logging every dose so future reports reflect a complete picture.");
    return items.slice(0, 3);
  }

  const today2 = manilaDate();
  const providerPatients = {
    provider1: patientIds.slice(0, 5),
    provider2: patientIds.slice(5),
  };

  await client.query(
    `DELETE FROM caretrack_reports WHERE report_data->>'seeded' = 'true'`,
  );
  await client.query(`DELETE FROM caretrack_ai_insights WHERE patient_id = ANY($1)`, [patientIds]);
  await client.query(`DELETE FROM caretrack_notifications WHERE user_id = ANY($1)`, [
    Object.values(userIds),
  ]);

  let seededReports = 0;
  const reportPlan = [
    // [author, patientId|null, period, daysAgoCreated]
    ["provider1", null, "monthly", 3],
    ["provider1", null, "weekly", 1],
    ["provider1", patientIds[0], "monthly", 2],
    ["provider1", patientIds[4], "weekly", 1],
    ["provider2", null, "weekly", 2],
    ["provider2", patientIds[9], "monthly", 1],
    ["provider2", patientIds[8], "weekly", 0],
  ];
  for (const [author, patientId, period, daysAgoCreated] of reportPlan) {
    const rangeEnd = dayOffset(today2, daysAgoCreated);
    const rangeStart = dayOffset(rangeEnd, period === "monthly" ? 29 : 6);
    const scope = patientId === null ? providerPatients[author] : [patientId];
    const analytics = analyticsFor(scope, rangeStart, rangeEnd);
    const label =
      patientId === null
        ? `Caseload ${period} summary`
        : `${patientNameById.get(patientId)} ${period} summary`;
    await client.query(
      `INSERT INTO caretrack_reports
         (patient_id, generated_by, period, range_start, range_end, adherence_rate, summary, report_data, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        patientId,
        userIds[author],
        period,
        rangeStart,
        rangeEnd,
        analytics.adherenceRate,
        narrativeFor(analytics, label),
        JSON.stringify({
          analytics,
          recommendations: recommendationsFor(analytics),
          source: "rules",
          seeded: true,
        }),
        dateTime(rangeEnd, "18:00"),
      ],
    );
    seededReports += 1;
  }

  let seededInsights = 0;
  for (let index = 0; index < patientIds.length; index += 1) {
    const patientId = patientIds[index];
    const author = index < 5 ? "provider1" : "provider2";
    const analytics = analyticsFor([patientId], dayOffset(today2, 29), today2);
    await client.query(
      `INSERT INTO caretrack_ai_insights
         (patient_id, generated_by, summary, risk_level, recommendations, source, created_at)
       VALUES ($1, $2, $3, $4, $5, 'rules', $6)`,
      [
        patientId,
        userIds[author],
        narrativeFor(analytics, "Last 30 days"),
        riskOf(analytics.adherenceRate),
        recommendationsFor(analytics),
        new Date(now.getTime() - (index + 1) * 3 * 60 * 60 * 1000),
      ],
    );
    seededInsights += 1;

    if (riskOf(analytics.adherenceRate) === "red") {
      await client.query(
        `INSERT INTO caretrack_notifications (user_id, patient_id, kind, title, message, read)
         VALUES ($1, $2, 'risk', $3, $4, false)`,
        [
          userIds[author],
          patientId,
          `Adherence needs attention: ${patientNameById.get(patientId)}`,
          `Only ${analytics.adherenceRate}% of doses in the last 30 days were taken. Review the schedule and consider a supportive check-in.`,
        ],
      );
    }
  }

  await client.query(`DELETE FROM caretrack_messages WHERE patient_id = ANY($1)`, [patientIds]);
  await client.query(`DELETE FROM caretrack_message_reads WHERE patient_id = ANY($1)`, [patientIds]);
  const conversation = [
    // [patientIndex, sender key, minutes ago, text]
    [0, "provider1", 2 * 24 * 60, "Hi Alex, I've started you on a 7-day Prednisone course. Please take it every morning with breakfast."],
    [0, "patient", 2 * 24 * 60 - 45, "Thank you, Doc. Is it okay to take it together with my Lisinopril?"],
    [0, "provider1", 2 * 24 * 60 - 90, "Yes, that's fine. Let me know if you notice any stomach upset or trouble sleeping."],
    [0, "patient", 60, "Doing well so far. I missed one evening dose of Atorvastatin last week, sorry."],
    [9, "provider2", 26 * 60, "Hi Priya, I noticed several missed doses this week. Is anything making the schedule hard to follow?"],
    [4, "provider1", 5 * 60, "Ethan, your recent logs look good. Keep it up!"],
  ];
  for (const [patientIndex, sender, minutesAgo, text] of conversation) {
    await client.query(
      `INSERT INTO caretrack_messages (patient_id, sender_id, body, created_at) VALUES ($1, $2, $3, $4)`,
      [patientIds[patientIndex], userIds[sender], text, new Date(now.getTime() - minutesAgo * 60 * 1000)],
    );
  }

  // Sample coverage: Dr. Mira Santos is away for 3 days, Dr. Joel Reyes covers her patients.
  await client.query(
    `DELETE FROM caretrack_provider_coverage WHERE absent_provider_id = ANY($1) OR covering_provider_id = ANY($1)`,
    [[userIds.provider1, userIds.provider2]],
  );
  await client.query(
    `INSERT INTO caretrack_provider_coverage
       (absent_provider_id, covering_provider_id, start_date, end_date, reason, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userIds.provider1, userIds.provider2, today2, dayOffset(today2, -2), "Attending a medical conference", userIds.admin],
  );

  // Sample follow-up check-ups.
  await client.query(`DELETE FROM caretrack_appointments WHERE patient_id = ANY($1)`, [patientIds]);
  const checkups = [
    // [patientIndex, provider key, days from now, hour, reason]
    [0, "provider1", 3, 9, "Follow-up: blood pressure and Prednisone course review"],
    [9, "provider2", 1, 14, "Adherence check-in and medication review"],
    [8, "provider2", 5, 10, "Diabetes follow-up and lab result review"],
  ];
  for (const [patientIndex, provider, inDays, hour, reason] of checkups) {
    const at = new Date(`${dayOffset(today2, -inDays)}T${String(hour).padStart(2, "0")}:00:00+08:00`);
    await client.query(
      `INSERT INTO caretrack_appointments (patient_id, provider_id, scheduled_at, reason, status, created_by)
       VALUES ($1, $2, $3, $4, 'scheduled', $2)`,
      [patientIds[patientIndex], userIds[provider], at, reason],
    );
  }

  const welcome = [
    ["admin", "Welcome to CareTrack", "Manage team access and review audit activity from the sidebar."],
    ["provider1", "Weekly report ready", "Your weekly caseload adherence report is ready to download."],
    ["provider2", "You're covering for Dr. Mira Santos", "Her 5 patients appear in your list for the next 3 days. You'll receive their alerts and messages."],
    ["patient", "Your schedule is ready", "Your care team has set up your medication schedule. Log each dose from Today's doses."],
    ["caregiver", "You are linked to Alex Morgan", "You can follow Alex's daily doses and receive missed-dose alerts."],
  ];
  for (const [key, title, message] of welcome) {
    await client.query(
      `INSERT INTO caretrack_notifications (user_id, kind, title, message, read)
       VALUES ($1, 'info', $2, $3, false)`,
      [userIds[key], title, message],
    );
  }

  const existingSchedule = await client.query(
    `SELECT id FROM caretrack_report_schedules WHERE created_by = $1 AND patient_id IS NULL LIMIT 1`,
    [userIds.provider1],
  );
  if (!existingSchedule.rows[0]) {
    const nextRun = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    await client.query(
      `INSERT INTO caretrack_report_schedules (created_by, patient_id, cadence, next_run_at, active)
       VALUES ($1, NULL, 'weekly', $2, true)`,
      [userIds.provider1, nextRun],
    );
  }

  await client.query("DELETE FROM caretrack_health_logs WHERE patient_id = ANY($1::int[])", [patientIds]);
  await client.query("DELETE FROM caretrack_health_metrics WHERE patient_id = ANY($1::int[])", [patientIds]);
  await client.query("DELETE FROM caretrack_risk_predictions WHERE patient_id = ANY($1::int[])", [patientIds]);
  const metricTypes = ["blood_pressure", "blood_sugar", "heart_rate", "weight", "temperature"];
  let seededMetrics = 0;
  for (let patientIndex = 0; patientIndex < patientIds.length; patientIndex += 1) {
    const patientId = patientIds[patientIndex];
    for (let day = 6; day >= 0; day -= 1) {
      const measuredAt = new Date();
      measuredAt.setDate(measuredAt.getDate() - day);
      measuredAt.setHours(8, 0, 0, 0);
      for (let metricIndex = 0; metricIndex < metricTypes.length; metricIndex += 1) {
        const metricType = metricTypes[metricIndex];
        let value = 120 + patientIndex % 4;
        let secondary = null;
        let unit = "mmHg";
        let outOfRange = false;
        if (metricType === "blood_sugar") { value = 95 + patientIndex % 8; unit = "mg/dL"; }
        if (metricType === "heart_rate") { value = 72 + patientIndex % 7; unit = "bpm"; }
        if (metricType === "weight") { value = 62 + patientIndex * 0.4; unit = "kg"; }
        if (metricType === "temperature") { value = 36.4 + (patientIndex % 3) * 0.1; unit = "°C"; }
        if (metricType === "blood_pressure") secondary = 78 + patientIndex % 5;
        if (patientIndex === 0 && day === 0 && metricType === "blood_pressure") {
          value = 146;
          secondary = 94;
          outOfRange = true;
        }
        if (patientIndex === 0 && day === 0 && metricType === "blood_sugar") {
          value = 158;
          outOfRange = true;
        }
        await client.query(
          `INSERT INTO caretrack_health_metrics
            (patient_id, metric_type, value, secondary_value, unit, recorded_at, recorded_by, out_of_range)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [patientId, metricType, value, secondary, unit, measuredAt.toISOString(), demoUserIds.provider1, outOfRange],
        );
        seededMetrics += 1;
      }
      if (patientIndex === 0) {
        await client.query(
          `INSERT INTO caretrack_risk_predictions
            (patient_id, risk_level, risk_score, prob_low, prob_moderate, prob_high, features, factors, created_at)
           VALUES ($1, 'moderate', 68, 0.22, 0.68, 0.10, $2, $3, NOW())`,
          [
            patientId,
            JSON.stringify({ adherence14: 82, healthOutOfRangeRate: 29, bloodPressureSystolic: 146, bloodSugarLatest: 158 }),
            JSON.stringify([
              { feature: "bloodPressureSystolic", label: "Latest systolic blood pressure", value: 146, typical: 120, impact: 0.24, text: "Recent systolic blood pressure is elevated at 146 mmHg." },
              { feature: "healthOutOfRangeRate", label: "Health readings outside range", value: 29, typical: 0, impact: 0.19, text: "Several recent health readings are outside the configured range." },
              { feature: "adherence14", label: "14-day adherence", value: 82, typical: 90, impact: 0.12, text: "14-day dose adherence is below the recent-care target." },
            ]),
          ],
        );
      }
    }
    await client.query(
      `INSERT INTO caretrack_health_logs (patient_id, recorded_at, symptoms, notes, recorded_by)
       VALUES ($1, NOW(), $2, $3, $4)`,
      [patientId, ["fatigue"], "Demo symptom log for defense walkthrough.", demoUserIds.provider1],
    );
  }

  await client.query("COMMIT");
  console.log(
    `Seeded ${demoUsers.length} demo users, ${patientIds.length} fictional patients, ${medicationIds.length} medications, ${events.length} dose events, ${seededMetrics} health metrics, ${seededReports} reports and ${seededInsights} AI insights.`,
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
