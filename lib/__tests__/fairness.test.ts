import { describe, expect, it } from "vitest";

import {
  computeLoads,
  computeTotals,
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

function newcomerCaptain(id: string, name: string, activeSince: string): Person {
  return { id, name, role: "captain", active: true, activeSince, createdAt: 0 };
}

function singleCoverCaptain(id: string, name: string): Person {
  return { id, name, role: "captain", active: true, singleCover: true, createdAt: 0 };
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

  it("excludes single-cover people from the load pool", () => {
    const people = [
      captain("a", "Alice"),
      captain("b", "Bob"),
      singleCoverCaptain("s", "Sam"), // single cover -> excluded
    ];
    const assignments = [
      duty("1", "s", "2026-01-20"), // single-cover duty must not count
    ];
    const loads = computeLoads(people, assignments, [], settings, "captain", REF);
    expect([...loads.keys()].sort()).toEqual(["a", "b"]);
    expect(loads.has("s")).toBe(false);
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

  it("credits a newcomer to the group's pace so they enter balanced", () => {
    const established = captain("a", "Alice");
    const newcomer = newcomerCaptain("n", "Nora", REF); // joined today
    const assignments = [
      duty("1", "a", "2026-01-20"),
      duty("2", "a", "2026-01-21"), // Alice = weighted 2 over the window
    ];
    const loads = computeLoads(
      [established, newcomer],
      assignments,
      [],
      settings,
      "captain",
      REF,
    );
    const n = loads.get("n")!;
    // Real duty count stays 0; only the fairness weight is seeded.
    expect(n.dutyDays).toBe(0);
    // Effective weight lands near the established person's load (~2), so the
    // newcomer sits ~balanced instead of "most owed" at 0.
    const share = fairShare(loads);
    expect(Math.abs(n.weighted - share)).toBeLessThan(0.2);
  });

  it("ignores a returner's duties from before they rejoined (rejoins balanced)", () => {
    const established = captain("a", "Alice");
    // Returner whose old duty (Jan 19) is still inside the window but predates
    // their return (activeSince Jan 22) — it must NOT count as real load.
    const returner = newcomerCaptain("r", "Rita", REF);
    const assignments = [
      duty("1", "a", "2026-01-20"),
      duty("2", "a", "2026-01-21"), // Alice = weighted 2
      duty("3", "r", "2026-01-19"), // before Rita's return -> ignored
    ];
    const loads = computeLoads(
      [established, returner],
      assignments,
      [],
      settings,
      "captain",
      REF,
    );
    const r = loads.get("r")!;
    expect(r.dutyDays).toBe(0); // pre-return duty not counted
    const share = fairShare(loads);
    // Balanced on return, never "ahead" from stale pre-leave duties.
    expect(Math.abs(r.weighted - share)).toBeLessThan(0.2);
  });

  it("does not credit newcomers when neutralizing is turned off", () => {
    const newcomer = newcomerCaptain("n", "Nora", REF);
    const assignments = [duty("1", "a", "2026-01-20")];
    const loads = computeLoads(
      [captain("a", "Alice"), newcomer],
      assignments,
      [],
      settings,
      "captain",
      REF,
      false,
    );
    expect(loads.get("n")!.weighted).toBe(0);
  });

  it("leaves established people (no activeSince) unaffected", () => {
    const people = [captain("a", "Alice"), captain("b", "Bob")];
    const assignments = [duty("1", "a", "2026-01-20")];
    const on = computeLoads(people, assignments, [], settings, "captain", REF);
    const off = computeLoads(
      people,
      assignments,
      [],
      settings,
      "captain",
      REF,
      false,
    );
    expect(on.get("a")!.weighted).toBe(off.get("a")!.weighted);
    expect(on.get("b")!.weighted).toBe(off.get("b")!.weighted);
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

  it("does not dump duties on a fresh newcomer over a truly-owed veteran", () => {
    const a = captain("a", "Alice"); // veteran with load
    const b = captain("b", "Bob"); // veteran, genuinely owed (no recent duty)
    const n = newcomerCaptain("n", "Nora", REF); // joined today
    const assignments = [
      duty("1", "a", "2026-01-20"),
      duty("2", "a", "2026-01-21"),
    ];
    const list = recommendForSlot(
      [a, b, n],
      assignments,
      [],
      settings,
      "captain",
      REF,
      REF,
    );
    // The genuinely-owed veteran is picked first, not the newcomer.
    expect(list[0].person.id).toBe("b");
    const nora = list.find((c) => c.person.id === "n")!;
    // Newcomer enters ~balanced rather than "most owed".
    expect(Math.abs(nora.balance)).toBeLessThan(0.2);
    expect(nora.balance).toBeGreaterThan(list[0].balance);
  });

  it("marks inactive people ineligible and sorts them last", () => {
    const people = [captain("a", "Alice"), captain("b", "Bob", false)];
    const list = recommendForSlot(people, [], [], settings, "captain", REF, REF);
    const bob = list.find((c) => c.person.id === "b")!;
    expect(bob.eligible).toBe(false);
    expect(bob.reasonKey).toBe("reason_inactive");
    expect(list[list.length - 1].person.id).toBe("b");
  });

  it("keeps single-cover people selectable but sorts them below the rotation", () => {
    const people = [
      captain("a", "Alice"),
      captain("b", "Bob"),
      singleCoverCaptain("s", "Sam"),
    ];
    const list = recommendForSlot(people, [], [], settings, "captain", REF, REF);
    const sam = list.find((c) => c.person.id === "s")!;
    expect(sam.eligible).toBe(true); // still manually selectable
    expect(sam.singleCover).toBe(true);
    // Single-cover never sits ahead of an eligible normal pilot.
    expect(list[list.length - 1].person.id).toBe("s");
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

describe("computeTotals", () => {
  it("counts only duties inside the chosen date range (factual)", () => {
    const people = [captain("a", "Alice"), captain("b", "Bob")];
    const assignments = [
      duty("1", "a", "2026-01-10"), // January
      duty("2", "a", "2026-02-05"), // February
      duty("3", "b", "2026-02-10"), // February
    ];

    const feb = computeTotals(
      people,
      assignments,
      [],
      [],
      settings,
      "2026-02-01",
      "2026-02-28",
      "captain",
    );
    expect(feb.find((r) => r.person.id === "a")!.duty).toBe(1);
    expect(feb.find((r) => r.person.id === "b")!.duty).toBe(1);

    const jan = computeTotals(
      people,
      assignments,
      [],
      [],
      settings,
      "2026-01-01",
      "2026-01-31",
      "captain",
    );
    expect(jan.find((r) => r.person.id === "a")!.duty).toBe(1);
    expect(jan.find((r) => r.person.id === "b")!.duty).toBe(0);
  });

  it("does not neutralize newcomers — counts reflect real history", () => {
    const newcomer = newcomerCaptain("n", "Nora", "2026-02-01");
    const totals = computeTotals(
      [captain("a", "Alice"), newcomer],
      [duty("1", "a", "2026-02-10")],
      [],
      [],
      settings,
      "2026-02-01",
      "2026-02-28",
      "captain",
    );
    const nora = totals.find((r) => r.person.id === "n")!;
    expect(nora.duty).toBe(0);
    expect(nora.weighted).toBe(0);
  });
});
