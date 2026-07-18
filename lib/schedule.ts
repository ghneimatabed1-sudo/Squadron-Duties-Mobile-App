import { isWeekend, weekendDates } from "./dates";
import { recommendForSlot } from "./fairness";
import {
  Assignment,
  CrewKind,
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
  const roles: SlotRole[] = ["captain", "copilot"];
  const working = [...input.assignments];

  // A fillable crew slot: a crew kind/index together with the set of days it
  // spans. The base duty crew and standby honour weekend BLOCK behaviour (one
  // crew written across Thu–Fri–Sat); extra duty crews are always per-day.
  interface CrewSlot {
    crew: CrewKind;
    crewIndex: number;
    targetDates: string[];
  }

  for (const date of dates) {
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
          working.push({
            id: uid(),
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
