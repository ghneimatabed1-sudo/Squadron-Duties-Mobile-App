import { addDays, isWeekend, startOfWeek, weekendDates } from "./dates";
import { autoFill } from "./schedule";
import { AppState, Person, SlotRole } from "./types";

/**
 * DUTIES FORECAST (read-only)
 *
 * Predicts who the rotation queue will pick for upcoming WEEKEND duties and
 * shows the upcoming ORDER for location duty — without writing anything to the
 * schedule. It runs the exact same auto-fill engine on a scratch copy of the
 * data, so the forecast always matches what auto-fill would actually do, and
 * it recomputes from the live saved history every time the app data changes.
 *
 * Availability marks are NOT consulted: availability is a present-day logbook
 * (who was off/sick today), not a future-planning tool.
 */

export interface ForecastPick {
  person: Person;
  /** True when this slot is already written in the real schedule. */
  planned: boolean;
}

export interface ForecastCrew {
  /** Block weekends: the Thursday. Split weekends: each individual day. */
  date: string;
  captain: ForecastPick | null;
  copilot: ForecastPick | null;
}

export interface WeekendForecast {
  /** Thursday ISO date — the weekend key. */
  key: string;
  /** The weekend days (Thu/Fri/Sat) inside the forecast window. */
  dates: string[];
  /** True when this weekend is in split mode (one crew per day). */
  split: boolean;
  crews: ForecastCrew[];
}

/**
 * Simulate auto-fill over every weekend day in [from, from + horizonDays] and
 * report the predicted duty crew for each weekend. Existing real assignments
 * are respected (marked `planned`); the gaps are filled by the fairness
 * engine exactly as the auto-fill button would (`predicted`).
 */
export function forecastWeekends(
  state: AppState,
  from: string,
  horizonDays: number,
): WeekendForecast[] {
  const end = addDays(from, horizonDays);
  const days: string[] = [];
  let ws = startOfWeek(from);
  for (;;) {
    const wd = weekendDates(ws);
    if (wd[0] > end) break;
    // Include the WHOLE weekend whenever any of its days is in the window, so
    // a block weekend is always simulated as one unit — even when `from` is a
    // Friday/Saturday and Thursday is already behind us. Otherwise autoFill
    // could not see the crew already written on Thursday and would "refill"
    // the rest of the block with someone else.
    if (wd[2] >= from) {
      for (const d of wd) days.push(d);
    }
    ws = addDays(ws, 7);
  }
  if (days.length === 0) return [];

  // Only the BASE crew is forecast — extra crews are rare per-day exceptions
  // the user adds by hand, so predicting them would be noise.
  const filled = autoFill(
    {
      people: state.people,
      assignments: state.assignments,
      specials: state.specials,
      locations: state.locations,
      settings: state.settings,
      splitWeekends: state.splitWeekends,
      fixedDays: state.fixedDays,
    },
    days,
  );

  const existing = new Set(
    state.assignments
      .filter((a) => a.crew === "duty" && (a.crewIndex ?? 0) === 0)
      .map((a) => `${a.date}|${a.role}`),
  );
  const byId = new Map(state.people.map((p) => [p.id, p]));

  const groups = new Map<string, string[]>();
  for (const d of days) {
    const key = weekendDates(d)[0];
    const g = groups.get(key);
    if (g) g.push(d);
    else groups.set(key, [d]);
  }

  const out: WeekendForecast[] = [];
  for (const [key, ds] of groups) {
    const split = state.splitWeekends.includes(key);
    // Split weekends show one crew per day — but only the days from `from`
    // onward (earlier days of the current weekend are history, not forecast).
    // Block weekends show ONE crew keyed to the canonical Thursday, and the
    // pick/planned lookup scans the whole block so a crew written on any of
    // the weekend days is found and labelled correctly.
    const visible = split ? ds.filter((d) => d >= from) : ds;
    if (visible.length === 0) continue;
    const crewSpans: string[][] = split ? visible.map((d) => [d]) : [ds];
    const crews: ForecastCrew[] = crewSpans.map((span) => {
      const pick = (role: SlotRole): ForecastPick | null => {
        const a = filled.find(
          (x) =>
            span.includes(x.date) &&
            x.crew === "duty" &&
            x.role === role &&
            (x.crewIndex ?? 0) === 0,
        );
        if (!a) return null;
        const person = byId.get(a.personId);
        if (!person) return null;
        return {
          person,
          planned: span.some((d) => existing.has(`${d}|${role}`)),
        };
      };
      return { date: span[0], captain: pick("captain"), copilot: pick("copilot") };
    });
    out.push({ key, dates: visible, split, crews });
  }

  return out.sort((a, b) => (a.key < b.key ? -1 : 1));
}

export interface LocationQueueRow {
  person: Person;
  /** Total location stints served (ever). */
  count: number;
  /** End date of their most recent stint, null = never. */
  lastDate: string | null;
}

/**
 * The upcoming ORDER for location duty per role: fewest stints first, then
 * longest ago, then name — the same ranking the location crew picker uses.
 * Row 1 is next in line, row 2 after them, and so on. Location stints have no
 * fixed calendar cadence, so this is an order, not dated slots.
 */
export function locationQueue(state: AppState, role: SlotRole): LocationQueueRow[] {
  const counts = new Map<string, number>();
  const last = new Map<string, string>();
  for (const loc of state.locations) {
    counts.set(loc.personId, (counts.get(loc.personId) ?? 0) + 1);
    const cur = last.get(loc.personId);
    if (!cur || loc.endDate > cur) last.set(loc.personId, loc.endDate);
  }

  return rankQueue(state, role, counts, last);
}

/**
 * The upcoming ORDER for weekend duty per role, ranked from the saved weekend
 * duty history: fewest weekends served first, then longest ago, then name.
 * People who have never done a weekend duty are always at the front. A block
 * weekend (Thu–Sat crewed by the same pair) counts as ONE weekend, not three.
 */
export function weekendQueue(state: AppState, role: SlotRole): LocationQueueRow[] {
  // Distinct weekends served per person (a Thu-Sat block = 1).
  const served = new Map<string, Set<string>>();
  const last = new Map<string, string>();
  for (const a of state.assignments) {
    if (a.crew !== "duty" || a.role !== role || !isWeekend(a.date)) continue;
    const key = weekendDates(a.date)[0];
    let set = served.get(a.personId);
    if (!set) {
      set = new Set();
      served.set(a.personId, set);
    }
    set.add(key);
    const cur = last.get(a.personId);
    if (!cur || a.date > cur) last.set(a.personId, a.date);
  }
  const counts = new Map<string, number>();
  for (const [id, set] of served) counts.set(id, set.size);

  return rankQueue(state, role, counts, last);
}

function rankQueue(
  state: AppState,
  role: SlotRole,
  counts: Map<string, number>,
  last: Map<string, string>,
): LocationQueueRow[] {
  return state.people
    .filter((p) => p.role === role && p.active && !p.singleCover && !p.availabilityOnly)
    .map((p) => ({
      person: p,
      count: counts.get(p.id) ?? 0,
      lastDate: last.get(p.id) ?? null,
    }))
    .sort((a, b) => {
      if (a.count !== b.count) return a.count - b.count;
      const la = a.lastDate ?? "0";
      const lb = b.lastDate ?? "0";
      if (la !== lb) return la < lb ? -1 : 1;
      return a.person.name.localeCompare(b.person.name);
    });
}
