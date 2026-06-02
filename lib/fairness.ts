import { inWindow, isWeekend } from "./dates";
import {
  Assignment,
  LocationAssignment,
  Person,
  Settings,
  SlotRole,
  SpecialAssignment,
} from "./types";

export interface Load {
  personId: string;
  weighted: number;
  dutyDays: number;
  weekendDuty: number;
  standbyActivated: number;
  specials: number;
  lastDutyDate: string | null;
}

function emptyLoad(personId: string): Load {
  return {
    personId,
    weighted: 0,
    dutyDays: 0,
    weekendDuty: 0,
    standbyActivated: 0,
    specials: 0,
    lastDutyDate: null,
  };
}

/**
 * Weighted load per active person in a role pool over a recent window.
 * Always recomputed from full history — never from running tallies.
 */
export function computeLoads(
  people: Person[],
  assignments: Assignment[],
  specials: SpecialAssignment[],
  settings: Settings,
  role: SlotRole,
  refDate: string,
): Map<string, Load> {
  const map = new Map<string, Load>();
  for (const p of people) {
    if (p.role === role && p.active) map.set(p.id, emptyLoad(p.id));
  }

  for (const a of assignments) {
    if (a.role !== role) continue;
    const l = map.get(a.personId);
    if (!l) continue;
    const within = inWindow(a.date, refDate, settings.windowDays);
    if (a.crew === "duty") {
      if (within) {
        const wknd = isWeekend(a.date);
        l.weighted += wknd ? settings.weekendWeight : settings.dutyWeight;
        l.dutyDays += 1;
        if (wknd) l.weekendDuty += 1;
      }
      if (!l.lastDutyDate || a.date > l.lastDutyDate) l.lastDutyDate = a.date;
    } else if (a.crew === "standby" && a.activated) {
      if (within) {
        l.weighted += settings.standbyWeight;
        l.standbyActivated += 1;
      }
      if (!l.lastDutyDate || a.date > l.lastDutyDate) l.lastDutyDate = a.date;
    }
  }

  for (const s of specials) {
    if (s.role !== role) continue;
    const l = map.get(s.personId);
    if (!l) continue;
    if (inWindow(s.date, refDate, settings.windowDays)) {
      l.weighted += settings.specialWeight;
      l.specials += 1;
    }
  }

  return map;
}

export function fairShare(loads: Map<string, Load>): number {
  if (loads.size === 0) return 0;
  let total = 0;
  loads.forEach((l) => {
    total += l.weighted;
  });
  return total / loads.size;
}

export interface Candidate {
  person: Person;
  load: number;
  balance: number; // load - fairShare (negative = owed, positive = ahead)
  lastDutyDate: string | null;
  eligible: boolean;
  reasonKey?: "reason_inactive" | "reason_double_booked";
  eventCount?: number;
}

/**
 * Ranked candidates for an open duty/standby slot.
 * Most "owed" person (lowest load), then longest since last duty, then name.
 */
export function recommendForSlot(
  people: Person[],
  assignments: Assignment[],
  specials: SpecialAssignment[],
  settings: Settings,
  role: SlotRole,
  date: string,
  refDate: string,
): Candidate[] {
  const loads = computeLoads(
    people,
    assignments,
    specials,
    settings,
    role,
    refDate,
  );
  const share = fairShare(loads);
  const bookedSameDay = new Set(
    assignments.filter((a) => a.date === date).map((a) => a.personId),
  );

  const list: Candidate[] = people
    .filter((p) => p.role === role)
    .map((p) => {
      const l = loads.get(p.id);
      const load = l ? l.weighted : 0;
      let eligible = true;
      let reasonKey: Candidate["reasonKey"];
      if (!p.active) {
        eligible = false;
        reasonKey = "reason_inactive";
      } else if (bookedSameDay.has(p.id)) {
        eligible = false;
        reasonKey = "reason_double_booked";
      }
      return {
        person: p,
        load,
        balance: load - share,
        lastDutyDate: l?.lastDutyDate ?? null,
        eligible,
        reasonKey,
      };
    });

  list.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    if (a.load !== b.load) return a.load - b.load;
    const la = a.lastDutyDate ?? "0";
    const lb = b.lastDutyDate ?? "0";
    if (la !== lb) return la < lb ? -1 : 1;
    return a.person.name.localeCompare(b.person.name);
  });

  return list;
}

/**
 * Ranked candidates for a special event, rotating year-over-year:
 * fewest times worked this event first, then longest ago, then overall load.
 */
export function recommendForSpecial(
  people: Person[],
  assignments: Assignment[],
  specials: SpecialAssignment[],
  settings: Settings,
  role: SlotRole,
  eventKey: string,
  refDate: string,
): Candidate[] {
  const loads = computeLoads(
    people,
    assignments,
    specials,
    settings,
    role,
    refDate,
  );
  const share = fairShare(loads);

  const counts = new Map<string, number>();
  const last = new Map<string, string>();
  for (const s of specials) {
    if (s.eventKey !== eventKey || s.role !== role) continue;
    counts.set(s.personId, (counts.get(s.personId) ?? 0) + 1);
    const cur = last.get(s.personId);
    if (!cur || s.date > cur) last.set(s.personId, s.date);
  }

  const list: Candidate[] = people
    .filter((p) => p.role === role)
    .map((p) => {
      const l = loads.get(p.id);
      const load = l ? l.weighted : 0;
      return {
        person: p,
        load,
        balance: load - share,
        lastDutyDate: last.get(p.id) ?? null,
        eligible: p.active,
        reasonKey: p.active
          ? undefined
          : ("reason_inactive" as Candidate["reasonKey"]),
        eventCount: counts.get(p.id) ?? 0,
      };
    });

  list.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    const ca = a.eventCount ?? 0;
    const cb = b.eventCount ?? 0;
    if (ca !== cb) return ca - cb;
    const la = a.lastDutyDate ?? "0";
    const lb = b.lastDutyDate ?? "0";
    if (la !== lb) return la < lb ? -1 : 1;
    if (a.load !== b.load) return a.load - b.load;
    return a.person.name.localeCompare(b.person.name);
  });

  return list;
}

