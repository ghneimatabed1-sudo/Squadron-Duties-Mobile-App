import { describe, expect, it } from "vitest";

import { addDays, isWeekend, startOfWeek, weekendDates } from "../dates";
import { computeLoads, computeTotals, fairShare, recommendForSlot } from "../fairness";
import { autoFill, upsertAssignment } from "../schedule";
import {
  Assignment,
  DEFAULT_SETTINGS,
  LocationAssignment,
  Person,
  Settings,
  SpecialAssignment,
} from "../types";

/**
 * A realistic, "human-like" 6-month simulation that drives the SAME auto-fill
 * engine the app uses (lib/schedule.autoFill + lib/fairness), exercising every
 * moving part together: captains + copilots, block & split weekends, standby
 * activations, special events, location deployments, a single-cover commander,
 * someone going away ~3 months and returning, a brand-new mid-season joiner,
 * and manual reassignments. It asserts the invariants that must always hold.
 */

const settings: Settings = { ...DEFAULT_SETTINGS };

// Deterministic PRNG so the "human" choices (which standby to activate, which
// slot to manually override) are reproducible run to run.
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function person(
  id: string,
  name: string,
  role: "captain" | "copilot",
  extra: Partial<Person> = {},
): Person {
  return { id, name, role, active: true, createdAt: 0, ...extra };
}

// ---- invariant helpers ----

function assertNoDoubleBooking(assignments: Assignment[]) {
  const byDate = new Map<string, Set<string>>();
  for (const a of assignments) {
    let set = byDate.get(a.date);
    if (!set) {
      set = new Set();
      byDate.set(a.date, set);
    }
    expect(
      set.has(a.personId),
      `double-booked ${a.personId} on ${a.date}`,
    ).toBe(false);
    set.add(a.personId);
  }
}

function assignmentsFor(assignments: Assignment[], personId: string) {
  return assignments.filter((a) => a.personId === personId);
}

