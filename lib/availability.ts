import { isValidISO } from "./dates";
import {
  AvailabilityCode,
  AvailabilityEntry,
  DEFAULT_AVAILABILITY_CODES,
  Person,
  uid,
} from "./types";

/** Canonical case-insensitive key for a code string. */
export function codeKey(code: string): string {
  return code.trim().toUpperCase();
}

/** Clean up a typed code: trim, collapse whitespace, cap length. */
export function sanitizeCode(code: string): string {
  return code.trim().replace(/\s+/g, " ").slice(0, 20);
}

/** Seed dictionary used when the state has no codes yet. */
export function defaultCodes(): AvailabilityCode[] {
  return DEFAULT_AVAILABILITY_CODES.map((c) => ({ ...c, id: uid() + c.code }));
}

/**
 * Ensure `code` exists in the dictionary; returns the (possibly extended)
 * dictionary and the canonical stored code string.
 */
export function ensureCode(
  codes: AvailabilityCode[],
  raw: string,
  label?: string,
): { codes: AvailabilityCode[]; code: string } {
  const clean = sanitizeCode(raw);
  if (!clean) return { codes, code: "" };
  const key = codeKey(clean);
  const existing = codes.find((c) => codeKey(c.code) === key);
  if (existing) return { codes, code: existing.code };
  return {
    codes: [
      ...codes,
      { id: uid(), code: clean, label: label?.trim() || clean, countsAsDayOff: false },
    ],
    code: clean,
  };
}

/**
 * Apply the FIXED manual order to a list of people: ids in `order` first (in
 * that exact order), then anyone not listed, oldest first. Never sorts by
 * rank or name.
 */
export function orderPeople(people: Person[], order: string[]): Person[] {
  const pos = new Map<string, number>();
  order.forEach((id, i) => pos.set(id, i));
  return [...people].sort((a, b) => {
    const pa = pos.has(a.id) ? pos.get(a.id)! : Number.MAX_SAFE_INTEGER;
    const pb = pos.has(b.id) ? pos.get(b.id)! : Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
    return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
  });
}

/** Entry lookup for a given date: personId -> entry. */
export function entriesForDate(
  entries: AvailabilityEntry[],
  date: string,
): Map<string, AvailabilityEntry> {
  const m = new Map<string, AvailabilityEntry>();
  for (const e of entries) if (e.date === date) m.set(e.personId, e);
  return m;
}

/**
 * Per-person totals of each code within [start, end] inclusive.
 * Returns personId -> (codeKey -> count).
 */
export function countCodes(
  entries: AvailabilityEntry[],
  start: string,
  end: string,
): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const e of entries) {
    if (e.date < start || e.date > end) continue;
    let per = out.get(e.personId);
    if (!per) {
      per = new Map();
      out.set(e.personId, per);
    }
    const k = codeKey(e.code);
    per.set(k, (per.get(k) ?? 0) + 1);
  }
  return out;
}

export interface DayOffCandidate {
  person: Person;
  /** Total marks whose code counts as a day off (entire recorded history up to the chosen date). */
  dayOffCount: number;
  /** Days since their most recent day-off-type mark; null = never had one. */
  daysSinceLast: number | null;
}

/**
 * Rank `people` for "who should get the next day off": fewest day-off-type
 * days first; ties broken by who has waited longest since their last day off
 * (never had one = waited forever = first).
 */