export interface LocationCandidate {
  person: Person;
  count: number;
  lastDate: string | null;
}

/**
 * Location duty rotation: fewest location duties first, then longest ago.
 * Any active person can take location duty (separate from daily roles).
 */
export function recommendForLocation(
  people: Person[],
  locations: LocationAssignment[],
  excludedIds?: Set<string>,
): LocationCandidate[] {
  const counts = new Map<string, number>();
  const last = new Map<string, string>();
  for (const loc of locations) {
    counts.set(loc.personId, (counts.get(loc.personId) ?? 0) + 1);
    const cur = last.get(loc.personId);
    if (!cur || loc.endDate > cur) last.set(loc.personId, loc.endDate);
  }

  const list: LocationCandidate[] = people
    .filter((p) => p.active && !(excludedIds && excludedIds.has(p.id)))
    .map((p) => ({
      person: p,
      count: counts.get(p.id) ?? 0,
      lastDate: last.get(p.id) ?? null,
    }));

  list.sort((a, b) => {
    if (a.count !== b.count) return a.count - b.count;
    const la = a.lastDate ?? "0";
    const lb = b.lastDate ?? "0";
    if (la !== lb) return la < lb ? -1 : 1;
    return a.person.name.localeCompare(b.person.name);
  });

  return list;
}

export interface SwapPreview {
  outBefore: number | null;
  outAfter: number | null;
  inBefore: number | null;
  inAfter: number | null;
  changes: boolean;
}

/**
 * Simulate replacing the current occupant of a slot with a new person and
 * report each person's balance before and after — so impact is shown before
 * the user confirms.
 */
export function previewSwap(
  people: Person[],
  assignments: Assignment[],
  specials: SpecialAssignment[],
  settings: Settings,
  role: SlotRole,
  date: string,
  crew: "duty" | "standby",
  outPersonId: string | null,
  inPersonId: string,
  refDate: string,
): SwapPreview {
  const next = assignments.filter(
    (a) => !(a.date === date && a.crew === crew && a.role === role),
  );
  // Preserve activation state when swapping a standby occupant.
  const prevSlot = assignments.find(
    (a) => a.date === date && a.crew === crew && a.role === role,
  );
  next.push({
    id: "preview",
    date,
    crew,
    role,
    personId: inPersonId,
    activated: crew === "standby" ? prevSlot?.activated : undefined,
  });

  const before = computeLoads(
    people,
    assignments,
    specials,
    settings,
    role,
    refDate,
  );
  const after = computeLoads(people, next, specials, settings, role, refDate);
  const shareBefore = fairShare(before);
  const shareAfter = fairShare(after);

  const bal = (
    m: Map<string, Load>,
    share: number,
    id: string | null,
  ): number | null => {
    if (!id) return null;
    const l = m.get(id);
    if (!l) return null;
    return l.weighted - share;
  };

  const outBefore = bal(before, shareBefore, outPersonId);
  const outAfter = bal(after, shareAfter, outPersonId);
  const inBefore = bal(before, shareBefore, inPersonId);
  const inAfter = bal(after, shareAfter, inPersonId);

  const changes =
    Math.abs((inAfter ?? 0) - (inBefore ?? 0)) > 0.0001 ||
    Math.abs((outAfter ?? 0) - (outBefore ?? 0)) > 0.0001;

  return { outBefore, outAfter, inBefore, inAfter, changes };
}

export interface PersonTotals {
  person: Person;
  duty: number;
  weekendDuty: number;
  standby: number;
  special: number;
  location: number;
  weighted: number;
  balance: number;
}

export function computeTotals(
  people: Person[],
  assignments: Assignment[],
  specials: SpecialAssignment[],
  locations: LocationAssignment[],
  settings: Settings,
  windowDays: number,
  role: SlotRole,
  refDate: string,
): PersonTotals[] {
  const winSettings: Settings = { ...settings, windowDays };
  const loads = computeLoads(
    people,
    assignments,
    specials,
    winSettings,
    role,
    refDate,
  );
  const share = fairShare(loads);

  const locCount = new Map<string, number>();
  for (const loc of locations) {
    if (inWindow(loc.startDate, refDate, windowDays)) {
      locCount.set(loc.personId, (locCount.get(loc.personId) ?? 0) + 1);
    }
  }

  return people
    .filter((p) => p.role === role && p.active)
    .map((p) => {
      const l = loads.get(p.id);
      return {
        person: p,
        duty: l?.dutyDays ?? 0,
        weekendDuty: l?.weekendDuty ?? 0,
        standby: l?.standbyActivated ?? 0,
        special: l?.specials ?? 0,
        location: locCount.get(p.id) ?? 0,
        weighted: l?.weighted ?? 0,
        balance: (l?.weighted ?? 0) - share,
      };
    })
    .sort((a, b) => a.balance - b.balance || a.person.name.localeCompare(b.person.name));
}