describe("6-month squadron simulation", () => {
  // Build a believable squadron.
  const captains: Person[] = [
    person("c1", "Adib", "captain"),
    person("c2", "Basel", "captain"),
    person("c3", "Carmel", "captain"),
    person("c4", "Diyab", "captain"),
    person("c5", "Eyad", "captain"),
  ];
  const copilots: Person[] = [
    person("p1", "Farah", "copilot"),
    person("p2", "Ghada", "copilot"),
    person("p3", "Hani", "copilot"),
    person("p4", "Iyad", "copilot"),
    person("p5", "Jamal", "copilot"),
  ];
  // A single-cover commander (manual only, never auto-filled, never counts).
  const commander = person("cmd", "Commander", "captain", { singleCover: true });
  // A brand-new captain who joins in month 3.
  const newcomerJoin = "2026-03-30"; // Monday in week ~13
  const newcomer = person("c6", "Newcomer", "captain", {
    activeSince: newcomerJoin,
  });
  // A copilot who goes away for ~3 months and returns.
  const awayStart = "2026-02-16"; // start of away
  const returnDate = "2026-05-18"; // ~3 months later, restamped activeSince

  function buildPeople(weekStartISO: string): Person[] {
    const people: Person[] = [...captains, ...copilots, commander];
    // Newcomer only exists in the roster from their join date onward.
    if (weekStartISO >= startOfWeek(newcomerJoin)) {
      people.push(newcomer);
    }
    // The away copilot (p5 "Jamal"): inactive during the away window, and on
    // return their activeSince is restamped so they re-enter balanced.
    return people.map((p) => {
      if (p.id !== "p5") return p;
      const weekEnd = addDays(weekStartISO, 6);
      const isAway = weekStartISO >= startOfWeek(awayStart) && weekEnd < returnDate;
      if (isAway) return { ...p, active: false };
      if (weekStartISO >= startOfWeek(returnDate)) {
        return { ...p, active: true, activeSince: returnDate };
      }
      return p;
    });
  }

  const start = startOfWeek("2026-01-05"); // Sunday
  const WEEKS = 26; // ~6 months

  // Run the whole season, accumulating state exactly like a user clicking
  // "generate" week by week, with realistic mid-season interventions.
  let assignments: Assignment[] = [];
  const specials: SpecialAssignment[] = [];
  const locations: LocationAssignment[] = [];
  const splitWeekends: string[] = [];
  const rng = lcg(20260603);

  // Track, per week, who was a valid auto-fill captain/copilot pool, to verify
  // away/single-cover people are never auto-assigned.
  const awayWeeks: { start: string; end: string }[] = [];

  for (let w = 0; w < WEEKS; w++) {
    const weekStart = addDays(start, w * 7);
    const weekEnd = addDays(weekStart, 6);
    const people = buildPeople(weekStart);

    // Roughly every 5th weekend is run in SPLIT mode (one crew per day).
    if (w % 5 === 2) {
      const thu = weekendDates(addDays(weekStart, 1))[0];
      if (!splitWeekends.includes(thu)) splitWeekends.push(thu);
    }

    // Track away weeks for later assertions.
    if (people.find((p) => p.id === "p5" && !p.active)) {
      awayWeeks.push({ start: weekStart, end: weekEnd });
    }

    // Auto-fill this week.
    const dates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    assignments = autoFill(
      { people, assignments, specials, settings, splitWeekends },
      dates,
    );

    // Human touch 1: activate ~1 standby per week (the standby got called in).
    const weekStandbys = assignments.filter(
      (a) => a.crew === "standby" && a.date >= weekStart && a.date <= weekEnd,
    );
    if (weekStandbys.length && rng() < 0.6) {
      const pick = weekStandbys[Math.floor(rng() * weekStandbys.length)];
      assignments = assignments.map((a) =>
        a.id === pick.id ? { ...a, activated: true } : a,
      );
    }

    // Human touch 2: an occasional special event (~ monthly), assigned to the
    // most-owed eligible captain via the real recommender.
    if (w % 4 === 1) {
      const evDate = addDays(weekStart, 3);
      const rec = recommendForSlot(
        people,
        assignments,
        specials,
        settings,
        "captain",
        evDate,
        evDate,
      ).filter((c) => c.eligible && !c.singleCover);
      if (rec.length) {
        specials.push({
          id: `ev${w}`,
          eventKey: "national_day",
          eventName: "National Day",
          date: evDate,
          role: "captain",
          personId: rec[0].person.id,
        });
      }
    }

    // Human touch 3: an occasional multi-day location deployment (~ every 6
    // weeks) to the fairest active, non-single-cover copilot.
    if (w % 6 === 4) {
      const pool = people.filter(
        (p) => p.role === "copilot" && p.active && !p.singleCover,
      );
      if (pool.length) {
        const counts = new Map<string, number>();
        for (const l of locations) counts.set(l.personId, (counts.get(l.personId) ?? 0) + 1);
        pool.sort((a, b) => (counts.get(a.id) ?? 0) - (counts.get(b.id) ?? 0));
        locations.push({
          id: `loc${w}`,
          location: "Aqaba",
          startDate: addDays(weekStart, 1),
          endDate: addDays(weekStart, 4),
          personId: pool[0].id,
        });
      }
    }
  }

  it("never double-books anyone on any day across the whole season", () => {
    assertNoDoubleBooking(assignments);
  });

  it("fills every slot with the correct role and an existing active person", () => {
    const byId = new Map<string, Person>();
    for (const p of [...captains, ...copilots, commander, newcomer]) byId.set(p.id, p);
    for (const a of assignments) {
      const p = byId.get(a.personId);
      expect(p, `unknown person ${a.personId}`).toBeTruthy();
      expect(p!.role).toBe(a.role); // captains in captain slots, copilots in copilot slots
    }
  });

  it("never auto-assigns the single-cover commander", () => {
    expect(assignmentsFor(assignments, "cmd").length).toBe(0);
  });

  it("never auto-assigns a person while they are away (inactive)", () => {
    const jamal = assignmentsFor(assignments, "p5");
    for (const a of jamal) {
      for (const win of awayWeeks) {
        const inAway = a.date >= win.start && a.date <= win.end;
        expect(inAway, `Jamal assigned on ${a.date} while away`).toBe(false);
      }
    }
  });

  it("never assigns the newcomer before their join date", () => {
    const fresh = assignmentsFor(assignments, "c6");
    for (const a of fresh) {
      expect(a.date >= newcomerJoin, `newcomer assigned ${a.date} before join`).toBe(true);
    }
  });

  it("keeps block weekends consistent (one crew across Thu–Fri–Sat per slot)", () => {
    for (let w = 0; w < WEEKS; w++) {
      const weekStart = addDays(start, w * 7);
      const [thu, fri, sat] = weekendDates(addDays(weekStart, 1));
      if (splitWeekends.includes(thu)) continue; // split weekends may differ by day
      for (const role of ["captain", "copilot"] as const) {
        for (const crew of ["duty", "standby"] as const) {
          const occ = (d: string) =>
            assignments.find(
              (a) => a.date === d && a.role === role && a.crew === crew,
            )?.personId ?? null;
          const t = occ(thu);
          if (t === null) continue;
          expect(occ(fri), `block ${role}/${crew} ${thu}`).toBe(t);
          expect(occ(sat), `block ${role}/${crew} ${thu}`).toBe(t);
        }
      }
    }
  });

  it("does not give a newcomer back-to-back duty in their first week", () => {
    const firstWeekEnd = addDays(newcomerJoin, 6);
    const dutyDays = assignments
      .filter(
        (a) =>
          a.personId === "c6" &&
          a.crew === "duty" &&
          a.date >= newcomerJoin &&
          a.date <= firstWeekEnd,
      )
      .map((a) => a.date)
      .sort();
    for (let i = 1; i < dutyDays.length; i++) {
      expect(
        addDays(dutyDays[i - 1], 1) === dutyDays[i],
        `newcomer back-to-back duty ${dutyDays[i - 1]}->${dutyDays[i]}`,
      ).toBe(false);
    }
  });

  it("lets the newcomer enter balanced — not the most-owed on join day", () => {
    const people = buildPeople(startOfWeek(newcomerJoin));
    const rec = recommendForSlot(
      people,
      assignments,
      specials,
      settings,
      "captain",
      newcomerJoin,
      newcomerJoin,
    );
    const fresh = rec.find((c) => c.person.id === "c6")!;
    // Balanced means |balance| small — not a big negative (most-owed) number.
    expect(Math.abs(fresh.balance)).toBeLessThan(settings.weekendWeight);
  });

  it("lets a returning pilot rejoin balanced (not buried in catch-up duty)", () => {
    const people = buildPeople(startOfWeek(returnDate));
    const loads = computeLoads(
      people,
      assignments,
      specials,
      settings,
      "copilot",
      returnDate,
    );
    const share = fairShare(loads);
    const jamal = loads.get("p5")!;
    expect(Math.abs(jamal.weighted - share)).toBeLessThan(settings.weekendWeight);
  });

  it("keeps the established pool fair over the full season", () => {
    // Among captains present and active the entire 6 months (exclude the
    // newcomer and single-cover commander), weighted totals should be close.
    const core = ["c1", "c2", "c3", "c4", "c5"];
    const totals = computeTotals(
      [...captains],
      assignments,
      specials,
      locations,
      settings,
      start,
      addDays(start, WEEKS * 7),
      "captain",
    ).filter((r) => core.includes(r.person.id));
    const weights = totals.map((r) => r.weighted);
    const max = Math.max(...weights);
    const min = Math.min(...weights);
    const mean = weights.reduce((s, x) => s + x, 0) / weights.length;
    // Spread should stay modest relative to the mean over a long season.
    expect((max - min) / mean).toBeLessThan(0.35);
  });

  it("tracking totals exactly match the underlying assignments (factual)", () => {
    const rangeStart = start;
    const rangeEnd = addDays(start, WEEKS * 7);
    const inRange = (d: string) => d >= rangeStart && d <= rangeEnd;
    for (const role of ["captain", "copilot"] as const) {
      const totals = computeTotals(
        buildPeople(addDays(start, (WEEKS - 1) * 7)),
        assignments,
        specials,
        locations,
        settings,
        rangeStart,
        rangeEnd,
        role,
      );
      for (const row of totals) {
        const realDuty = assignments.filter(
          (a) =>
            a.personId === row.person.id &&
            a.role === role &&
            a.crew === "duty" &&
            inRange(a.date),
        ).length;
        const realStandby = assignments.filter(
          (a) =>
            a.personId === row.person.id &&
            a.role === role &&
            a.crew === "standby" &&
            a.activated &&
            inRange(a.date),
        ).length;
        expect(row.duty, `${row.person.name} duty`).toBe(realDuty);
        expect(row.standby, `${row.person.name} standby`).toBe(realStandby);
      }
    }
  });

  it("rebalances after a manual reassignment (forced person ranks lower next)", () => {
    // Take a fresh mid-season week and force one captain into a duty slot, then
    // confirm the engine now ranks them as 'ahead' (higher balance) for the
    // next day — i.e. manual edits rebalance the rotation.
    const day = addDays(start, 10 * 7 + 1); // a Monday mid-season
    const next = addDays(day, 1);
    const people = buildPeople(startOfWeek(day));
    const before = recommendForSlot(
      people,
      assignments,
      specials,
      settings,
      "captain",
      next,
      next,
    );
    const forced = before[before.length - 1].person.id; // currently most "ahead"
    const forcedBalBefore = before.find((c) => c.person.id === forced)!.balance;
    const withManual = upsertAssignment(
      assignments,
      day,
      "duty",
      "captain",
      forced,
    );
    const after = recommendForSlot(
      people,
      withManual,
      specials,
      settings,
      "captain",
      next,
      next,
    );
    const forcedBalAfter = after.find((c) => c.person.id === forced)!.balance;
    expect(forcedBalAfter).toBeGreaterThanOrEqual(forcedBalBefore);
  });
});
