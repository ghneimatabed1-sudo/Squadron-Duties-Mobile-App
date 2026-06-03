import AsyncStorage from "@react-native-async-storage/async-storage";

import { isValidISO, isWeekend, weekendDates } from "./dates";
import {
  AppState,
  Assignment,
  CrewKind,
  DEFAULT_SETTINGS,
  Language,
  LocationAssignment,
  LocationDef,
  Person,
  Settings,
  SlotRole,
  SoloAssignment,
  SpecialAssignment,
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

function parseSettings(v: unknown): Settings {
  const s = isObj(v) ? v : {};
  const language: Language = s.language === "ar" ? "ar" : "en";
  return {
    language,
    squadronName:
      typeof s.squadronName === "string" ? s.squadronName.slice(0, 60) : "",
    windowDays: Math.round(num(s.windowDays, DEFAULT_SETTINGS.windowDays, 7, 90)),
    dutyWeight: num(s.dutyWeight, DEFAULT_SETTINGS.dutyWeight, 0.5, 10),
    weekendWeight: num(s.weekendWeight, DEFAULT_SETTINGS.weekendWeight, 0.5, 10),
    standbyWeight: num(s.standbyWeight, DEFAULT_SETTINGS.standbyWeight, 0.5, 10),
    specialWeight: num(s.specialWeight, DEFAULT_SETTINGS.specialWeight, 0.5, 10),
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
    // one person per (date, crew, role) slot
    const key = `${a.date}|${a.crew}|${a.role}`;
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

  return {
    people,
    assignments,
    specials,
    locations,
    locationDefs,
    solos,
    splitWeekends,
    settings: parseSettings(obj.settings),
    version: 1,
  };
}
