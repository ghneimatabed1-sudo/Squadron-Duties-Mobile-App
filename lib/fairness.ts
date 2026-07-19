import { diffDays, eachDay, isWeekend } from "./dates";
import {
  Assignment,
  CrewKind,
  LocationAssignment,
  Person,
  Settings,
  SlotRole,
  SpecialAssignment,
} from "./types";

/**
 * ROTATION QUEUE ENGINE
 *
 * The schedule works like a paper duty list: whoever has waited LONGEST since
 * their last turn is next. There are three independent queues per role:
 *
 *   - weekday duty queue
 *   - weekend duty queue
 *   - standby queue
 *
 * so weekday and weekend turns rotate fairly on their own — a heavy weekend
 * never exempts anyone from weekdays, and vice versa.
 *
 * Real work sends you to the back of the line:
 *   - a weekday duty  -> back of the weekday queue
 *   - a weekend duty  -> back of the weekend queue
 *   - a standby night -> back of the standby queue
 *   - a location stint or special event -> back of BOTH duty queues
 *     (it is real, planned work — the person just served)
 *   - joining / returning to the squadron (activeSince) -> back of every
 *     queue as of that day, so newcomers are never hammered to "catch up"
 *
 * On top of the queues there is the REST GAP rule, now adjustable per kind of
 * work: settings.restDays (after a normal duty/standby night),
 * settings.restDaysSpecial (after a special-event duty) and
 * settings.restDaysLocation (after a location stint). Someone who worked
 * within the matching gap of the slot is "resting" and is only picked when
 * nobody rested is available — never silently preferred. That is what stops
 * back-to-back and every-other-day duty.
 */

export interface QueueStats {
  personId: string;
  /** Effective last turn in each queue (already includes activeSince, locations, specials). */
  lastWeekday: string | null;
  lastWeekend: string | null;
  lastStandby: string | null;
  /** Real counts since the person joined/returned (for tiebreaks + display). */
  weekdayCount: number;
  weekendCount: number;
  standbyCount: number;
  /** Every date the person is committed (duty, standby, special, location day) — for the rest rule. */
  workedDates: Set<string>;
  /** Normal duty/standby nights only — rest gap = settings.restDays. */
  dutyDates: Set<string>;
  /** Special-event duty days — rest gap = settings.restDaysSpecial. */
  specialDates: Set<string>;
  /** Location stint days — rest gap = settings.restDaysLocation. */
  locationDates: Set<string>;
}

function later(a: string | null, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a > b ? a : b;
}

/**
 * Queue positions per active person in a role pool, recomputed from the full
 * saved history every time — never from running tallies.
 *
 * When `asOf` is given, only work on or before that date moves people back in
 * the queues (so recommendations for an earlier day are never polluted by
 * already-planned FUTURE weeks). `workedDates` still includes future days so
 * the rest rule can protect the nights right before a planned duty.
 */
export function computeQueueStats(
  people: Person[],
  assignments: Assignment[],
  specials: SpecialAssignment[],
  locations: LocationAssignment[],
  role: SlotRole,
  asOf?: string,
): Map<string, QueueStats> {
  const map = new Map<string, QueueStats>();
  const joinById = new Map<string, string | undefined>();
  for (const p of people) {
    // Single-cover people are outside the rotation entirely.
    if (p.role === role && p.active && !p.singleCover && !p.availabilityOnly) {
      map.set(p.id, {
        personId: p.id,
        // Joining/returning puts you at the back of every line as of that day.
        lastWeekday: p.activeSince ?? null,
        lastWeekend: p.activeSince ?? null,
        lastStandby: p.activeSince ?? null,
        weekdayCount: 0,
        weekendCount: 0,
        standbyCount: 0,
        workedDates: new Set<string>(),
        dutyDates: new Set<string>(),
        specialDates: new Set<string>(),
        locationDates: new Set<string>(),
      });
      joinById.set(p.id, p.activeSince);
    }
  }

  for (const a of assignments) {
    if (a.role !== role) continue;
    const q = map.get(a.personId);
    if (!q) continue;
    const since = joinById.get(a.personId);
    if (since && a.date < since) continue; // before they joined/returned
    q.workedDates.add(a.date);
    q.dutyDates.add(a.date);
    if (asOf && a.date > asOf) continue; // future work never moves the queue
    if (a.crew === "duty") {
      if (isWeekend(a.date)) {
        q.lastWeekend = later(q.lastWeekend, a.date);
        q.weekendCount += 1;
      } else {
        q.lastWeekday = later(q.lastWeekday, a.date);
        q.weekdayCount += 1;
      }
    } else if (a.crew === "standby") {
      q.lastStandby = later(q.lastStandby, a.date);
      q.standbyCount += 1;
    }
  }

  // Specials are real work: they send the person to the back of both duty
  // queues (and count for the rest rule).
  for (const s of specials) {
    if (s.role !== role) continue;
    const q = map.get(s.personId);
    if (!q) continue;
    const since = joinById.get(s.personId);
    if (since && s.date < since) continue;
    q.workedDates.add(s.date);
    q.specialDates.add(s.date);
    if (asOf && s.date > asOf) continue;
    q.lastWeekday = later(q.lastWeekday, s.date);
    q.lastWeekend = later(q.lastWeekend, s.date);
  }

  // A location stint is real work too: when it ends, the person rejoins at the
  // back of both duty queues — exactly like anyone who just served — instead
  // of being exempted for a whole week.
  for (const loc of locations) {
    const q = map.get(loc.personId);
    if (!q) continue;
    const since = joinById.get(loc.personId);
    for (const d of eachDay(loc.startDate, loc.endDate)) {
      if (since && d < since) continue;
      q.workedDates.add(d);
      q.locationDates.add(d);
    }
    if ((!since || loc.endDate >= since) && !(asOf && loc.endDate > asOf)) {
      q.lastWeekday = later(q.lastWeekday, loc.endDate);
      q.lastWeekend = later(q.lastWeekend, loc.endDate);
    }
  }

  return map;
}