export function recommendDayOff(
  people: Person[],
  entries: AvailabilityEntry[],
  codes: AvailabilityCode[],
  targetDate: string,
): DayOffCandidate[] {
  const offKeys = new Set(
    codes.filter((c) => c.countsAsDayOff).map((c) => codeKey(c.code)),
  );
  const byPerson = new Map<string, { count: number; last: string | null }>();
  for (const e of entries) {
    if (e.date >= targetDate) continue; // only history before the chosen day
    if (!offKeys.has(codeKey(e.code))) continue;
    const cur = byPerson.get(e.personId) ?? { count: 0, last: null };
    cur.count += 1;
    if (!cur.last || e.date > cur.last) cur.last = e.date;
    byPerson.set(e.personId, cur);
  }
  const msPerDay = 86400000;
  const target = new Date(targetDate + "T00:00:00").getTime();
  const out: DayOffCandidate[] = people.map((p) => {
    const rec = byPerson.get(p.id);
    return {
      person: p,
      dayOffCount: rec?.count ?? 0,
      daysSinceLast: rec?.last
        ? Math.round((target - new Date(rec.last + "T00:00:00").getTime()) / msPerDay)
        : null,
    };
  });
  out.sort((a, b) => {
    if (a.dayOffCount !== b.dayOffCount) return a.dayOffCount - b.dayOffCount;
    const wa = a.daysSinceLast === null ? Infinity : a.daysSinceLast;
    const wb = b.daysSinceLast === null ? Infinity : b.daysSinceLast;
    return wb - wa;
  });
  return out;
}

// ---------------- export / import ----------------

export const AVAILABILITY_FILE_TYPE = "squadron-availability";

export interface AvailabilityExport {
  type: typeof AVAILABILITY_FILE_TYPE;
  version: 1;
  squadronName: string;
  month: string; // yyyy-mm
  people: { id: string; name: string }[];
  order: string[]; // personIds in the fixed manual order
  codes: { code: string; label: string; countsAsDayOff: boolean }[];
  entries: { personId: string; date: string; code: string }[];
}

/** Build a shareable availability data file (month + chosen people/codes). */
export function buildAvailabilityExport(args: {
  squadronName: string;
  month: string; // yyyy-mm
  people: Person[]; // already in fixed order & pre-filtered
  order: string[];
  codes: AvailabilityCode[];
  entries: AvailabilityEntry[]; // pre-filtered to month/people/codes
}): AvailabilityExport {
  return {
    type: AVAILABILITY_FILE_TYPE,
    version: 1,
    squadronName: args.squadronName,
    month: args.month,
    people: args.people.map((p) => ({ id: p.id, name: p.name })),
    order: args.order,
    codes: args.codes.map((c) => ({
      code: c.code,
      label: c.label,
      countsAsDayOff: c.countsAsDayOff,
    })),
    entries: args.entries.map((e) => ({
      personId: e.personId,
      date: e.date,
      code: e.code,
    })),
  };
}

/** Parse an availability export file; throws on anything unusable. */
export function parseAvailabilityExport(json: string): AvailabilityExport {
  const obj = JSON.parse(json) as Record<string, unknown>;
  if (!obj || typeof obj !== "object" || obj.type !== AVAILABILITY_FILE_TYPE) {
    throw new Error("Not an availability file");
  }
  if (!Array.isArray(obj.entries) || !Array.isArray(obj.people)) {
    throw new Error("Invalid availability file");
  }
  const people: AvailabilityExport["people"] = [];
  for (const raw of obj.people as unknown[]) {
    const p = raw as Record<string, unknown>;
    if (p && typeof p.id === "string" && typeof p.name === "string") {
      people.push({ id: p.id, name: p.name });
    }
  }
  const codes: AvailabilityExport["codes"] = [];
  if (Array.isArray(obj.codes)) {
    for (const raw of obj.codes as unknown[]) {
      const c = raw as Record<string, unknown>;
      if (c && typeof c.code === "string" && sanitizeCode(c.code)) {
        codes.push({
          code: sanitizeCode(c.code),
          label: typeof c.label === "string" ? c.label : sanitizeCode(c.code),
          countsAsDayOff: c.countsAsDayOff === true,
        });
      }
    }
  }
  const entries: AvailabilityExport["entries"] = [];
  for (const raw of obj.entries as unknown[]) {
    const e = raw as Record<string, unknown>;
    if (
      e &&
      typeof e.personId === "string" &&
      isValidISO(e.date) &&
      typeof e.code === "string" &&
      sanitizeCode(e.code)
    ) {
      entries.push({ personId: e.personId, date: e.date, code: sanitizeCode(e.code) });
    }
  }
  return {
    type: AVAILABILITY_FILE_TYPE,
    version: 1,
    squadronName: typeof obj.squadronName === "string" ? obj.squadronName : "",
    month: typeof obj.month === "string" ? obj.month : "",
    people,
    order: Array.isArray(obj.order)
      ? (obj.order as unknown[]).filter((x): x is string => typeof x === "string")
      : [],
    codes,
    entries,
  };
}

