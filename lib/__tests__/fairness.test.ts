import { describe, expect, it } from "vitest";

import {
  computeLoads,
  fairShare,
  previewSwap,
  recommendForSlot,
} from "../fairness";
import {
  Assignment,
  DEFAULT_SETTINGS,
  Person,
  Settings,
  SpecialAssignment,
} from "../types";

const settings: Settings = { ...DEFAULT_SETTINGS, windowDays: 21 };

function captain(id: string, name: string, active = true): Person {
  return { id, name, role: "captain", active, createdAt: 0 };
}

function duty(
  id: string,
  personId: string,
  date: string,
  crew: "duty" | "standby" = "duty",
  activated = false,
): Assignment {
  const a: Assignment = { id, date, crew, role: "captain", personId };
  if (crew === "standby") a.activated = activated;
  return a;
}

// A fixed reference date well after the test assignments so everything we place
// within the last few days lands inside the 21-day window.
const REF = "2026-01-22"; // Thursday

describe("computeLoads", () => {
  it("only counts active people in the requested role", () => {
    const people = [
      captain("a", "Alice"),
      captain("b", "Bob"),
      captain("c", "Carol", false), // inactive -> excluded
      { id: "d", name: "Dan", role: "copilot", active: true, createdAt: 0 } as Person,
    ];
    const loads = computeLoads(people, [], [], settings, "captain", REF);
    expect([...loads.keys()].sort()).toEqual(["a", "b"]);
  });

  it("applies weekday vs weekend weights for duty days", () => {
    const people = [captain("a", "Alice")];
    const assignments = [
      duty("1", "a", "2026-01-20"), // Tue -> weekday weight 1
      duty("2", "a", "2026-01-22"), // Thu -> weekend weight 1.5
    ];
    const loads = computeLoads(people, assignments, [], settings, "captain", REF);
    const a = loads.get("a")!;
    expect(a.weighted).toBeCloseTo(settings.dutyWeight + settings.weekendWeight);
    expect(a.dutyDays).toBe(2);
    expect(a.weekendDuty).toBe(1);
  });

  it("counts standby only when activated", () => {
    const people = [captain("a", "Alice"), captain("b", "Bob")];
    const assignments = [
      duty("1", "a", "2026-01-20", "standby", true), // activated -> counts
      duty("2", "b", "2026-01-20", "standby", false), // not activated -> 0 weight
    ];
    const loads = computeLoads(people, assignments, [], settings, "captain", REF);
    expect(loads.get("a")!.weighted).toBeCloseTo(settings.standbyWeight);
    expect(loads.get("a")!.standbyActivated).toBe(1);
    expect(loads.get("b")!.weighted).toBe(0);
    expect(loads.get("b")!.standbyActivated).toBe(0);
  });

  it("ignores duty outside the window for weight but still tracks lastDutyDate", () => {
    const people = [captain("a", "Alice")];
    const assignments = [
      duty("1", "a", "2025-12-01"), // far outside the 21-day window
    ];
    const loads = computeLoads(people, assignments, [], settings, "captain", REF);
    const a = loads.get("a")!;
    expect(a.weighted).toBe(0);
    expect(a.dutyDays).toBe(0);
    expect(a.lastDutyDate).toBe("2025-12-01");
  });

  it("adds special-event weight within the window", () => {
    const people = [captain("a", "Alice")];
    const specials: SpecialAssignment[] = [
      {
        id: "s1",
        eventKey: "eid",
        eventName: "Eid",
        date: "2026-01-21",
        role: "captain",
        personId: "a",
      },
    ];
    const loads = computeLoads(people, [], specials, settings, "captain", REF);
    expect(loads.get("a")!.weighted).toBeCloseTo(settings.specialWeight);
    expect(loads.get("a")!.specials).toBe(1);
  });
});

describe("fairShare", () => {
  it("returns 0 for an empty pool", () => {
    expect(fairShare(new Map())).toBe(0);
  });

  it("averages weighted load across the pool", () => {
    const people = [captain("a", "Alice"), captain("b", "Bob")];
    const assignments = [
      duty("1", "a", "2026-01-20"),
      duty("2", "a", "2026-01-21"),
    ];
    const loads = computeLoads(people, assignments, [], settings, "captain", REF);
    // a has 2 weekday duties (=2), b has 0 -> average 1
    expect(fairShare(loads)).toBeCloseTo(1);
  });
});

describe("recommendForSlot", () => {
  it("ranks the most-owed (lowest load) eligible person first", () => {
    const people = [captain("a", "Alice"), captain("b", "Bob")];
    const assignments = [
      duty("1", "a", "2026-01-20"),
      duty("2", "a", "2026-01-21"),
    ];
    const list = recommendForSlot(
      people,
      assignments,
      [],
      settings,
      "captain",
      REF,
      REF,
    );
    expect(list[0].person.id).toBe("b"); // owed -> picked first
    expect(list[0].balance).toBeLessThan(0);
    expect(list[1].person.id).toBe("a");
    expect(list[1].balance).toBeGreaterThan(0);
  });

  it("marks inactive people ineligible and sorts them last", () => {
    const people = [captain("a", "Alice"), captain("b", "Bob", false)];
    const list = recommendForSlot(people, [], [], settings, "captain", REF, REF);
    const bob = list.find((c) => c.person.id === "b")!;
    expect(bob.eligible).toBe(false);
    expect(bob.reasonKey).toBe("reason_inactive");
    expect(list[list.length - 1].person.id).toBe("b");
  });

  it("marks people already booked that day as double-booked", () => {
    const people = [captain("a", "Alice"), captain("b", "Bob")];
    const date = "2026-01-20";
    const assignments = [duty("1", "a", date)]; // a already on duty that day
    const list = recommendForSlot(
      people,
      assignments,
      [],
      settings,
      "captain",
      date,
      REF,
    );
    const alice = list.find((c) => c.person.id === "a")!;
    expect(alice.eligible).toBe(false);
    expect(alice.reasonKey).toBe("reason_double_booked");
    // The eligible Bob ranks ahead of the double-booked Alice.
    expect(list[0].person.id).toBe("b");
  });
});

describe("previewSwap", () => {
  it("reports balance changes when swapping a duty occupant", () => {
    const people = [captain("a", "Alice"), captain("b", "Bob")];
    const date = "2026-01-20";
    const assignments = [
      duty("1", "a", date), // Alice currently holds the slot
      duty("2", "a", "2026-01-19"), // extra load on Alice
    ];
    const preview = previewSwap(
      people,
      assignments,
      [],
      settings,
      "captain",
      date,
      "duty",
      "a", // swapping Alice out
      "b", // Bob in
      REF,
    );
    expect(preview.changes).toBe(true);
    // Alice loses load -> her balance drops; Bob gains -> his balance rises.
    expect(preview.outAfter!).toBeLessThan(preview.outBefore!);
    expect(preview.inAfter!).toBeGreaterThan(preview.inBefore!);
  });

  it("reports no change when swapping in the person already in the slot", () => {
    const people = [captain("a", "Alice"), captain("b", "Bob")];
    const date = "2026-01-20";
    const assignments = [duty("1", "a", date)];
    const preview = previewSwap(
      people,
      assignments,
      [],
      settings,
      "captain",
      date,
      "duty",
      "a",
      "a",
      REF,
    );
    expect(preview.changes).toBe(false);
  });
});
