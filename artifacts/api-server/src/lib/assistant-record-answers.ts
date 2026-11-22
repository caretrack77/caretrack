export type AssistantRecordIntent = "next-dose" | "missed-dose" | "medications" | "appointment" | "progress";

export type AssistantDoseRecord = {
  medicationName: string;
  dosage: string;
  scheduledTime: Date;
  patientName?: string;
};

export type AssistantMedicationRecord = {
  name: string;
  dosage: string;
  frequency: string;
  timesPerDay: number;
  scheduleTimes: string[];
  daysOfWeek: number[];
  intervalHours: number | null;
  instructions: string | null;
  patientName?: string;
};

export type AssistantAppointmentRecord = {
  scheduledAt: Date;
  reason: string;
  patientName?: string;
};

export type AssistantProgressRecord = {
  status: string;
};

export function assistantRecordIntent(question: string): AssistantRecordIntent | null {
  const text = question.toLowerCase();
  if (/\b(can i|may i|is it safe|safe to)\b.{0,80}\b(take|mix|combine|use)\b/.test(text)) {
    return null;
  }
  if (/\b(missed|miss|forgot|forgotten|nakalimutan)\b/.test(text)
    && /\b(dose|medicine|medication|meds?|gamot)\b/.test(text)) {
    return "missed-dose";
  }
  if (/\b(appointment|check[\s-]?up|follow[\s-]?up|doctor visit|kailan.*doktor|kelan.*doktor)\b/.test(text)) {
    return "appointment";
  }
  if (/\b(progress|adherence|streak|how am i doing|kumusta ako|kamusta ako|progreso)\b/.test(text)) {
    return "progress";
  }
  if (/\b(when|kailan|kelan|next|susunod|oras|what time)\b/.test(text)
    && /\b(dose|medicine|medication|meds?|gamot)\b/.test(text)) {
    return "next-dose";
  }
  if (/\b(list|which medicines?|which medications?|what medicines?|what medications?|what meds?|what am i taking|current medications?|active medications?|medication schedule|medicine schedule|my medicines?|my medications?|my meds?|gamot ko|mga gamot|iniinom ko)\b/.test(text)) {
    return "medications";
  }
  if (/\b(dose|doses|medicine|medication|meds?|gamot|schedule|oras|time|kailan|kelan|susunod|next|today|tomorrow|ngayon|bukas)\b/.test(text)) {
    return "next-dose";
  }
  return null;
}

function isFilipino(question: string): boolean {
  return /\b(kailan|kelan|gamot|oras|susunod|ngayon|bukas|kumusta|kamusta|iniinom)\b/i.test(question);
}