export interface Candidate {
  person: Person;
  /**
   * Days since this person's last turn in THIS queue (weekday / weekend /
   * standby), relative to the slot date. null = never served (front of line).
   */
  waitDays: number | null;
  /** The date of their effective last turn in this queue (null = never). */
  lastDutyDate: string | null;
  /** Real turns taken in this queue since joining (tiebreak + display). */
  queueCount: number;
  /**
   * True when the person worked within `restDays` of the slot date. Resting
   * people stay selectable but rank BELOW everyone rested, so auto-fill only
   * uses them when nobody else is available.
   */
  resting: boolean;
  eligible: boolean;
  reasonKey?:
    | "reason_inactive"
    | "reason_double_booked"
    | "reason_busy"
    | "reason_location_excluded";
  eventCount?: number;
  /** True for single-cover people: selectable manually, but never auto-filled. */
  singleCover?: boolean;
}

/**
 * Ranked candidates for an open duty/standby slot — pure queue order:
 * longest wait since last turn in this queue first, rested before resting,
 * fewest turns as tiebreak, then name.
 */
export function recommendForSlot(
  people: Person[],
  assignments: Assignment[],
  specials: SpecialAssignment[],
  locations: LocationAssignment[],
  settings: Settings,
  role: SlotRole,
  date: string,
  crew: CrewKind = "duty",
): Candidate[] {
  const stats = computeQueueStats(
    people, assignments, specials, locations, role, date,
  );
  const slotIsWeekend = isWeekend(date);

  const bookedSameDay = new Set(
    assignments.filter((a) => a.date === date).map((a) => a.personId),
  );
  // People already committed to a special event or a location stint on this day
  // are unavailable for normal duty — hard-blocked so auto-fill (and the manual
  // picker) can never double-book a planned crew.
  const busySameDay = new Set<string>([
    ...specials.filter((s) => s.date === date).map((s) => s.personId),
    ...locations
      .filter((loc) => date >= loc.startDate && date <= loc.endDate)
      .map((loc) => loc.personId),
  ]);

  // Each kind of work has its own adjustable rest gap.
  const restDays = Math.max(0, Math.floor(settings.restDays));
  const restSpecial = Math.max(0, Math.floor(settings.restDaysSpecial));
  const restLocation = Math.max(0, Math.floor(settings.restDaysLocation));
  const withinGap = (dates: Set<string>, gapDays: number): boolean => {
    if (gapDays === 0) return false;
    for (const d of dates) {
      const gap = Math.abs(diffDays(date, d));
      if (gap > 0 && gap <= gapDays) return true;
    }
    return false;
  };
  const isResting = (q: QueueStats | undefined): boolean => {
    if (!q) return false;
    return (
      withinGap(q.dutyDates, restDays) ||
      withinGap(q.specialDates, restSpecial) ||
      withinGap(q.locationDates, restLocation)
    );
  };

  const list: Candidate[] = people
    .filter((p) => p.role === role && !p.availabilityOnly)
    .map((p) => {
      const q = stats.get(p.id);
      const lastDutyDate = q
        ? crew === "standby"
          ? q.lastStandby
          : slotIsWeekend
            ? q.lastWeekend
            : q.lastWeekday
        : null;
      const queueCount = q
        ? crew === "standby"
          ? q.standbyCount
          : slotIsWeekend
            ? q.weekendCount
            : q.weekdayCount
        : 0;
      let eligible = true;
      let reasonKey: Candidate["reasonKey"];
      if (!p.active) {
        eligible = false;
        reasonKey = "reason_inactive";
      } else if (bookedSameDay.has(p.id)) {
        eligible = false;
        reasonKey = "reason_double_booked";
      } else if (busySameDay.has(p.id)) {
        eligible = false;
        reasonKey = "reason_busy";
      }
      return {
        person: p,
        waitDays: lastDutyDate ? diffDays(date, lastDutyDate) : null,
        lastDutyDate,
        queueCount,
        resting: eligible && isResting(q),
        eligible,
        reasonKey,
        singleCover: p.singleCover === true,
      };
    });

  list.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    // Normal pilots rank above single-cover people, so auto-fill and the
    // "recommended" hint always prefer the regular rotation.
    if (!!a.singleCover !== !!b.singleCover) return a.singleCover ? 1 : -1;
    // Rested people always come before people inside the rest gap.
    if (a.resting !== b.resting) return a.resting ? 1 : -1;
    // Front of the queue: never-served first, then the longest wait.
    const wa = a.waitDays ?? Number.POSITIVE_INFINITY;
    const wb = b.waitDays ?? Number.POSITIVE_INFINITY;
    if (wa !== wb) return wb - wa;
    // Tiebreak: fewest turns taken in this queue.
    if (a.queueCount !== b.queueCount) return a.queueCount - b.queueCount;
    return a.person.name.localeCompare(b.person.name);
  });

  return list;
}

