// People's names are stored as "Last, First Middle" (patients), "Dr. Last, First Middle"
// (doctors) or "Sir Last, First Middle" (administrators). Older or user-entered names may
// still be "First Last". These helpers read every form, so avatars and short greetings look
// right whichever is used.

export function splitName(name = ''): { title: string; first: string; last: string } {
  const trimmed = name.trim();
  const title = /^(Dr|Nurse|Sir|Ma'am|Mrs|Mr|Ms)\.?\s+/i.exec(trimmed)?.[0].trim() || '';
  const rest = trimmed.slice(title.length).trim();
  if (rest.includes(',')) {
    const [last, given = ''] = rest.split(',');
    return { title, last: last.trim(), first: given.trim().split(/\s+/)[0] || '' };
  }
  const parts = rest.split(/\s+/).filter(Boolean);
  return { title, first: parts[0] || '', last: parts.length > 1 ? parts[parts.length - 1] : '' };
}

/** Two-letter avatar initials (first name, then last name), ignoring a "Dr." title. */
export function initials(name = ''): string {
  const n = splitName(name);
  return `${n.first[0] || ''}${n.last[0] || ''}`.toUpperCase() || (name.trim()[0] || '?').toUpperCase();
}

/** How to address someone briefly: "Dr. Baltazar" or "Sir Reyes" when there's a title, otherwise the first name. */
export function shortName(name = ''): string {
  const n = splitName(name);
  return n.title && n.last ? `${n.title} ${n.last}` : n.first || n.last || name;
}
