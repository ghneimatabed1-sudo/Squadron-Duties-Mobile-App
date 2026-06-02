import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { beforeEach, describe, expect, it } from "vitest";

import AsyncStorageMock from "../../test/mocks/async-storage";
import {
  addDays,
  isWeekend,
  startOfWeek,
  todayISO,
  weekDates,
  weekendDates,
} from "../../lib/dates";
import { normalize } from "../../lib/storage";
import {
  computeLoads,
  recommendForLocation,
  recommendForSlot,
} from "../../lib/fairness";
import {
  Assignment,
  DEFAULT_SETTINGS,
  Person,
  Settings,
  SlotRole,
} from "../../lib/types";
import { AppProvider, useApp } from "../AppContext";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type AppContextValue = ReturnType<typeof useApp>;

async function mountApp(): Promise<{ getApi: () => AppContextValue }> {
  let api: AppContextValue | null = null;
  function Probe() {
    api = useApp();
    return null;
  }
  await act(async () => {
    TestRenderer.create(
      <AppProvider>
        <Probe />
      </AppProvider>,
    );
  });
  return { getApi: () => api! };
}

// ---- deterministic RNG so any failure reproduces exactly ----
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = [
  "Omar", "Layla", "Khalid", "Sara", "Yousef", "Noor", "Tariq", "Huda",
  "Faisal", "Rana", "Sami", "Dana", "Ziad", "Maya", "Hadi", "Lina",
  "Bilal", "Aya", "Nabil", "Reem", "Jad", "Salma", "Karim", "Dina",
];
const LAST = ["A.", "B.", "C.", "D.", "E.", "F.", "G.", "H.", "I.", "J."];