/**
 * Ranked candidates for a special event, rotating year-over-year:
 * fewest times worked this event first, then longest ago, then name.
 */
export function recommendForSpecial(
  people: Person[],
  assignments: Assignment[],
  specials: SpecialAssignment[],
  locations: LocationAssignment[],
  role: SlotRole,
  eventKey: string,
): Candidate[] {
  const counts = new Map<string, number>();
  const last = new Map<string, string>();
  for (const s of specials) {
    if (s.eventKey !== eventKey || s.role !== role) continue;
    counts.set(s.personId, (counts.get(s.personId) ?? 0) + 1);
    const cur = last.get(s.personId);
    if (!cur || s.date > cur) last.set(s.personId, s.date);
  }

  const list: Candidate[] = people
    .filter((p) => p.role === role && !p.availabilityOnly)
    .map((p) => ({
      person: p,
      waitDays: null,
      lastDutyDate: last.get(p.id) ?? null,
      queueCount: counts.get(p.id) ?? 0,
      resting: false,
      eligible: p.active,
      reasonKey: p.active
        ? undefined
        : ("reason_inactive" as Candidate["reasonKey"]),
      eventCount: counts.get(p.id) ?? 0,
      singleCover: p.singleCover === true,
    }));

  list.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    // Keep single-cover people below the normal rotation here too.
    if (!!a.singleCover !== !!b.singleCover) return a.singleCover ? 1 : -1;
    const ca = a.eventCount ?? 0;
    const cb = b.eventCount ?? 0;
    if (ca !== cb) return ca - cb;
    const la = a.lastDutyDate ?? "0";
    const lb = b.lastDutyDate ?? "0";
    if (la !== lb) return la < lb ? -1 : 1;
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
    .filter(
      (p) =>
        p.active &&
        !p.singleCover &&
        !p.availabilityOnly &&
        !(excludedIds && excludedIds.has(p.id)),
    )
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

/**
 * Ranked candidates for ONE crew slot (captain or co-pilot) of a planned
 * location stint. Unlike a normal duty slot, being on the regular duty/standby
 * rotation does NOT bar a person — assigning them to a location simply pulls
 * them out of that rotation (the schedule rebalances around them). A person is
 * only blocked when:
 *   - they are inactive,
 *   - they are barred from this specific location, or
 *   - they are already committed to ANOTHER location stint / special event on
 *     any of the stint's days (a genuine conflict).
 * Sibling picks (the other crews/role already chosen in this same plan) are
 * removed from the list entirely. Ordering follows location-duty fairness
 * (fewest location duties first, then longest ago).
 */
export function recommendForLocationCrew(
  people: Person[],
  locations: LocationAssignment[],
  specials: SpecialAssignment[],
  role: SlotRole,
  dates: string[],
  locationExcluded: Set<string>,
  siblingExcluded: Set<string>,
): Candidate[] {
  const counts = new Map<string, number>();
  const last = new Map<string, string>();
  for (const loc of locations) {
    counts.set(loc.personId, (counts.get(loc.personId) ?? 0) + 1);
    const cur = last.get(loc.personId);
    if (!cur || loc.endDate > cur) last.set(loc.personId, loc.endDate);
  }

  const conflictOn = (id: string): boolean =>
    dates.some(
      (d) =>
        specials.some((s) => s.date === d && s.personId === id) ||
        locations.some(
          (loc) =>
            loc.personId === id && d >= loc.startDate && d <= loc.endDate,
        ),
    );

  const list: Candidate[] = people
    .filter((p) => p.role === role && !p.availabilityOnly && !siblingExcluded.has(p.id))
    .map((p) => {
      let eligible = true;
      let reasonKey: Candidate["reasonKey"];
      if (!p.active) {
        eligible = false;
        reasonKey = "reason_inactive";
      } else if (locationExcluded.has(p.id)) {
        eligible = false;
        reasonKey = "reason_location_excluded";
      } else if (conflictOn(p.id)) {
        eligible = false;
        reasonKey = "reason_busy";
      }
      return {
        person: p,
        waitDays: null,
        lastDutyDate: last.get(p.id) ?? null,
        queueCount: counts.get(p.id) ?? 0,
        resting: false,
        eligible,
        reasonKey,
        singleCover: p.singleCover === true,
      };
    });

  list.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    // Normal pilots rank above single-cover people.
    if (!!a.singleCover !== !!b.singleCover) return a.singleCover ? 1 : -1;
    if (a.queueCount !== b.queueCount) return a.queueCount - b.queueCount;
    const la = a.lastDutyDate ?? "0";
    const lb = b.lastDutyDate ?? "0";
    if (la !== lb) return la < lb ? -1 : 1;
    return a.person.name.localeCompare(b.person.name);
  });

  return list;
}

