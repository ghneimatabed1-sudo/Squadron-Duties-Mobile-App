export type SlotRole = "captain" | "copilot";
export type CrewKind = "duty" | "standby";
export type Language = "en" | "ar";

export interface Person {
  id: string;
  name: string;
  role: SlotRole;
  active: boolean;
  createdAt: number;
}

export interface Assignment {
  id: string;
  date: string; // yyyy-mm-dd
  crew: CrewKind; // duty or standby
  role: SlotRole; // captain or copilot
  personId: string;
  activated?: boolean; // standby called in -> counts as duty
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

export interface Settings {
  language: Language;
  squadronName: string; // shown on the roster header, e.g. "8th Squadron"
  windowDays: number; // recent window for fairness balancing
  dutyWeight: number; // weight per weekday duty day
  weekendWeight: number; // weight per weekend duty day
  standbyWeight: number; // weight per activated standby
  specialWeight: number; // weight per special event
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
  settings: Settings;
  version: number;
}

export const DEFAULT_SETTINGS: Settings = {
  language: "en",
  squadronName: "",
  windowDays: 21,
  dutyWeight: 1,
  weekendWeight: 1.5,
  standbyWeight: 1,
  specialWeight: 3,
};

export const DEFAULT_STATE: AppState = {
  people: [],
  assignments: [],
  specials: [],
  locations: [],
  locationDefs: [],
  solos: [],
  splitWeekends: [],
  settings: DEFAULT_SETTINGS,
  version: 1,
};

export function uid(): string {
  return Date.now().toString() + Math.random().toString(36).slice(2, 11);
}
