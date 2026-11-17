// Times are always shown in 12-hour form (8:00 AM / 1:30 PM), whatever the device's clock
// setting. Stored values are never changed: timestamps stay ISO strings and medication
// schedule times stay "HH:MM" (24-hour), which is what the server and database expect.

const TIME_12: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', hour12: true };

/** A timestamp's time of day, e.g. "8:00 PM". */
export function timeLabel(value: string | number | Date): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleTimeString('en-US', TIME_12);
}

/** A timestamp as a date plus 12-hour time, e.g. "Nov 18, 8:00 PM". */
export function dateTimeLabel(value: string | number | Date, date: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString('en-US', { ...date, ...TIME_12 });
}

/** A stored schedule time as 12-hour text: "08:00" → "8:00 AM", "13:30" → "1:30 PM", "20:00" → "8:00 PM". */
export function clock12(value: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return value;
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * Reads a time typed by a person ("8:00 AM", "8 pm", "8:30PM", "1:30 p.m." or "20:00") and
 * returns the stored "HH:MM" form, or null when it isn't a valid time. A bare "8" is
 * rejected because it could mean 8 AM or 8 PM.
 */
export function parseClock(value: string): string | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(?:([ap])\.?\s*m?\.?)?$/i.exec(value.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? '0');
  const half = m[3]?.toLowerCase();
  if (min > 59) return null;
  if (half) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (half === 'p' ? 12 : 0);
  } else if (m[2] === undefined || h > 23) {
    return null;
  }
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** Splits a comma-separated list of times into stored "HH:MM" values, reporting any that don't parse. */
export function parseClockList(value: string): { times: string[]; invalid: string[] } {
  const times: string[] = [];
  const invalid: string[] = [];
  for (const part of value.split(',').map((x) => x.trim()).filter(Boolean)) {
    const parsed = parseClock(part);
    if (parsed) { if (!times.includes(parsed)) times.push(parsed); } else invalid.push(part);
  }
  return { times: times.sort(), invalid };
}
