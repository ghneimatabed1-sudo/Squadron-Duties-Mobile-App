export function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseISO(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function todayISO(): string {
  return toISO(new Date());
}

export function addDays(s: string, n: number): string {
  const d = parseISO(s);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function dayOfWeek(s: string): number {
  return parseISO(s).getDay(); // 0=Sun ... 6=Sat
}

// Week starts on Sunday.
export function startOfWeek(s: string): string {
  const d = parseISO(s);
  d.setDate(d.getDate() - d.getDay());
  return toISO(d);
}

export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

// Weekend = Thursday (4), Friday (5), Saturday (6).
export function isWeekend(s: string): boolean {
  const d = dayOfWeek(s);
  return d === 4 || d === 5 || d === 6;
}

// Weekend dates (Thu/Fri/Sat) for the week that contains `s`.
export function weekendDates(s: string): string[] {
  const ws = startOfWeek(s);
  return [addDays(ws, 4), addDays(ws, 5), addDays(ws, 6)];
}

export function diffDays(a: string, b: string): number {
  return Math.round(
    (parseISO(a).getTime() - parseISO(b).getTime()) / 86400000,
  );
}

// Is `date` within the window of `windowDays` ending at `refDate` (inclusive of today)?
export function inWindow(
  date: string,
  refDate: string,
  windowDays: number,
): boolean {
  const d = diffDays(refDate, date);
  return d >= 0 && d < windowDays;
}

export function isValidISO(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  // Reject calendar rollovers (e.g. 2025-02-30 -> March): round-trip must match.
  return (
    dt.getFullYear() === y &&
    dt.getMonth() === m - 1 &&
    dt.getDate() === d
  );
}
