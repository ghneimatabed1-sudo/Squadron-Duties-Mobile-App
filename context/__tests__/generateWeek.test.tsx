import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { beforeEach, describe, expect, it } from "vitest";

import AsyncStorageMock from "../../test/mocks/async-storage";
import { addDays, startOfWeek, todayISO, weekDates } from "../../lib/dates";
import { recommendForSlot } from "../../lib/fairness";
import {
  Assignment,
  CrewKind,
  DEFAULT_SETTINGS,
  Person,
  SlotRole,
  uid,
} from "../../lib/types";
import { AppProvider, useApp } from "../AppContext";

// Tell React this is a valid environment for act(...) so state updates flush
// synchronously and without warnings.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type AppContextValue = ReturnType<typeof useApp>;

// Capture the live context value so we can drive the real generateWeek reducer.
async function mountApp(): Promise<{ getApi: () => AppContextValue }> {
  let api: AppContextValue | null = null;
  function Probe() {
    api = useApp();
    return null;
  }
  // Async act so the provider's initial loadState() effect settles before we
  // start driving the reducer.
  await act(async () => {
    TestRenderer.create(
      <AppProvider>
        <Probe />
      </AppProvider>,
    );
  });
  return { getApi: () => api! };
}

// Two captains, one of whom (Alice) already carries several future duty days
// just before the planning horizon. With the slot's own date as the fairness
// reference, those duties sit inside the balancing window of the new horizon,
// so the engine pushes most new duty onto Bob to even things out. If the
// reference were todayISO() instead, all of these far-future dates would fall
// outside the window, both captains would read as zero-load, and the picks
// would merely alternate — failing the rebalance assertion below.
const PEOPLE: Person[] = [
  { id: "alice", name: "Alice", role: "captain", active: true, createdAt: 0 },
  { id: "bob", name: "Bob", role: "captain", active: true, createdAt: 1 },
];

function futureWeekStart(): string {
  // ~50 days out, snapped to the start of the week, so the whole 2-week
  // horizon and the pre-existing duties land well beyond today's window.
  return startOfWeek(addDays(todayISO(), 50));
}

function preExistingAliceDuty(weekStart: string): Assignment[] {
  // Six duty days immediately before the horizon, all assigned to Alice.
  return Array.from({ length: 6 }, (_, i) => ({
    id: `pre-${i}`,
    date: addDays(weekStart, -(i + 1)),
    crew: "duty" as CrewKind,
    role: "captain" as SlotRole,
    personId: "alice",
  }));
}

function countCaptainDuty(assignments: Assignment[], horizon: Set<string>) {
  const counts: Record<string, number> = { alice: 0, bob: 0 };
  for (const a of assignments) {
    if (a.role !== "captain" || a.crew !== "duty") continue;
    if (!horizon.has(a.date)) continue;
    counts[a.personId] = (counts[a.personId] ?? 0) + 1;
  }
  return counts;
}

