import {
  dayOfWeek,
  diffDays,
  eachDay,
  isWeekend,
  weekendDates,
} from "./dates";
import { recommendForSlot } from "./fairness";
import {
  Assignment,
  CrewKind,
  FixedDayRule,
  LocationAssignment,
  Person,
  Settings,
  SlotRole,
  SpecialAssignment,
  uid,
} from "./types";

/**
 * Insert or replace the occupant of a single (date, crew, role) slot.
 *
 * Guarantees one person can hold at most one slot per day: the incoming person
 * is first ejected from any OTHER slot that day, so an assignment can never
 * double-book them (e.g. duty + standby, or across a written weekend block).
 * Passing `personId === null` clears the slot. Standby activation is preserved
 * across a replace; a fresh standby starts un-activated.
 *
 * Pure: returns a new array and never mutates `list`.
 */
export function upsertAssignment(
  list: Assignment[],
  date: string,
  crew: CrewKind,
  role: SlotRole,
  personId: string | null,
  crewIndex = 0,
): Assignment[] {
  const sameSlot = (a: Assignment) =>
    a.date === date &&
    a.crew === crew &&
    a.role === role &&
    (a.crewIndex ?? 0) === crewIndex;
  let rest = list.filter((a) => !sameSlot(a));
  if (!personId) return rest;
  rest = rest.filter((a) => !(a.date === date && a.personId === personId));
  const prev = list.find(sameSlot);
  rest.push({
    id: prev?.id ?? uid(),
    date,
    crew,
    role,
    personId,
    // Activation ("standby got called in") belongs to the PERSON who lived
    // that night, not the slot: keep it only when the same person is being
    // re-written; a newly swapped-in person always starts un-activated so
    // they never inherit duty credit they didn't earn.
    activated:
      crew === "standby"
        ? prev?.personId === personId
          ? (prev?.activated ?? false)
          : false
        : undefined,
    crewIndex: crewIndex > 0 ? crewIndex : undefined,
  });
  return rest;
}

export interface AutoFillInput {
  people: Person[];
  assignments: Assignment[];
  specials: SpecialAssignment[];
  locations: LocationAssignment[];
  settings: Settings;
  splitWeekends: string[];
  /** Per-day count of extra duty crews (date -> n). Missing = the usual 1 crew. */
  extraCrews?: Record<string, number>;
  /** Recurring fixed-weekday duty rules — applied before the rotation fill. */
  fixedDays?: FixedDayRule[];
}

/**
 * Auto-fill every empty duty/standby slot across `dates` using the fairness
 * engine. Existing (manually set) slots are never overwritten — only the gaps
 * are filled, so manual reassignments are respected and the rest rebalances
 * around them.
 *
 * Behaviour notes:
 * - Block weekends (Thu–Fri–Sat not in `splitWeekends`) are filled once, with a
 *   single crew written across all weekend days in range.
 * - Picks made earlier in this run are part of the working history, so the
 *   rotation queue advances in real time during multi-week planning (someone
 *   picked yesterday moves to the back of the line for today).
 * - The chosen person must be free on EVERY day they would be written to, so a
 *   block pick can never double-book a day where they already hold another slot.
 *
 * Pure: returns a new assignments array and never mutates the input.
 */
