export type SlotRole = "captain" | "copilot";
export type CrewKind = "duty" | "standby";
export type Language = "en" | "ar";

export interface Person {
  id: string;
  name: string;
  role: SlotRole;
  active: boolean;
  /**
   * A "single cover" person (e.g. a commander who personally takes one specific
   * day) is NEVER picked by auto-fill and never counts toward fairness. They can
   * still be assigned manually to any slot. Normal pilots (false/undefined) are
   * the regular weekday/weekend rotation pool.
   */
  singleCover?: boolean;
  /**
   * ISO date the person joined or last returned from being away. Used to give
   * a newcomer/returner a fair, balanced start: their duties are measured only
   * from this date, so they are never treated as "owed" a pile of catch-up
   * duties just because they have no recent history. Missing = long-established.
   */
  activeSince?: string;
  createdAt: number;
}

export interface Assignment {
  id: string;
  date: string; // yyyy-mm-dd
  crew: CrewKind; // duty or standby
  role: SlotRole; // captain or copilot
  personId: string;
  activated?: boolean; // standby called in -> counts as duty
  /**
   * Which flying crew this duty slot belongs to. 0 / undefined = the base crew
   * (the normal everyday crew). 1, 2, … = EXTRA duty crews on the rare days that
   * need a second (or third) crew up — e.g. 2 captains + 2 co-pilots flying.
   * Standby is always a single crew (index 0). A person can still hold at most
   * one slot per day, so extra crews never double-book anyone.
   */
  crewIndex?: number;
}

export interface SpecialAssignment {
  id: string;
  eventKey: string; // stable key, e.g. independence_day, eid_fitr, custom_xxx
  eventName: string; // display label
  date: string; // yyyy-mm-dd occurrence
  role: SlotRole;
  personId: string;
}

export interface LocationAssignment {
  id: string;
  location: string;
  startDate: string; // yyyy-mm-dd
  endDate: string; // yyyy-mm-dd inclusive
  personId: string;
}

/**
 * A single person covering a whole day on their own (e.g. the commander says
 * "I'll take that day"). This is separate from the two-person crew assignment
 * and NEVER counts toward anyone's fair share.
 */
export interface SoloAssignment {
  id: string;
  date: string; // yyyy-mm-dd
  personId: string;
}

/**
 * A named, reusable location (e.g. "Aqaba") with an optional list of pilots
 * who must never be assigned there. Exclusions are by personId.
 */
export interface LocationDef {
  id: string;
  name: string;
  excluded: string[]; // personIds barred from this location
}

/**
 * One availability mark: a person has a status code on a date (e.g. "SK" on
 * 2026-07-18). At most one entry per (person, date); setting a new code for
 * the same person+date replaces the old one.
 */
export interface AvailabilityEntry {
  id: string;
  personId: string;
  date: string; // yyyy-mm-dd
  code: string; // references AvailabilityCode.code (case-insensitive key)
}

/**
 * A user-managed status code (SK, SL, CR, L, ML, or any custom code/phrase).
 * Once a code has been typed anywhere it is remembered here and reusable.
 */
export interface AvailabilityCode {
  id: string;
  code: string; // short code shown in day boxes, e.g. "SK"
  label: string; // editable meaning, e.g. "Sick"
  /** Counts toward "day off" totals used by the day-off recommendation. */
  countsAsDayOff: boolean;
}

export const DEFAULT_AVAILABILITY_CODES: Omit<AvailabilityCode, "id">[] = [
  { code: "SK", label: "Sick", countsAsDayOff: false },
  { code: "SL", label: "Sick leave", countsAsDayOff: false },
  { code: "CR", label: "Crew rest", countsAsDayOff: false },
  { code: "L", label: "Leave / day off", countsAsDayOff: true },
  { code: "ML", label: "Morning leave", countsAsDayOff: true },
];

export interface Settings {
  language: Language;
  squadronName: string; // shown on the roster header, e.g. "8th Squadron"
  /**
   * Rest gap: minimum free days after any worked night before the rotation
   * queue offers the person again. 1 = never back-to-back (default);
   * 0 = no rest rule. People inside the gap are only used when nobody
   * rested is available.
   */
  restDays: number;
  /** Rest gap after a SPECIAL EVENT duty (0–7). */
  restDaysSpecial: number;
  /** Rest gap after a LOCATION stint ends (0–7). */
  restDaysLocation: number;
}

export interface AppState {
  people: Person[];
  assignments: Assignment[];
  specials: SpecialAssignment[];
  locations: LocationAssignment[];
  locationDefs: LocationDef[];
  solos: SoloAssignment[];
  /**
   * Weekend keys (the Thursday ISO date of a weekend) that are in SPLIT mode —
   * each weekend day gets its own crew. Weekends NOT listed here are blocks:
   * one crew covers the whole weekend (Thu–Fri–Sat) as a single duty.
   */
  splitWeekends: string[];
  /**
   * Per-day count of EXTRA duty crews beyond the normal one (keyed by yyyy-mm-dd).
   * Missing / 0 = the usual single duty crew. A value of 1 means the day flies
   * two duty crews that day, etc. Standby is unaffected. Persisted so an added
   * (even still-empty) extra crew survives reload and is filled by auto-fill.
   */
  extraCrews: Record<string, number>;
  /** Daily availability marks (one per person per day). */
  availability: AvailabilityEntry[];
  /** Every status code the app has seen; user-editable dictionary. */
  availabilityCodes: AvailabilityCode[];
  /**
   * FIXED manual display order for the roster (array of personIds). People not
   * listed here (e.g. newly added) go after the listed ones, oldest first.
   * Used by every availability view and export — never auto-sorted.
   */
  rosterOrder: string[];
  settings: Settings;
  version: number;
}

export const DEFAULT_SETTINGS: Settings = {
  language: "en",
  squadronName: "",
  restDays: 1,
  restDaysSpecial: 1,
  restDaysLocation: 1,
};

export const DEFAULT_STATE: AppState = {
  people: [],
  assignments: [],
  specials: [],
  locations: [],
  locationDefs: [],
  solos: [],
  splitWeekends: [],
  extraCrews: {},
  availability: [],
  availabilityCodes: [],
  rosterOrder: [],
  settings: DEFAULT_SETTINGS,
  version: 1,
};

/** Hard cap on extra duty crews per day (so total duty crews <= 1 + this). */
export const MAX_EXTRA_CREWS = 3;

export function uid(): string {
  return Date.now().toString() + Math.random().toString(36).slice(2, 11);
}