export interface MergeResult {
  entries: AvailabilityEntry[];
  codes: AvailabilityCode[];
  /** New fixed order: imported order (mapped to local ids) first, then any locally-ordered people not in the file. */
  order: string[];
  added: number;
  updated: number;
  skipped: number; // entries whose person could not be matched
}

/**
 * Merge an imported availability file into current state. People are matched
 * by id first, then by exact name (trimmed, case-insensitive). Incoming
 * entries win on conflicts (same person + date). Unknown people are skipped —
 * never invented. New codes are added to the dictionary with their imported
 * meaning and day-off flag; for existing codes the imported day-off flag wins
 * so recommendations stay consistent across devices. The imported fixed order
 * is applied for matched people (ahead of locally-ordered people not in the
 * file).
 */
export function mergeAvailability(
  current: {
    people: Person[];
    entries: AvailabilityEntry[];
    codes: AvailabilityCode[];
    order?: string[];
  },
  incoming: AvailabilityExport,
): MergeResult {
  const byId = new Map(current.people.map((p) => [p.id, p]));
  const byName = new Map(
    current.people.map((p) => [p.name.trim().toLowerCase(), p]),
  );
  // imported personId -> local personId
  const idMap = new Map<string, string>();
  for (const ip of incoming.people) {
    const local = byId.get(ip.id) ?? byName.get(ip.name.trim().toLowerCase());
    if (local) idMap.set(ip.id, local.id);
  }

  let codes = current.codes;
  for (const c of incoming.codes) {
    const key = codeKey(c.code);
    const existing = codes.find((x) => codeKey(x.code) === key);
    if (existing) {
      // Incoming wins on the day-off flag so imported data ranks the same way
      // it did on the exporting device. Labels: keep the local edit.
      if (existing.countsAsDayOff !== c.countsAsDayOff) {
        codes = codes.map((x) =>
          x.id === existing.id ? { ...x, countsAsDayOff: c.countsAsDayOff } : x,
        );
      }
    } else {
      const r = ensureCode(codes, c.code, c.label);
      codes = r.codes.map((x) =>
        codeKey(x.code) === key ? { ...x, countsAsDayOff: c.countsAsDayOff } : x,
      );
    }
  }

  const merged = new Map<string, AvailabilityEntry>();
  for (const e of current.entries) merged.set(`${e.personId}|${e.date}`, e);

  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (const e of incoming.entries) {
    const localId = idMap.get(e.personId);
    if (!localId) {
      skipped += 1;
      continue;
    }
    const r = ensureCode(codes, e.code);
    codes = r.codes;
    const key = `${localId}|${e.date}`;
    const prev = merged.get(key);
    if (prev) {
      if (codeKey(prev.code) !== codeKey(r.code)) {
        merged.set(key, { ...prev, code: r.code });
        updated += 1;
      }
    } else {
      merged.set(key, { id: uid(), personId: localId, date: e.date, code: r.code });
      added += 1;
    }
  }

  // Fixed order: imported order (mapped to local ids) first, then anyone in
  // the local order who was not in the file. Unknown ids never enter.
  const order: string[] = [];
  for (const iid of incoming.order) {
    const local = idMap.get(iid);
    if (local && !order.includes(local)) order.push(local);
  }
  for (const id of current.order ?? []) {
    if (byId.has(id) && !order.includes(id)) order.push(id);
  }

  return { entries: [...merged.values()], codes, order, added, updated, skipped };
}
