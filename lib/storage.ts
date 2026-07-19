import AsyncStorage from "@react-native-async-storage/async-storage";

import { codeKey, defaultCodes, sanitizeCode } from "./availability";
import { isValidISO, isWeekend, weekendDates } from "./dates";
import {
  AppState,
  AvailabilityCode,
  AvailabilityEntry,
  Assignment,
  CrewKind,
  DEFAULT_SETTINGS,
  Language,
  LocationAssignment,
  LocationDef,
  MAX_EXTRA_CREWS,
  Person,
  Settings,
  SlotRole,
  SoloAssignment,
  SpecialAssignment,
  uid,
} from "./types";

const KEY = "squadron_duty_state_v1";

export async function loadState(): Promise<AppState | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    return normalize(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function saveState(state: AppState): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // ignore write errors; data stays in memory for this session
  }
}

// ---------------- validators ----------------

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const isRole = (v: unknown): v is SlotRole =>
  v === "captain" || v === "copilot";
const isCrew = (v: unknown): v is CrewKind => v === "duty" || v === "standby";
const isNonEmptyStr = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;
const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

function num(v: unknown, fallback: number, min: number, max: number): number {
  if (!isNum(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

function parsePerson(v: unknown): Person | null {
  if (!isObj(v)) return null;
  if (!isNonEmptyStr(v.id) || !isNonEmptyStr(v.name) || !isRole(v.role)) {
    return null;
  }
  return {
    id: v.id,
    name: v.name,
    role: v.role,
    active: typeof v.active === "boolean" ? v.active : true,
    singleCover: v.singleCover === true,
    availabilityOnly: v.availabilityOnly === true,
    activeSince: isValidISO(v.activeSince) ? v.activeSince : undefined,
    createdAt: isNum(v.createdAt) ? v.createdAt : Date.now(),
  };
}

function parseAssignment(v: unknown, peopleIds: Set<string>): Assignment | null {
  if (!isObj(v)) return null;
  if (
    !isNonEmptyStr(v.id) ||
    !isValidISO(v.date) ||
    !isCrew(v.crew) ||
    !isRole(v.role) ||
    !isNonEmptyStr(v.personId) ||
    !peopleIds.has(v.personId)
  ) {
    return null;
  }
  const a: Assignment = {
    id: v.id,
    date: v.date,
    crew: v.crew,
    role: v.role,
    personId: v.personId,
  };
  if (v.crew === "standby") a.activated = v.activated === true;
  // Extra duty crews (crewIndex >= 1) only apply to duty slots; standby is
  // always a single crew. Clamp to a sane integer range.
  if (v.crew === "duty" && isNum(v.crewIndex)) {
    const idx = Math.floor(v.crewIndex);
    if (idx >= 1 && idx <= MAX_EXTRA_CREWS) a.crewIndex = idx;
  }
  return a;
}

function parseSpecial(
  v: unknown,
  peopleIds: Set<string>,
): SpecialAssignment | null {
  if (!isObj(v)) return null;
  if (
    !isNonEmptyStr(v.id) ||
    !isNonEmptyStr(v.eventKey) ||
    !isNonEmptyStr(v.eventName) ||
    !isValidISO(v.date) ||
    !isRole(v.role) ||
    !isNonEmptyStr(v.personId) ||
    !peopleIds.has(v.personId)
  ) {
    return null;
  }
  return {
    id: v.id,
    eventKey: v.eventKey,
    eventName: v.eventName,
    date: v.date,
    role: v.role,
    personId: v.personId,
  };
}

function parseLocation(
  v: unknown,
  peopleIds: Set<string>,
): LocationAssignment | null {
  if (!isObj(v)) return null;
  if (
    !isNonEmptyStr(v.id) ||
    !isNonEmptyStr(v.location) ||
    !isValidISO(v.startDate) ||
    !isValidISO(v.endDate) ||
    v.endDate < v.startDate ||
    !isNonEmptyStr(v.personId) ||
    !peopleIds.has(v.personId)
  ) {
    return null;
  }
  return {
    id: v.id,
    location: v.location,
    startDate: v.startDate,
    endDate: v.endDate,
    personId: v.personId,
  };
}

function parseLocationDef(
  v: unknown,
  peopleIds: Set<string>,
): LocationDef | null {
  if (!isObj(v)) return null;
  if (!isNonEmptyStr(v.id) || !isNonEmptyStr(v.name)) return null;
  const excluded: string[] = [];
  if (Array.isArray(v.excluded)) {
    for (const e of v.excluded) {
      if (isNonEmptyStr(e) && peopleIds.has(e) && !excluded.includes(e)) {
        excluded.push(e);
      }
    }
  }
  return { id: v.id, name: v.name, excluded };
}

function parseSolo(
  v: unknown,
  peopleIds: Set<string>,
): SoloAssignment | null {
  if (!isObj(v)) return null;
  if (
    !isNonEmptyStr(v.id) ||
    !isValidISO(v.date) ||
    !isNonEmptyStr(v.personId) ||
    !peopleIds.has(v.personId)
  ) {
    return null;
  }
  return { id: v.id, date: v.date, personId: v.personId };
}

function parseAvailabilityEntry(
  v: unknown,
  peopleIds: Set<string>,
): AvailabilityEntry | null {
  if (!isObj(v)) return null;
  if (
    !isValidISO(v.date) ||
    !isNonEmptyStr(v.personId) ||
    !peopleIds.has(v.personId) ||
    typeof v.code !== "string"
  ) {
    return null;
  }
  const code = sanitizeCode(v.code);
  if (!code) return null;
  return {
    id: isNonEmptyStr(v.id) ? v.id : uid(),
    personId: v.personId,
    date: v.date,
    code,
  };
}

function parseAvailabilityCode(v: unknown): AvailabilityCode | null {
  if (!isObj(v)) return null;
  if (typeof v.code !== "string") return null;
  const code = sanitizeCode(v.code);
  if (!code) return null;
  return {
    id: isNonEmptyStr(v.id) ? v.id : uid(),
    code,
    label:
      typeof v.label === "string" && v.label.trim()
        ? v.label.trim().slice(0, 60)
        : code,
    countsAsDayOff: v.countsAsDayOff === true,
  };
}

function parseSettings(v: unknown): Settings {
  const s = isObj(v) ? v : {};
  const language: Language = s.language === "ar" ? "ar" : "en";
  return {
    language,
    squadronName:
      typeof s.squadronName === "string" ? s.squadronName.slice(0, 60) : "",
    // Old backups (weight-based engine) simply fall back to the default rest
    // gap — their extra weight fields are dropped here.
    restDays: Math.round(num(s.restDays, DEFAULT_SETTINGS.restDays, 0, 7)),
    // Backups from before the per-kind gaps inherit the general rest gap so
    // behaviour is unchanged until the user adjusts them.
    restDaysSpecial: Math.round(
      num(
        s.restDaysSpecial,
        Math.round(num(s.restDays, DEFAULT_SETTINGS.restDaysSpecial, 0, 7)),
        0,
        7,
      ),
    ),
    restDaysLocation: Math.round(
      num(
        s.restDaysLocation,
        Math.round(num(s.restDays, DEFAULT_SETTINGS.restDaysLocation, 0, 7)),
        0,
        7,
      ),
    ),
  };
}

/**
 * Validate + coerce an arbitrary object (e.g. an imported file) into AppState.
 * Every entity is strictly validated; malformed records are dropped (and
 * references to unknown people are rejected) so corrupt data can never enter
 * persisted state and distort the fairness engine over time.
 */
export function normalize(obj: unknown): AppState {
  if (!isObj(obj)) throw new Error("Invalid data");
  if (!Array.isArray(obj.people) || !Array.isArray(obj.assignments)) {
    throw new Error("Invalid data");
  }

  const people: Person[] = [];
  const seenIds = new Set<string>();
  for (const raw of obj.people) {
    const p = parsePerson(raw);
    if (p && !seenIds.has(p.id)) {
      seenIds.add(p.id);
      people.push(p);
    }
  }
  const peopleIds = seenIds;

  const assignments: Assignment[] = [];
  const slotKeys = new Set<string>();
  for (const raw of obj.assignments) {
    const a = parseAssignment(raw, peopleIds);
    if (!a) continue;
    // one person per (date, crew, role, crewIndex) slot
    const key = `${a.date}|${a.crew}|${a.role}|${a.crewIndex ?? 0}`;
    if (slotKeys.has(key)) continue;
    slotKeys.add(key);
    assignments.push(a);
  }

  const specials: SpecialAssignment[] = [];
  if (Array.isArray(obj.specials)) {
    for (const raw of obj.specials) {
      const s = parseSpecial(raw, peopleIds);
      if (s) specials.push(s);
    }
  }

  const locations: LocationAssignment[] = [];
  if (Array.isArray(obj.locations)) {
    for (const raw of obj.locations) {
      const l = parseLocation(raw, peopleIds);
      if (l) locations.push(l);
    }
  }

  const locationDefs: LocationDef[] = [];
  const defIds = new Set<string>();
  const defNames = new Set<string>();
  if (Array.isArray(obj.locationDefs)) {
    for (const raw of obj.locationDefs) {
      const d = parseLocationDef(raw, peopleIds);
      if (!d) continue;
      const nameKey = d.name.trim().toLowerCase();
      if (defIds.has(d.id) || defNames.has(nameKey)) continue;
      defIds.add(d.id);
      defNames.add(nameKey);
      locationDefs.push(d);
    }
  }

  const solos: SoloAssignment[] = [];
  const soloDates = new Set<string>();
  if (Array.isArray(obj.solos)) {
    for (const raw of obj.solos) {
      const so = parseSolo(raw, peopleIds);
      if (!so) continue;
      // one single-person cover per day
      if (soloDates.has(so.date)) continue;
      soloDates.add(so.date);
      solos.push(so);
    }
  }

  const splitWeekends: string[] = [];
  const seenWeekends = new Set<string>();
  if (Array.isArray(obj.splitWeekends)) {
    for (const raw of obj.splitWeekends) {
      if (!isValidISO(raw) || !isWeekend(raw)) continue;
      // Canonicalize to the weekend's reference (Thursday) key so lookups via
      // isWeekendSplit(weekendDates(date)[0]) always match, regardless of which
      // weekend day was persisted.
      const key = weekendDates(raw)[0];
      if (seenWeekends.has(key)) continue;
      seenWeekends.add(key);
      splitWeekends.push(key);
    }
  }

  // Per-day extra duty crew counts (date -> n). Drop malformed keys/values and
  // clamp counts to the allowed range; 0/negative entries are simply omitted.
  const extraCrews: Record<string, number> = {};
  if (isObj(obj.extraCrews)) {
    for (const [date, raw] of Object.entries(obj.extraCrews)) {
      if (!isValidISO(date) || !isNum(raw)) continue;
      const n = Math.min(MAX_EXTRA_CREWS, Math.floor(raw));
      if (n >= 1) extraCrews[date] = n;
    }
  }

  // Availability code dictionary: dedupe by case-insensitive code. Old
  // backups without codes get the standard seed set.
  const availabilityCodes: AvailabilityCode[] = [];
  const codeKeys = new Set<string>();
  if (Array.isArray(obj.availabilityCodes)) {
    for (const raw of obj.availabilityCodes) {
      const c = parseAvailabilityCode(raw);
      if (!c) continue;
      const k = codeKey(c.code);
      if (codeKeys.has(k)) continue;
      codeKeys.add(k);
      availabilityCodes.push(c);
    }
  }
  if (availabilityCodes.length === 0) {
    for (const c of defaultCodes()) {
      availabilityCodes.push(c);
      codeKeys.add(codeKey(c.code));
    }
  }
  // Migration: older installs predate the standard "AL" (annual leave) code.
  if (!codeKeys.has(codeKey("AL"))) {
    availabilityCodes.push({
      id: uid(),
      code: "AL",
      label: "Annual leave",
      countsAsDayOff: true,
    });
    codeKeys.add(codeKey("AL"));
  }

  // Availability marks: one per (person, date); ensure every referenced code
  // exists in the dictionary so it stays reusable.
  const availability: AvailabilityEntry[] = [];
  const availKeys = new Set<string>();
  if (Array.isArray(obj.availability)) {
    for (const raw of obj.availability) {
      const e = parseAvailabilityEntry(raw, peopleIds);
      if (!e) continue;
      const key = `${e.personId}|${e.date}`;
      if (availKeys.has(key)) continue;
      availKeys.add(key);
      availability.push(e);
      const ck = codeKey(e.code);
      if (!codeKeys.has(ck)) {
        codeKeys.add(ck);
        availabilityCodes.push({
          id: uid(),
          code: e.code,
          label: e.code,
          countsAsDayOff: false,
        });
      }
    }
  }

  // Fixed manual roster order: known, unique person ids only.
  const rosterOrder: string[] = [];
  if (Array.isArray(obj.rosterOrder)) {
    for (const raw of obj.rosterOrder) {
      if (isNonEmptyStr(raw) && peopleIds.has(raw) && !rosterOrder.includes(raw)) {
        rosterOrder.push(raw);
      }
    }
  }

  return {
    people,
    assignments,
    specials,
    locations,
    locationDefs,
    solos,
    splitWeekends,
    extraCrews,
    availability,
    availabilityCodes,
    rosterOrder,
    settings: parseSettings(obj.settings),
    version: 1,
  };
}
