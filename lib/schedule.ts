import { isWeekend, weekendDates } from "./dates";
import { recommendForSlot } from "./fairness";
import {
  Assignment,
  CrewKind,
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
): Assignment[] {
  let rest = list.filter(
    (a) => !(a.date === date && a.crew === crew && a.role === role),
  );
  if (!personId) return rest;
  rest = rest.filter((a) => !(a.date === date && a.personId === personId));
  const prev = list.find(
    (a) => a.date === date && a.crew === crew && a.role === role,
  );
  rest.push({
    id: prev?.id ?? uid(),
    date,
    crew,
    role,
    personId,
    activated: crew === "standby" ? (prev?.activated ?? false) : undefined,
  });
  return rest;
}

export interface AutoFillInput {
  people: Person[];
  assignments: Assignment[];
  specials: SpecialAssignment[];
  settings: Settings;
  splitWeekends: string[];
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
 * - The slot's own date is used as the fairness reference so people picked
 *   earlier in this run are counted as "ahead" for later days (real-time
 *   rebalancing during multi-week planning).
 * - The chosen person must be free on EVERY day they would be written to, so a
 *   block pick can never double-book a day where they already hold another slot.
 *
 * Pure: returns a new assignments array and never mutates the input.
 */
export function autoFill(input: AutoFillInput, dates: string[]): Assignment[] {
  const { people, specials, settings } = input;
  const dateSet = new Set(dates);
  const splitSet = new Set(input.splitWeekends);
  const crews: CrewKind[] = ["duty", "standby"];
  const roles: SlotRole[] = ["captain", "copilot"];
  const working = [...input.assignments];

  for (const date of dates) {
    const block = isWeekend(date) && !splitSet.has(weekendDates(date)[0]);
    const targetDates = block
      ? weekendDates(date).filter((d) => dateSet.has(d))
      : [date];
    if (block && date !== targetDates[0]) continue;

    for (const crew of crews) {
      for (const role of roles) {
        const emptyDays = targetDates.filter(
          (d) =>
            !working.find(
              (a) => a.date === d && a.crew === crew && a.role === role,
            ),
        );
        if (emptyDays.length === 0) continue;

        const ref = targetDates[0];
        const existing =
          working.find(
            (a) => a.date === ref && a.crew === crew && a.role === role,
          ) ??
          working.find(
            (a) =>
              targetDates.includes(a.date) &&
              a.crew === crew &&
              a.role === role,
          );
        let personId = existing?.personId ?? null;
        if (!personId) {
          const cands = recommendForSlot(
            people,
            working,
            specials,
            settings,
            role,
            ref,
            ref,
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
                    ),
                ),
            )?.person.id ?? null;
        }
        if (!personId) continue;

        for (const d of emptyDays) {
          if (working.find((a) => a.date === d && a.personId === personId)) {
            continue;
          }
          working.push({
            id: uid(),
            date: d,
            crew,
            role,
            personId,
            activated: crew === "standby" ? false : undefined,
          });
        }
      }
    }
  }
  return working;
}