function makeNamer(rng: () => number) {
  const used = new Set<string>();
  return () => {
    for (let i = 0; i < 200; i++) {
      const n =
        FIRST[Math.floor(rng() * FIRST.length)] +
        " " +
        LAST[Math.floor(rng() * LAST.length)];
      if (!used.has(n)) {
        used.add(n);
        return n;
      }
    }
    const n = "Pilot " + used.size;
    used.add(n);
    return n;
  };
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}
function randInt(rng: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

// ---------- invariant checks over a live state ----------
interface Issue {
  kind: string;
  detail: string;
}

function checkInvariants(api: AppContextValue): Issue[] {
  const issues: Issue[] = [];
  const s = api.state;
  const peopleById = new Map(s.people.map((p) => [p.id, p]));

  // 1. Every assignment references an existing person whose role matches the slot.
  for (const a of s.assignments) {
    const p = peopleById.get(a.personId);
    if (!p) {
      issues.push({ kind: "orphan_assignment", detail: `${a.date}/${a.crew}/${a.role} -> ${a.personId}` });
      continue;
    }
    if (p.role !== a.role) {
      issues.push({
        kind: "role_mismatch",
        detail: `${a.date}/${a.crew}/${a.role} assigned to ${p.name} (${p.role})`,
      });
    }
  }

  // 2. No person appears in two slots on the same day (no double-booking).
  const perDay = new Map<string, Map<string, string[]>>();
  for (const a of s.assignments) {
    if (!perDay.has(a.date)) perDay.set(a.date, new Map());
    const day = perDay.get(a.date)!;
    if (!day.has(a.personId)) day.set(a.personId, []);
    day.get(a.personId)!.push(`${a.crew}/${a.role}`);
  }
  for (const [date, day] of perDay) {
    for (const [pid, slots] of day) {
      if (slots.length > 1) {
        issues.push({
          kind: "double_booked",
          detail: `${peopleById.get(pid)?.name ?? pid} on ${date}: ${slots.join(", ")}`,
        });
      }
    }
  }

  // 3. At most one assignment per (date, crew, role) slot.
  const slotSeen = new Set<string>();
  for (const a of s.assignments) {
    const key = `${a.date}|${a.crew}|${a.role}`;
    if (slotSeen.has(key)) {
      issues.push({ kind: "duplicate_slot", detail: key });
    }
    slotSeen.add(key);
  }

  // 4. Duty assignments must never carry an `activated` flag; standby always does.
  for (const a of s.assignments) {
    if (a.crew === "duty" && a.activated !== undefined) {
      issues.push({ kind: "duty_activated", detail: `${a.date}/${a.role}` });
    }
    if (a.crew === "standby" && typeof a.activated !== "boolean") {
      issues.push({ kind: "standby_no_flag", detail: `${a.date}/${a.role}` });
    }
  }

  // 5. Block weekends (not in splitWeekends) must have identical crew across
  //    Thu/Fri/Sat for each (crew, role) that is filled at all.
  const splitSet = new Set(s.splitWeekends);
  const weekendKeys = new Set<string>();
  for (const a of s.assignments) {
    if (isWeekend(a.date)) weekendKeys.add(weekendDates(a.date)[0]);
  }
  const crews = ["duty", "standby"] as const;
  const roles: SlotRole[] = ["captain", "copilot"];
  for (const key of weekendKeys) {
    if (splitSet.has(key)) continue; // split weekends may differ per day
    const days = weekendDates(key);
    for (const crew of crews) {
      for (const role of roles) {
        const occupants = days.map(
          (d) =>
            s.assignments.find(
              (a) => a.date === d && a.crew === crew && a.role === role,
            )?.personId ?? null,
        );
        const filled = occupants.filter((o) => o !== null);
        if (filled.length > 1) {
          const uniq = new Set(filled);
          if (uniq.size > 1) {
            issues.push({
              kind: "block_weekend_inconsistent",
              detail: `${key} ${crew}/${role}: ${occupants.join(",")}`,
            });
          }
        }
      }
    }
  }

  // 6. At most one solo per day, referencing a real person.
  const soloDays = new Set<string>();
  for (const so of s.solos) {
    if (soloDays.has(so.date)) {
      issues.push({ kind: "duplicate_solo", detail: so.date });
    }
    soloDays.add(so.date);
    if (!peopleById.has(so.personId)) {
      issues.push({ kind: "orphan_solo", detail: so.date });
    }
  }

  // 7. Storage round-trip must be a fixed point (normalize of a clean export
  //    returns the same logical state — no data lost or mutated on save/load).
  const exported = JSON.parse(api.exportJson());
  const norm = normalize(exported);
  if (norm.assignments.length !== s.assignments.length) {
    issues.push({
      kind: "roundtrip_assignment_loss",
      detail: `${s.assignments.length} -> ${norm.assignments.length}`,
    });
  }
  if (norm.people.length !== s.people.length) {
    issues.push({
      kind: "roundtrip_people_loss",
      detail: `${s.people.length} -> ${norm.people.length}`,
    });
  }
  if (norm.solos.length !== s.solos.length) {
    issues.push({
      kind: "roundtrip_solo_loss",
      detail: `${s.solos.length} -> ${norm.solos.length}`,
    });
  }
  if (norm.splitWeekends.length !== s.splitWeekends.length) {
    issues.push({
      kind: "roundtrip_split_loss",
      detail: `${s.splitWeekends.length} -> ${norm.splitWeekends.length}`,
    });
  }

  return issues;
}

describe("comprehensive human-like simulation", () => {
  beforeEach(async () => {
    await AsyncStorageMock.clear();
  });

  it("survives many randomized rosters + operations with all invariants intact", async () => {
    const allIssues: Issue[] = [];

    for (let scenario = 0; scenario < 60; scenario++) {
      await AsyncStorageMock.clear();
      const rng = mulberry32(1000 + scenario * 7);
      const namer = makeNamer(rng);
      const { getApi } = await mountApp();

      // --- build a random crew ---
      const nCaptains = randInt(rng, 1, 6);
      const nCopilots = randInt(rng, 1, 6);
      act(() => {
        for (let i = 0; i < nCaptains; i++) getApi().addPerson(namer(), "captain");
        for (let i = 0; i < nCopilots; i++) getApi().addPerson(namer(), "copilot");
      });

      // randomly deactivate some, but keep >=1 active per role
      act(() => {
        const caps = getApi().state.people.filter((p) => p.role === "captain");
        const cops = getApi().state.people.filter((p) => p.role === "copilot");
        for (const group of [caps, cops]) {
          for (let i = 1; i < group.length; i++) {
            if (rng() < 0.25) getApi().setPersonActive(group[i].id, false);
          }
        }
      });

      const people = () => getApi().state.people;

      // random weights (within the persisted bounds)
      act(() => {
        getApi().updateSettings({
          windowDays: randInt(rng, 7, 60),
          dutyWeight: 0.5 + rng() * 3,
          weekendWeight: 0.5 + rng() * 4,
          standbyWeight: 0.5 + rng() * 3,
          specialWeight: 0.5 + rng() * 5,
        });
      });

      // a random future planning horizon
      const weekStart = startOfWeek(addDays(todayISO(), randInt(rng, 7, 120)));

      // Pre-fill a single weekend-day slot to stress block filling: the engine
      // must propagate this one occupant across the block (and never double-book
      // them). Only one slot is touched so we never manufacture a pre-existing
      // two-different-people block that no real UI could create.
      act(() => {
        const caps = people().filter((p) => p.role === "captain" && p.active);
        if (caps.length && rng() < 0.6) {
          const d = pick(rng, weekendDates(weekStart));
          getApi().logPastDuty(
            d,
            rng() < 0.5 ? "duty" : "standby",
            "captain",
            pick(rng, caps).id,
            rng() < 0.5,
          );
        }
      });

      // randomly split some weekends across the horizon
      const weeks = randInt(rng, 1, 6);
      act(() => {
        for (let w = 0; w < weeks; w++) {
          const thu = weekDates(addDays(weekStart, w * 7))[4];
          if (rng() < 0.5) getApi().setWeekendSplit(thu, true);
        }
      });

      // generate the schedule
      act(() => {
        getApi().generateWeek(weekStart, weeks);
      });

      allIssues.push(
        ...checkInvariants(getApi()).map((x) => ({
          ...x,
          detail: `s${scenario} after-gen: ${x.detail}`,
        })),
      );

      // --- random human edits ---
      const horizon = [weekDates(weekStart)];
      for (let w = 1; w < weeks; w++) horizon.push(weekDates(addDays(weekStart, w * 7)));
      const allDates = horizon.flat();

      for (let op = 0; op < 20; op++) {
        const r = rng();
        act(() => {
          const api = getApi();
          if (r < 0.18) {
            // swap a duty slot to a random eligible person. A block weekend is
            // edited as a whole (mirrors the real UI's WeekendBlockCard, which
            // commits via setWeekendBlock); split weekends + weekdays edit one
            // day.
            const date = pick(rng, allDates);
            const role: SlotRole = rng() < 0.5 ? "captain" : "copilot";
            const cands = api.recommendSlot(date, role).filter((c) => c.eligible);
            if (cands.length) {
              const pid = pick(rng, cands).person.id;
              if (isWeekend(date) && !api.isWeekendSplit(date)) {
                api.setWeekendBlock(date, "duty", role, pid);
              } else {
                api.setAssignment(date, "duty", role, pid);
              }
            }
          } else if (r < 0.32) {
            const date = pick(rng, allDates);
            api.toggleActivated(date, rng() < 0.5 ? "captain" : "copilot");
          } else if (r < 0.46) {
            // add a special
            const role: SlotRole = rng() < 0.5 ? "captain" : "copilot";
            const pool = people().filter((p) => p.role === role && p.active);
            if (pool.length) {
              api.addSpecial(
                pick(rng, ["eid", "natl_day", "custom_x"]),
                "Event",
                pick(rng, allDates),
                role,
                pick(rng, pool).id,
              );
            }
          } else if (r < 0.58) {
            // add a location duty
            const pool = people().filter((p) => p.active);
            if (pool.length) {
              const a = pick(rng, allDates);
              const b = addDays(a, randInt(rng, 0, 5));
              api.addLocation("Aqaba", a, b, pick(rng, pool).id);
            }
          } else if (r < 0.7) {
            // solo cover
            const pool = people().filter((p) => p.active);
            if (pool.length) {
              api.setSolo(pick(rng, allDates), pick(rng, pool).id);
            }
          } else if (r < 0.82) {
            // flip a weekend mode
            const thu = pick(rng, horizon)[4];
            api.setWeekendSplit(thu, !api.isWeekendSplit(thu));
          } else if (r < 0.9) {
            // change weights mid-flight
            api.updateSettings({ weekendWeight: 0.5 + rng() * 4 });
          } else if (r < 0.96) {
            // clear a day
            api.clearDay(pick(rng, allDates));
          } else {
            // delete a person (cascade)
            const ppl = people();
            if (ppl.length > 2) api.deletePerson(pick(rng, ppl).id);
          }
        });

        allIssues.push(
          ...checkInvariants(getApi()).map((x) => ({
            ...x,
            detail: `s${scenario} op${op}: ${x.detail}`,
          })),
        );
      }
    }

    if (allIssues.length) {
      const grouped: Record<string, number> = {};
      for (const i of allIssues) grouped[i.kind] = (grouped[i.kind] ?? 0) + 1;
      console.error("INVARIANT VIOLATIONS:", grouped);
      console.error(allIssues.slice(0, 25));
    }
    expect(allIssues).toEqual([]);
  });

  it("block weekend on a clean roster always assigns one consistent crew", async () => {
    for (let scenario = 0; scenario < 25; scenario++) {
      await AsyncStorageMock.clear();
      const rng = mulberry32(50 + scenario);
      const namer = makeNamer(rng);
      const { getApi } = await mountApp();
      act(() => {
        for (let i = 0; i < randInt(rng, 2, 5); i++) getApi().addPerson(namer(), "captain");
        for (let i = 0; i < randInt(rng, 2, 5); i++) getApi().addPerson(namer(), "copilot");
      });
      const weekStart = startOfWeek(addDays(todayISO(), randInt(rng, 7, 90)));
      act(() => {
        getApi().generateWeek(weekStart, randInt(rng, 1, 4));
      });
      const issues = checkInvariants(getApi()).filter(
        (i) => i.kind === "block_weekend_inconsistent" || i.kind === "double_booked",
      );
      expect(issues).toEqual([]);
    }
  });
});

// ---- storage robustness against malformed / hostile data ----
describe("storage normalize robustness", () => {
  it("drops malformed records and never lets corrupt data through", () => {
    const dirty = {
      people: [
        { id: "a", name: "Alice", role: "captain", active: true, createdAt: 0 },
        { id: "b", name: "Bob", role: "copilot", active: true, createdAt: 0 },
        { id: "", name: "NoId", role: "captain" }, // bad id -> dropped
        { id: "c", name: "  ", role: "captain" }, // blank name -> dropped
        { id: "d", name: "BadRole", role: "gunner" }, // bad role -> dropped
        { id: "a", name: "DupeId", role: "captain" }, // duplicate id -> dropped
      ],
      assignments: [
        { id: "x1", date: "2026-03-10", crew: "duty", role: "captain", personId: "a" },
        { id: "x2", date: "2026-13-40", crew: "duty", role: "captain", personId: "a" }, // bad date
        { id: "x3", date: "2026-03-10", crew: "duty", role: "captain", personId: "ghost" }, // unknown person
        { id: "x4", date: "2026-03-10", crew: "duty", role: "captain", personId: "a" }, // dup slot
        { id: "x5", date: "2026-02-30", crew: "duty", role: "captain", personId: "a" }, // rollover date
      ],
      specials: [{ id: "s", eventKey: "e", eventName: "E", date: "bad", role: "captain", personId: "a" }],
      locations: [
        { id: "l1", location: "Aqaba", startDate: "2026-03-10", endDate: "2026-03-01", personId: "a" }, // end<start
      ],
      solos: [
        { id: "so1", date: "2026-03-10", personId: "a" },
        { id: "so2", date: "2026-03-10", personId: "b" }, // dup day -> dropped
        { id: "so3", date: "2026-03-10", personId: "ghost" }, // unknown -> dropped
      ],
      splitWeekends: ["2026-03-10", "not-a-date", "2026-03-12"], // Mon dropped, Thu kept
      settings: {
        language: "ar",
        windowDays: 9999, // clamped to 90
        dutyWeight: -5, // clamped to 0.5
        weekendWeight: 100, // clamped to 10
        standbyWeight: "x", // invalid -> default
        specialWeight: 0,  // clamped to 0.5
      },
      version: 1,
    };

    const s = normalize(dirty);
    expect(s.people.map((p) => p.id).sort()).toEqual(["a", "b"]);
    // only the one valid, unique-slot assignment survives
    expect(s.assignments).toHaveLength(1);
    expect(s.assignments[0].id).toBe("x1");
    expect(s.specials).toHaveLength(0); // bad date dropped
    expect(s.locations).toHaveLength(0); // end<start dropped
    expect(s.solos).toHaveLength(1); // one per day, valid person
    expect(s.splitWeekends).toEqual(["2026-03-12"]); // only the real Thursday
    // settings clamped into legal bounds
    expect(s.settings.language).toBe("ar");
    expect(s.settings.windowDays).toBe(90);
    expect(s.settings.dutyWeight).toBe(0.5);
    expect(s.settings.weekendWeight).toBe(10);
    expect(s.settings.standbyWeight).toBe(DEFAULT_SETTINGS.standbyWeight);
    expect(s.settings.specialWeight).toBe(0.5);
  });

  it("rejects structurally invalid top-level data", () => {
    expect(() => normalize(null)).toThrow();
    expect(() => normalize(42)).toThrow();
    expect(() => normalize({ people: "nope", assignments: [] })).toThrow();
    expect(() => normalize({ people: [], assignments: {} })).toThrow();
  });

  it("is idempotent: normalize(normalize(x)) === normalize(x)", () => {
    const once = normalize({
      people: [
        { id: "a", name: "A", role: "captain", active: true, createdAt: 0 },
      ],
      assignments: [
        { id: "x", date: "2026-03-10", crew: "standby", role: "captain", personId: "a", activated: true },
      ],
      specials: [],
      locations: [],
      solos: [],
      splitWeekends: [],
      settings: DEFAULT_SETTINGS,
      version: 1,
    });
    const twice = normalize(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);
  });
});

// ---- fast pure-logic property tests (no React) ----
describe("fairness property tests", () => {
  function person(id: string, role: SlotRole, active = true): Person {
    return { id, name: id.toUpperCase(), role, active, createdAt: 0 };
  }

  // weighted load per captain id, for weight-behavior assertions
  function computeLoadsW(
    people: Person[],
    assignments: Assignment[],
    settings: Settings,
    ref: string,
  ): Map<string, number> {
    const loads = computeLoads(people, assignments, [], settings, "captain", ref);
    const out = new Map<string, number>();
    loads.forEach((l, id) => out.set(id, l.weighted));
    return out;
  }

  it("recommendForSlot sorts eligible before ineligible and by ascending load", () => {
    const rng = mulberry32(99);
    for (let t = 0; t < 200; t++) {
      const n = randInt(rng, 1, 8);
      const people = Array.from({ length: n }, (_, i) =>
        person("c" + i, "captain", rng() < 0.8),
      );
      const assignments: Assignment[] = [];
      const base = "2026-03-01";
      for (let k = 0; k < randInt(rng, 0, 20); k++) {
        const p = pick(rng, people);
        assignments.push({
          id: "a" + k,
          date: addDays(base, -randInt(rng, 0, 15)),
          crew: "duty",
          role: "captain",
          personId: p.id,
        });
      }
      const ref = "2026-03-16";
      const list = recommendForSlot(
        people,
        assignments,
        [],
        DEFAULT_SETTINGS,
        "captain",
        ref,
        ref,
      );
      // eligible block first
      let seenIneligible = false;
      for (const c of list) {
        if (!c.eligible) seenIneligible = true;
        else if (seenIneligible) throw new Error("eligible after ineligible");
      }
      // within eligible, load non-decreasing
      const elig = list.filter((c) => c.eligible);
      for (let i = 1; i < elig.length; i++) {
        expect(elig[i].load).toBeGreaterThanOrEqual(elig[i - 1].load - 1e-9);
      }
    }
  });

  it("weights drive load: heavier weekend/special weight raises weighted load", () => {
    const people = [person("a", "captain"), person("b", "captain")];
    // a works a weekend duty day; b works a weekday duty day.
    const assignments: Assignment[] = [
      { id: "1", date: "2026-03-12", crew: "duty", role: "captain", personId: "a" }, // Thu (weekend)
      { id: "2", date: "2026-03-10", crew: "duty", role: "captain", personId: "b" }, // Tue (weekday)
    ];
    const ref = "2026-03-16";
    const light = { ...DEFAULT_SETTINGS, weekendWeight: 1, dutyWeight: 1 };
    const heavy = { ...DEFAULT_SETTINGS, weekendWeight: 5, dutyWeight: 1 };
    const lLoad = computeLoadsW(people, assignments, light, ref);
    const hLoad = computeLoadsW(people, assignments, heavy, ref);
    // b (weekday) is unaffected by weekendWeight; a (weekend) scales up.
    expect(lLoad.get("b")).toBeCloseTo(1);
    expect(hLoad.get("b")).toBeCloseTo(1);
    expect(lLoad.get("a")).toBeCloseTo(1);
    expect(hLoad.get("a")).toBeCloseTo(5);
    expect(hLoad.get("a")!).toBeGreaterThan(lLoad.get("a")!);
  });

  it("recommendForLocation never returns an excluded or inactive person", () => {
    const rng = mulberry32(7);
    for (let t = 0; t < 200; t++) {
      const n = randInt(rng, 1, 8);
      const people = Array.from({ length: n }, (_, i) =>
        person("p" + i, rng() < 0.5 ? "captain" : "copilot", rng() < 0.85),
      );
      const excluded = new Set(
        people.filter(() => rng() < 0.3).map((p) => p.id),
      );
      const list = recommendForLocation(people, [], excluded);
      for (const c of list) {
        expect(c.person.active).toBe(true);
        expect(excluded.has(c.person.id)).toBe(false);
      }
      // counts non-decreasing (fewest-first rotation)
      for (let i = 1; i < list.length; i++) {
        expect(list[i].count).toBeGreaterThanOrEqual(list[i - 1].count);
      }
    }
  });
});
