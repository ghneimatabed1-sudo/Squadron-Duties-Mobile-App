import { beforeEach, describe, expect, it } from "vitest";

import AsyncStorageMock from "../../test/mocks/async-storage";
import { weekendDates } from "../dates";
import { loadState, normalize, saveState } from "../storage";
import { AppState, Person } from "../types";

const longName = "X".repeat(100);

function baseObj(squadronName: string) {
  const people: Person[] = [
    { id: "a", name: "Alice", role: "captain", active: true, createdAt: 0 },
  ];
  return {
    people,
    assignments: [],
    specials: [],
    locations: [],
    solos: [],
    settings: { language: "en", squadronName },
    version: 1,
  };
}

describe("squadron name clamping", () => {
  beforeEach(async () => {
    await AsyncStorageMock.clear();
  });

  it("clamps an over-long name to 60 chars on data import (normalize)", () => {
    const state = normalize(baseObj(longName));
    expect(state.settings.squadronName.length).toBe(60);
    expect(state.settings.squadronName).toBe("X".repeat(60));
  });

  it("keeps a within-limit name unchanged on import", () => {
    const state = normalize(baseObj("8th Squadron"));
    expect(state.settings.squadronName).toBe("8th Squadron");
  });

  it("clamps the name to 60 chars after rehydration from storage", async () => {
    // Simulate a too-long name slipping into persisted state (e.g. before the
    // input cap existed) and prove it is clamped when rehydrated.
    const dirty: AppState = {
      people: [
        { id: "a", name: "Alice", role: "captain", active: true, createdAt: 0 },
      ],
      assignments: [],
      specials: [],
      locations: [],
      locationDefs: [],
      solos: [],
      splitWeekends: [],
      settings: {
        language: "en",
        squadronName: longName,
        windowDays: 21,
        dutyWeight: 1,
        weekendWeight: 1.5,
        standbyWeight: 1,
        specialWeight: 3,
      },
      version: 1,
    };
    await saveState(dirty);
    const loaded = await loadState();
    expect(loaded).not.toBeNull();
    expect(loaded!.settings.squadronName.length).toBe(60);
    expect(loaded!.settings.squadronName).toBe("X".repeat(60));
  });
});

describe("split weekend normalization", () => {
  it("canonicalizes any weekend day key to its Thursday and dedupes", () => {
    // Friday of one weekend + Thursday of the same weekend should collapse to a
    // single Thursday key; a different weekend's Saturday becomes its Thursday.
    const friday = "2026-06-05"; // Fri
    const thuSame = weekendDates(friday)[0]; // Thu 2026-06-04
    const satOther = "2026-06-13"; // Sat
    const thuOther = weekendDates(satOther)[0];

    const state = normalize({
      ...baseObj("Sq"),
      splitWeekends: [friday, thuSame, satOther],
    });

    expect(state.splitWeekends).toContain(thuSame);
    expect(state.splitWeekends).toContain(thuOther);
    expect(state.splitWeekends).toHaveLength(2);
  });

  it("drops non-weekend keys", () => {
    const monday = "2026-06-01"; // Mon (not a weekend)
    const state = normalize({
      ...baseObj("Sq"),
      splitWeekends: [monday],
    });
    expect(state.splitWeekends).toHaveLength(0);
  });
});