export interface PersonTotals {
  person: Person;
  duty: number;
  weekendDuty: number;
  standby: number;
  special: number;
  location: number;
  /** Total worked items in the range (each duty/standby/special/location day = 1). */
  total: number;
  /** total - group average (negative = fewer turns than average). */
  balance: number;
}

/**
 * Factual per-person totals over an inclusive [startDate, endDate] range.
 * Plain counts — every duty day, activated standby, special and location day
 * counts as exactly 1. No weights, no phantom credit: this is a history report.
 */
export function computeTotals(
  people: Person[],
  assignments: Assignment[],
  specials: SpecialAssignment[],
  locations: LocationAssignment[],
  startDate: string,
  endDate: string,
  role: SlotRole,
): PersonTotals[] {
  const inRange = (d: string) => d >= startDate && d <= endDate;
  interface Row {
    duty: number;
    weekendDuty: number;
    standby: number;
    special: number;
    location: number;
  }
  const map = new Map<string, Row>();
  for (const p of people) {
    if (p.role === role && p.active && !p.singleCover && !p.availabilityOnly) {
      map.set(p.id, { duty: 0, weekendDuty: 0, standby: 0, special: 0, location: 0 });
    }
  }

  for (const a of assignments) {
    if (a.role !== role) continue;
    const r = map.get(a.personId);
    if (!r || !inRange(a.date)) continue;
    if (a.crew === "duty") {
      r.duty += 1;
      if (isWeekend(a.date)) r.weekendDuty += 1;
    } else if (a.crew === "standby" && a.activated) {
      r.standby += 1;
    }
  }

  for (const s of specials) {
    if (s.role !== role) continue;
    const r = map.get(s.personId);
    if (!r || !inRange(s.date)) continue;
    r.special += 1;
  }

  for (const loc of locations) {
    const r = map.get(loc.personId);
    if (!r) continue;
    for (const d of eachDay(loc.startDate, loc.endDate)) {
      if (inRange(d)) r.location += 1;
    }
  }

  let sum = 0;
  map.forEach((r) => {
    sum += r.duty + r.standby + r.special + r.location;
  });
  const avg = map.size > 0 ? sum / map.size : 0;

  return people
    .filter((p) => p.role === role && p.active && !p.singleCover && !p.availabilityOnly)
    .map((p) => {
      const r = map.get(p.id)!;
      const total = r.duty + r.standby + r.special + r.location;
      return {
        person: p,
        duty: r.duty,
        weekendDuty: r.weekendDuty,
        standby: r.standby,
        special: r.special,
        location: r.location,
        total,
        balance: total - avg,
      };
    })
    .sort(
      (a, b) => a.balance - b.balance || a.person.name.localeCompare(b.person.name),
    );
}