describe("generateWeek forward planning", () => {
  beforeEach(async () => {
    await AsyncStorageMock.clear();
  });

  it("rebalances new picks across the 2-week horizon using slot-date fairness", async () => {
    const weekStart = futureWeekStart();
    const horizon = new Set<string>([
      ...weekDates(weekStart),
      ...weekDates(addDays(weekStart, 7)),
    ]);
    const pre = preExistingAliceDuty(weekStart);

    const { getApi } = await mountApp();
    act(() => {
      getApi().importJson(
        JSON.stringify({
          people: PEOPLE,
          assignments: pre,
          specials: [],
          locations: [],
          solos: [],
          settings: DEFAULT_SETTINGS,
          version: 1,
        }),
      );
    });
    // Weekends now default to a single block crew (one person ×3 days). Split
    // both horizon weekends so every day is picked independently and the
    // per-day rebalance assertion below stays meaningful.
    act(() => {
      getApi().setWeekendSplit(weekDates(weekStart)[4], true);
      getApi().setWeekendSplit(weekDates(addDays(weekStart, 7))[4], true);
    });
    act(() => {
      getApi().generateWeek(weekStart, 2);
    });

    const counts = countCaptainDuty(getApi().state.assignments, horizon);
    // 14 captain-duty slots over the 2-week horizon.
    expect(counts.alice + counts.bob).toBe(14);
    // Bob must absorb clearly more duty to compensate for Alice's prior load.
    // With a todayISO() reference this gap collapses to ~0 (simple alternation).
    expect(counts.bob - counts.alice).toBeGreaterThanOrEqual(4);
  });

  it("would NOT rebalance if today were used as the fairness reference", () => {
    // This mirrors generateWeek's loop but pins the reference to todayISO(),
    // demonstrating the regression the real code avoids: far-future picks no
    // longer rebalance and the split stays roughly even.
    const weekStart = futureWeekStart();
    const dates = [...weekDates(weekStart), ...weekDates(addDays(weekStart, 7))];
    const horizon = new Set(dates);
    const today = todayISO();
    const crews: CrewKind[] = ["duty", "standby"];
    const roles: SlotRole[] = ["captain", "copilot"];

    let working: Assignment[] = preExistingAliceDuty(weekStart);
    for (const date of dates) {
      for (const crew of crews) {
        for (const role of roles) {
          if (
            working.find(
              (a) => a.date === date && a.crew === crew && a.role === role,
            )
          ) {
            continue;
          }
          const cands = recommendForSlot(
            PEOPLE,
            working,
            [],
            DEFAULT_SETTINGS,
            role,
            date,
            today, // <-- the buggy reference
          );
          const pick = cands.find((c) => c.eligible);
          if (pick) {
            working.push({
              id: uid(),
              date,
              crew,
              role,
              personId: pick.person.id,
              activated: crew === "standby" ? false : undefined,
            });
          }
        }
      }
    }

    const counts = countCaptainDuty(working, horizon);
    expect(counts.alice + counts.bob).toBe(14);
    // The hallmark of the bug: no meaningful compensation for Alice's load.
    expect(counts.bob - counts.alice).toBeLessThanOrEqual(2);
  });

  it("assigns one crew across the whole weekend block by default", async () => {
    const weekStart = futureWeekStart();
    const wk = weekDates(weekStart);
    const [thu, fri, sat] = [wk[4], wk[5], wk[6]];

    const { getApi } = await mountApp();
    act(() => {
      getApi().importJson(
        JSON.stringify({
          people: PEOPLE,
          assignments: [],
          specials: [],
          locations: [],
          solos: [],
          settings: DEFAULT_SETTINGS,
          version: 1,
        }),
      );
    });
    act(() => {
      getApi().generateWeek(weekStart, 1);
    });

    const api = getApi();
    const cap = (d: string) =>
      api.getAssignment(d, "duty", "captain")?.personId;
    // A block weekend gets ONE captain covering Thu–Sat.
    expect(cap(thu)).toBeTruthy();
    expect(cap(fri)).toBe(cap(thu));
    expect(cap(sat)).toBe(cap(thu));
  });

  it("picks independent crews per day for a split weekend", async () => {
    const weekStart = futureWeekStart();
    const wk = weekDates(weekStart);
    const [thu, fri] = [wk[4], wk[5]];

    const { getApi } = await mountApp();
    act(() => {
      getApi().importJson(
        JSON.stringify({
          people: PEOPLE,
          assignments: [],
          specials: [],
          locations: [],
          solos: [],
          settings: DEFAULT_SETTINGS,
          version: 1,
        }),
      );
    });
    act(() => {
      getApi().setWeekendSplit(thu, true);
    });
    act(() => {
      getApi().generateWeek(weekStart, 1);
    });

    const api = getApi();
    const cap = (d: string) =>
      api.getAssignment(d, "duty", "captain")?.personId;
    // Split days are balanced independently, so adjacent days alternate
    // captains instead of repeating one block crew.
    expect(cap(thu)).toBeTruthy();
    expect(cap(fri)).not.toBe(cap(thu));
  });

  it("reconciles divergent day picks to the Thursday crew when merging back", async () => {
    const weekStart = futureWeekStart();
    const wk = weekDates(weekStart);
    const [thu, fri, sat] = [wk[4], wk[5], wk[6]];

    const { getApi } = await mountApp();
    act(() => {
      getApi().importJson(
        JSON.stringify({
          people: PEOPLE,
          assignments: [],
          specials: [],
          locations: [],
          solos: [],
          settings: DEFAULT_SETTINGS,
          version: 1,
        }),
      );
    });
    // Split, then deliberately set different captains across the weekend days.
    act(() => {
      getApi().setWeekendSplit(thu, true);
    });
    act(() => {
      getApi().setAssignment(thu, "duty", "captain", "alice");
      getApi().setAssignment(fri, "duty", "captain", "bob");
      getApi().setAssignment(sat, "duty", "captain", "bob");
    });
    // Merge back: all three days must adopt Thursday's crew (alice).
    act(() => {
      getApi().setWeekendSplit(thu, false);
    });

    const api = getApi();
    const cap = (d: string) =>
      api.getAssignment(d, "duty", "captain")?.personId;
    expect(api.isWeekendSplit(thu)).toBe(false);
    expect(cap(thu)).toBe("alice");
    expect(cap(fri)).toBe("alice");
    expect(cap(sat)).toBe("alice");
  });
});