export function autoFill(input: AutoFillInput, dates: string[]): Assignment[] {
  const { people, specials, locations, settings } = input;
  const dateSet = new Set(dates);
  // Is this person committed elsewhere (special event or location stint) on `d`?
  const busyOn = (personId: string, d: string): boolean =>
    specials.some((s) => s.date === d && s.personId === personId) ||
    locations.some(
      (loc) =>
        loc.personId === personId && d >= loc.startDate && d <= loc.endDate,
    );
  const splitSet = new Set(input.splitWeekends);
  const extraCrews = input.extraCrews ?? {};
  const fixedDays = input.fixedDays ?? [];
  const roles: SlotRole[] = ["captain", "copilot"];
  const working = [...input.assignments];

  // PRE-PASS — recurring fixed days: before the rotation fills anything, write
  // each fixed person into their weekday's base duty slot (their own role).
  // Existing (manual) occupants are respected; the person must be free and not
  // committed elsewhere. On a BLOCK weekend the fixed person takes the whole
  // block, exactly like any other weekend crew.
  if (fixedDays.length > 0) {
    const byId = new Map(people.map((p) => [p.id, p]));
    for (const date of dates) {
      const block = isWeekend(date) && !splitSet.has(weekendDates(date)[0]);
      const targetDates = block
        ? weekendDates(date).filter((d) => dateSet.has(d))
        : [date];
      if (block && date !== targetDates[0]) continue;
      const wd = dayOfWeek(date);
      const ruleMatches = block
        ? fixedDays.filter((f) =>
            targetDates.some((d) => dayOfWeek(d) === f.weekday),
          )
        : fixedDays.filter((f) => f.weekday === wd);
      for (const rule of ruleMatches) {
        const person = byId.get(rule.personId);
        if (!person || !person.active || person.availabilityOnly) continue;
        const role = person.role;
        const taken = working.some(
          (a) =>
            targetDates.includes(a.date) &&
            a.crew === "duty" &&
            a.role === role &&
            (a.crewIndex ?? 0) === 0,
        );
        if (taken) continue;
        const free = targetDates.every(
          (d) =>
            !working.some((a) => a.date === d && a.personId === person.id) &&
            !busyOn(person.id, d),
        );
        if (!free) continue;
        for (const d of targetDates) {
          working.push({
            id: uid(),
            date: d,
            crew: "duty",
            role,
            personId: person.id,
          });
        }
      }
    }
  }

  // A fillable crew slot: a crew kind/index together with the set of days it
  // spans. The base duty crew and standby honour weekend BLOCK behaviour (one
  // crew written across Thu–Fri–Sat); extra duty crews are always per-day.
  interface CrewSlot {
    crew: CrewKind;
    crewIndex: number;
    targetDates: string[];
  }

  // WEEKEND-FIRST FILL ORDER — weekends are assigned before weekdays. A
  // weekend block is 3 nights of work, so the person at the head of the
  // weekend queue must get it; if weekdays were filled first, a Tue/Wed duty
  // picked earlier in this very run could flag the rightful weekend person as
  // "resting" for Thursday and silently skip their weekend turn. Filling the
  // weekend first means weekday picks route AROUND the weekend crew instead.
  //
  // Weekdays keep their chronological order so the rotation queue advances
  // day by day exactly as before; a repair pass afterwards untangles the rare
  // corner where the pre-placed weekend leaves a weekday with only resting
  // candidates.
  const orderedDates = [
    ...dates.filter((d) => isWeekend(d)),
    ...dates.filter((d) => !isWeekend(d)),
  ];

  // Slots written by THIS rotation fill (never manual/pre-existing picks) —
  // only these may be touched by the repair pass below.
  const rotationIds = new Set<string>();

  for (const date of orderedDates) {
    const block = isWeekend(date) && !splitSet.has(weekendDates(date)[0]);
    const blockDates = block
      ? weekendDates(date).filter((d) => dateSet.has(d))
      : [date];
    const isBlockRef = !block || date === blockDates[0];

    const slots: CrewSlot[] = [];
    // Base crew + standby: skipped on the non-reference days of a block weekend
    // (they are written once across the whole block from its first day).
    if (isBlockRef) {
      slots.push({ crew: "duty", crewIndex: 0, targetDates: blockDates });
      slots.push({ crew: "standby", crewIndex: 0, targetDates: blockDates });
    }
    // Extra duty crews are a per-day exception — filled on this day alone.
    const nExtra = Math.max(0, Math.floor(extraCrews[date] ?? 0));
    for (let i = 1; i <= nExtra; i++) {
      slots.push({ crew: "duty", crewIndex: i, targetDates: [date] });
    }

    for (const { crew, crewIndex, targetDates } of slots) {
      for (const role of roles) {
        const inSlot = (a: Assignment) =>
          a.crew === crew &&
          a.role === role &&
          (a.crewIndex ?? 0) === crewIndex;
        const emptyDays = targetDates.filter(
          (d) => !working.find((a) => a.date === d && inSlot(a)),
        );
        if (emptyDays.length === 0) continue;

        const ref = targetDates[0];
        const existing =
          working.find((a) => a.date === ref && inSlot(a)) ??
          working.find((a) => targetDates.includes(a.date) && inSlot(a));
        let personId = existing?.personId ?? null;
        if (!personId) {
          const cands = recommendForSlot(
            people,
            working,
            specials,
            locations,
            settings,
            role,
            ref,
            crew,
            fixedDays,
          );
          personId =
            cands.find(
              (c) =>
                c.eligible &&
                !c.singleCover &&
                emptyDays.every(
                  (d) =>
                    !working.find(
                      (a) => a.date === d && a.personId === c.person.id,
                    ) && !busyOn(c.person.id, d),
                ),
            )?.person.id ?? null;
        }
        if (!personId) continue;

        for (const d of emptyDays) {
          // Never double-book: skip a day where this person already holds a slot
          // or is committed to a planned special/location.
          if (
            working.find((a) => a.date === d && a.personId === personId) ||
            busyOn(personId, d)
          ) {
            continue;
          }
          const id = uid();
          rotationIds.add(id);
          working.push({
            id,
            date: d,
            crew,
            role,
            personId,
            activated: crew === "standby" ? false : undefined,
            crewIndex: crewIndex > 0 ? crewIndex : undefined,
          });
        }
      }
    }
  }

  // REPAIR PASS — untangle avoidable rest-gap violations left by the
  // weekend-first order. Because the weekend crew is now locked in before the
  // weekdays, a greedy weekday fill can occasionally leave e.g. Wednesday with
  // only resting candidates while a legal swap exists (the person put on
  // Monday could have taken Wednesday and vice versa). This pass looks at
  // weekday slots written by THIS run whose occupant sits inside the rest gap
  // and swaps two occupants when the swap removes the violation without
  // creating a new one. Manual picks and weekend blocks are never touched.
  const restDays = Math.max(0, Math.floor(settings.restDays));
  const restSpecial = Math.max(0, Math.floor(settings.restDaysSpecial));
  const restLocation = Math.max(0, Math.floor(settings.restDaysLocation));
  if (restDays > 0 || restSpecial > 0 || restLocation > 0) {
    // Each kind of work keeps its own rest window — the SAME semantics as
    // recommendForSlot, so the repair pass can never legalise a swap that the
    // fairness engine itself would flag as resting.
    const workedGapsOf = (
      personId: string,
    ): Array<{ date: string; gapDays: number }> => {
      const out: Array<{ date: string; gapDays: number }> = [];
      for (const a of working) {
        if (a.personId === personId) {
          out.push({ date: a.date, gapDays: restDays });
        }
      }
      for (const sp of specials) {
        if (sp.personId === personId) {
          out.push({ date: sp.date, gapDays: restSpecial });
        }
      }
      for (const loc of locations) {
        if (loc.personId !== personId) continue;
        for (const d of eachDay(loc.startDate, loc.endDate)) {
          out.push({ date: d, gapDays: restLocation });
        }
      }
      return out;
    };
    // Would `personId` violate any rest window if they worked `atDate`,
    // ignoring the day(s) they are being moved OFF of?
    const violatesAt = (
      personId: string,
      atDate: string,
      ignore: Set<string>,
    ): boolean => {
      for (const { date: d, gapDays } of workedGapsOf(personId)) {
        if (d === atDate || ignore.has(d) || gapDays === 0) continue;
        const gap = Math.abs(diffDays(atDate, d));
        if (gap > 0 && gap <= gapDays) return true;
      }
      return false;
    };
    // Indexes into `working` so entries stay current across swaps (swapping
    // replaces the objects — see below — which would leave direct references
    // stale).
    const swappable: number[] = [];
    for (let i = 0; i < working.length; i++) {
      const a = working[i];
      if (rotationIds.has(a.id) && dateSet.has(a.date) && !isWeekend(a.date)) {
        swappable.push(i);
      }
    }
    for (const ia of swappable) {
      const a = working[ia];
      if (!violatesAt(a.personId, a.date, new Set([a.date]))) continue;
      for (const ib of swappable) {
        const b = working[ib];
        if (
          ib === ia ||
          b.role !== a.role ||
          b.crew !== a.crew ||
          b.date === a.date ||
          b.personId === a.personId
        ) {
          continue;
        }
        // Both people must be legal on the other's day after the swap: free,
        // not committed elsewhere, and outside every rest window.
        const aFreeOnB =
          !working.some(
            (x) => x !== b && x.date === b.date && x.personId === a.personId,
          ) &&
          !busyOn(a.personId, b.date) &&
          !violatesAt(a.personId, b.date, new Set([a.date]));
        const bFreeOnA =
          !working.some(
            (x) => x !== a && x.date === a.date && x.personId === b.personId,
          ) &&
          !busyOn(b.personId, a.date) &&
          !violatesAt(b.personId, a.date, new Set([b.date]));
        if (aFreeOnB && bFreeOnA) {
          // Swap by REPLACING the two entries (never mutate in place) so the
          // no-input-mutation guarantee holds structurally.
          working[ia] = { ...a, personId: b.personId };
          working[ib] = { ...b, personId: a.personId };
          break;
        }
      }
    }
  }
  return working;
}

/**
 * Re-balance an entire date range from scratch. Unlike autoFill (which only
 * fills empty slots and never touches manual picks), this clears every duty and
 * standby assignment inside `dates` — including any manual switches — and then
 * re-fills them with the fairness engine. Specials, locations and solos are left
 * untouched (autoFill already routes the rotation around them).
 *
 * This is what powers the one-tap "Balance" button: the user can shuffle people
 * around by hand, then ask the app to redistribute the whole week fairly.
 *
 * Pure: returns a new assignments array and never mutates the input.
 */
export function rebalanceAssignments(
  input: AutoFillInput,
  dates: string[],
): Assignment[] {
  const dateSet = new Set(dates);
  // Drop every duty/standby slot (any crew index) that falls inside the range,
  // keeping everything outside it intact, then let autoFill rebuild the range.
  const cleared = input.assignments.filter((a) => !dateSet.has(a.date));
  return autoFill({ ...input, assignments: cleared }, dates);
}