function dateLabel(value: Date, filipino: boolean): string {
  return new Intl.DateTimeFormat(filipino ? "fil-PH" : "en-US", {
    timeZone: "Asia/Manila",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(value);
}

function timeLabel(value: Date, filipino: boolean): string {
  return new Intl.DateTimeFormat(filipino ? "fil-PH" : "en-US", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function patientLabel(name: string | undefined, filipino: boolean): string {
  return name ? (filipino ? ` para kay ${name}` : ` for ${name}`) : "";
}

export function answerFromAssistantRecords(
  question: string,
  intent: AssistantRecordIntent,
  records: AssistantDoseRecord[] | AssistantMedicationRecord[] | AssistantAppointmentRecord[] | AssistantProgressRecord[],
): string {
  const filipino = isFilipino(question);
  if (intent === "next-dose") {
    const doses = records as AssistantDoseRecord[];
    const next = doses[0];
    if (!next) {
      return filipino
        ? "Walang naka-iskedyul na susunod na dose sa CareTrack sa loob ng susunod na 7 araw. Tingnan ang schedule ng gamot o kumonsulta sa iyong care team."
        : "There are no upcoming scheduled doses in CareTrack for the next 7 days. Check the medication schedule or contact your care team.";
    }
    return filipino
      ? `Ang susunod na naka-iskedyul na dose${patientLabel(next.patientName, filipino)} ay ${next.medicationName} (${next.dosage}) sa ${dateLabel(next.scheduledTime, filipino)}, ${timeLabel(next.scheduledTime, filipino)} oras sa Pilipinas.`
      : `Your next scheduled dose${patientLabel(next.patientName, filipino)} is ${next.medicationName} (${next.dosage}) on ${dateLabel(next.scheduledTime, filipino)} at ${timeLabel(next.scheduledTime, filipino)} Manila time.`;
  }

  if (intent === "missed-dose") {
    const doses = records as AssistantDoseRecord[];
    const missed = doses[0];
    if (!missed) {
      return filipino
        ? "Walang dose na naitalang na-miss sa CareTrack sa nakaraang 7 araw. Kung may hindi ka nainom, sundin ang bilin sa reseta o kumonsulta sa doktor o pharmacist."
        : "CareTrack has no doses recorded as missed in the past 7 days. If you did miss one, follow your prescription instructions or contact your doctor or pharmacist.";
    }
    return filipino
      ? `Nakatala sa CareTrack na na-miss ang ${missed.medicationName} (${missed.dosage})${patientLabel(missed.patientName, filipino)} noong ${dateLabel(missed.scheduledTime, filipino)}, ${timeLabel(missed.scheduledTime, filipino)} oras sa Pilipinas. Sundin ang bilin sa reseta o kumonsulta sa doktor o pharmacist; huwag magdoble ng dose maliban kung ipinayo nila.`
      : `CareTrack records ${missed.medicationName} (${missed.dosage})${patientLabel(missed.patientName, filipino)} as missed on ${dateLabel(missed.scheduledTime, filipino)} at ${timeLabel(missed.scheduledTime, filipino)} Manila time. Follow your prescription or ask your doctor or pharmacist; do not double a dose unless they advise you to.`;
  }

  if (intent === "medications") {
    const medications = records as AssistantMedicationRecord[];
    if (!medications.length) {
      return filipino
        ? "Walang aktibong gamot na nakatala sa CareTrack."
        : "There are no active medications listed in CareTrack.";
    }
    const details = medications.slice(0, 8).map((medication) => {
      const schedule = medication.frequency === "every_hours" && medication.intervalHours
        ? `every ${medication.intervalHours} hours starting at ${medication.scheduleTimes[0] ?? "08:00"}`
        : medication.frequency === "specific_days" && medication.daysOfWeek.length
          ? `on ${medication.daysOfWeek.map((day) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day]).join(", ")}${medication.scheduleTimes.length ? ` at ${medication.scheduleTimes.join(", ")}` : ""}`
          : medication.scheduleTimes.length
        ? medication.scheduleTimes.join(", ")
        : medication.intervalHours
          ? `every ${medication.intervalHours} hours`
          : `${medication.timesPerDay} time${medication.timesPerDay === 1 ? "" : "s"} daily`;
      const patient = medication.patientName ? ` (${medication.patientName})` : "";
      const instructions = medication.instructions ? ` — ${medication.instructions}` : "";
      return `${medication.name} ${medication.dosage}${patient}: ${schedule}${instructions}`;
    });
    return filipino
      ? `Mga aktibong gamot at schedule na nakatala sa CareTrack: ${details.join("; ")}. Sundin ang bilin ng doktor.`
      : `Active medications and schedules listed in CareTrack: ${details.join("; ")}. Follow your prescriber's instructions.`;
  }

  if (intent === "appointment") {
    const appointments = records as AssistantAppointmentRecord[];
    const next = appointments[0];
    if (!next) {
      return filipino
        ? "Walang paparating na check-up na nakatala sa CareTrack."
        : "There are no upcoming check-ups listed in CareTrack.";
    }
    return filipino
      ? `Ang susunod na check-up${patientLabel(next.patientName, filipino)} ay ${dateLabel(next.scheduledAt, filipino)}, ${timeLabel(next.scheduledAt, filipino)} oras sa Pilipinas (${next.reason}).`
      : `Your next check-up${patientLabel(next.patientName, filipino)} is on ${dateLabel(next.scheduledAt, filipino)} at ${timeLabel(next.scheduledAt, filipino)} Manila time (${next.reason}).`;
  }

  const progress = records as AssistantProgressRecord[];
  const completed = progress.filter((dose) => dose.status === "taken" || dose.status === "missed" || dose.status === "skipped");
  const taken = completed.filter((dose) => dose.status === "taken").length;
  const missed = completed.filter((dose) => dose.status === "missed").length;
  const total = completed.length;
  if (!total) {
    return filipino
      ? "Wala pang dose log sa CareTrack para sa nakaraang 7 araw."
      : "There are no dose logs in CareTrack for the past 7 days.";
  }
  return filipino
    ? `Sa nakaraang 7 araw, ${taken} sa ${total} naka-log na dose ang naitalang nainom at ${missed} ang naitalang na-miss sa CareTrack.`
    : `For the past 7 days, CareTrack records ${taken} of ${total} logged doses as taken and ${missed} as missed.`;
}
