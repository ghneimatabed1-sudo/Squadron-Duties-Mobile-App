import { addDays, diffDays, eachDay, inWindow, isWeekend } from "./dates";
import {
  Assignment,
  CrewKind,
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
  locations: LocationAssignment[],
  settings: Settings,
  role: SlotRole,
  refDate: string,
  /**
   * Give newcomers/returners a fair, balanced start (default true). When on, a
   * person whose `activeSince` falls inside the window is credited phantom
   * duties at the group's average rate for the days before they were available,
   * so they enter the rotation balanced instead of "most owed". Turn off for
   * factual reporting where real counts matter (see computeTotals).
   */
  neutralizeNewcomers = true,
): Map<string, Load> {
  const map = new Map<string, Load>();
  // activeSince per pool member: duties before this date are NOT counted as real
  // load (the person had joined/returned later), keeping load consistent with
  // the phantom credit applied below — a returner rejoins balanced, not "ahead".
  const joinById = new Map<string, string | undefined>();
  for (const p of people) {
    // Single-cover people are outside the rotation: their duties never count
    // toward fairness, so they are excluded from the load pool entirely.
    if (p.role === role && p.active && !p.singleCover) {
      map.set(p.id, emptyLoad(p.id));
      joinById.set(p.id, p.activeSince);
    }
  }

  for (const a of assignments) {
    if (a.role !== role) continue;
    const l = map.get(a.personId);
    if (!l) continue;
    const since = joinById.get(a.personId);
    if (since && a.date < since) continue; // before they joined/returned
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
    const since = joinById.get(s.personId);
    if (since && s.date < since) continue; // before they joined/returned
    if (inWindow(s.date, refDate, settings.windowDays)) {
      l.weighted += settings.specialWeight;
      l.specials += 1;
    }
  }

  // Location duty is real, counted work: every covered day in the window adds
  // locationWeight to the person's load (and updates lastDutyDate) so the
  // rotation rebalances around a planned stint — exactly like normal duty.
  for (const loc of locations) {
    const l = map.get(loc.personId);
    if (!l) continue; // not in this role pool
    const since = joinById.get(loc.personId);
    for (const d of eachDay(loc.startDate, loc.endDate)) {
      if (since && d < since) continue; // before they joined/returned
      if (inWindow(d, refDate, settings.windowDays)) {
        l.weighted += settings.locationWeight;
      }
      if (!l.lastDutyDate || d > l.lastDutyDate) l.lastDutyDate = d;
    }
  }

  if (neutralizeNewcomers) {
    // First day the window covers (inclusive). Anyone whose activeSince is on or
    // before this is "established" and gets no phantom credit.
    const windowStart = addDays(refDate, -(settings.windowDays - 1));

    // Average weighted load of established people = the group's "fair" pace.
    let estSum = 0;
    let estCount = 0;
    const availableDays = new Map<string, number>();
    for (const p of people) {
      if (!map.has(p.id)) continue;
      let avail = settings.windowDays;
      if (p.activeSince && p.activeSince > windowStart) {
        // Joined/returned partway through (or after) the window.
        avail = Math.max(
          0,
          Math.min(settings.windowDays, diffDays(refDate, p.activeSince) + 1),
        );
      }
      availableDays.set(p.id, avail);
      if (avail >= settings.windowDays) {
        estSum += map.get(p.id)!.weighted;
        estCount += 1;
      }
    }

    const ratePerDay =
      estCount > 0 ? estSum / estCount / settings.windowDays : 0;
    if (ratePerDay > 0) {
      for (const p of people) {
        const l = map.get(p.id);
        if (!l) continue;
        const avail = availableDays.get(p.id) ?? settings.windowDays;
        if (avail < settings.windowDays) {
          // Credit the unavailable days at the group rate so the newcomer's
          // effective load sits at the fair share — balanced, not "owed".
          l.weighted += ratePerDay * (settings.windowDays - avail);
        }
      }
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
 * Ranked candidates for an open duty/standby slot.
 * Most "owed" person (lowest load), then longest since last duty, then name.
 */
export function recommendForSlot(
  people: Person[],
  assignments: Assignment[],
  specials: SpecialAssignment[],
  locations: LocationAssignment[],
  settings: Settings,
  role: SlotRole,
  date: string,
  refDate: string,
  /**
   * Which crew this slot belongs to. For duty slots the ranking is made
   * category-aware (see `rankLoad` below) so weekday and weekend duty balance
   * independently — a heavy weekend no longer exempts someone from weekdays,
   * and vice-versa. Standby keeps the plain weighted-load ranking.
   */
  crew: CrewKind = "duty",
): Candidate[] {
  const loads = computeLoads(
    people,
    assignments,
    specials,
    locations,
    settings,
    role,
    refDate,
  );
  const share = fairShare(loads);
  // Category-aware load used purely for ranking. When filling a weekday duty
  // slot we discount the weekend-duty weight (and the reverse for weekend
  // slots) so the two categories rotate independently — this is what keeps the
  // weekdays split between everyone available instead of dumping the whole
  // work-week on one person while another "rests" behind a heavy weekend.
  // The neutralised `weighted` total still drives the tiebreak, so newcomers
  // and returners stay protected exactly as before.
  const slotIsWeekend = isWeekend(date);
  const rankLoad = (personId: string): number => {
    const l = loads.get(personId);
    if (!l) return 0;
    if (crew !== "duty") return l.weighted;
    return slotIsWeekend
      ? l.weighted - settings.dutyWeight * (l.dutyDays - l.weekendDuty)
      : l.weighted - settings.weekendWeight * l.weekendDuty;
  };
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
      } else if (busySameDay.has(p.id)) {
        eligible = false;
        reasonKey = "reason_busy";
      }
      return {
        person: p,
        load,
        balance: load - share,
        lastDutyDate: l?.lastDutyDate ?? null,
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
    // Primary: category-aware owed (weekday vs weekend balance independently).
    const ra = rankLoad(a.person.id);
    const rb = rankLoad(b.person.id);
    if (ra !== rb) return ra - rb;
    // Tiebreak by overall weighted load, so cross-category fairness still wins
    // when one category is tied (and newcomers stay protected here).
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
  locations: LocationAssignment[],
  settings: Settings,
  role: SlotRole,
  eventKey: string,
  refDate: string,
): Candidate[] {
  const loads = computeLoads(
    people,
    assignments,
    specials,
    locations,
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
        singleCover: p.singleCover === true,
      };
    });

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
    .filter(
      (p) =>
        p.active &&
        !p.singleCover &&
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
    .filter((p) => p.role === role && !siblingExcluded.has(p.id))
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
      const count = counts.get(p.id) ?? 0;
      return {
        person: p,
        load: count,
        balance: 0,
        lastDutyDate: last.get(p.id) ?? null,
        eligible,
        reasonKey,
        singleCover: p.singleCover === true,
      };
    });

  list.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    // Normal pilots rank above single-cover people.
    if (!!a.singleCover !== !!b.singleCover) return a.singleCover ? 1 : -1;
    if (a.load !== b.load) return a.load - b.load;
    const la = a.lastDutyDate ?? "0";
    const lb = b.lastDutyDate ?? "0";
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
  locations: LocationAssignment[],
  settings: Settings,
  role: SlotRole,
  date: string,
  crew: "duty" | "standby",
  outPersonId: string | null,
  inPersonId: string,
  refDate: string,
  crewIndex = 0,
): SwapPreview {
  const sameSlot = (a: Assignment) =>
    a.date === date &&
    a.crew === crew &&
    a.role === role &&
    (a.crewIndex ?? 0) === crewIndex;
  const next = assignments.filter((a) => !sameSlot(a));
  // Preserve activation state when swapping a standby occupant.
  const prevSlot = assignments.find(sameSlot);
  next.push({
    id: "preview",
    date,
    crew,
    role,
    personId: inPersonId,
    activated: crew === "standby" ? prevSlot?.activated : undefined,
    crewIndex: crewIndex > 0 ? crewIndex : undefined,
  });

  const before = computeLoads(
    people,
    assignments,
    specials,
    locations,
    settings,
    role,
    refDate,
  );
  const after = computeLoads(
    people,
    next,
    specials,
    locations,
    settings,
    role,
    refDate,
  );
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

/**
 * Factual per-person totals over an inclusive [startDate, endDate] range.
 * Counts are real (no newcomer neutralizing) — this is a history report, so the
 * numbers reflect exactly what each person did in the period the user picked.
 */
export function computeTotals(
  people: Person[],
  assignments: Assignment[],
  specials: SpecialAssignment[],
  locations: LocationAssignment[],
  settings: Settings,
  startDate: string,
  endDate: string,
  role: SlotRole,
): PersonTotals[] {
  const inRange = (d: string) => d >= startDate && d <= endDate;
  const map = new Map<string, Load>();
  for (const p of people) {
    if (p.role === role && p.active && !p.singleCover) {
      map.set(p.id, emptyLoad(p.id));
    }
  }

  for (const a of assignments) {
    if (a.role !== role) continue;
    const l = map.get(a.personId);
    if (!l || !inRange(a.date)) continue;
    if (a.crew === "duty") {
      const wknd = isWeekend(a.date);
      l.weighted += wknd ? settings.weekendWeight : settings.dutyWeight;
      l.dutyDays += 1;
      if (wknd) l.weekendDuty += 1;
    } else if (a.crew === "standby" && a.activated) {
      l.weighted += settings.standbyWeight;
      l.standbyActivated += 1;
    }
  }

  for (const s of specials) {
    if (s.role !== role) continue;
    const l = map.get(s.personId);
    if (!l || !inRange(s.date)) continue;
    l.weighted += settings.specialWeight;
    l.specials += 1;
  }

  // Location duty: count every covered day inside the range and fold its weight
  // into the person's load, so the factual report's balance matches the
  // scheduling fairness (which also counts location days).
  const locCount = new Map<string, number>();
  for (const loc of locations) {
    const l = map.get(loc.personId);
    for (const d of eachDay(loc.startDate, loc.endDate)) {
      if (!inRange(d)) continue;
      locCount.set(loc.personId, (locCount.get(loc.personId) ?? 0) + 1);
      if (l) l.weighted += settings.locationWeight;
    }
  }

  const share = fairShare(map);

  return people
    .filter((p) => p.role === role && p.active && !p.singleCover)
    .map((p) => {
      const l = map.get(p.id);
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
