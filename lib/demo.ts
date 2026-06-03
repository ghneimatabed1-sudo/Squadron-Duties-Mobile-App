import { addDays, eachDay, startOfWeek, todayISO } from "./dates";
import { autoFill } from "./schedule";
import {
  AppState,
  Assignment,
  DEFAULT_STATE,
  LocationAssignment,
  Person,
  SoloAssignment,
  SpecialAssignment,
} from "./types";

/**
 * A believable demo squadron so the in-app preview shows a fully-populated,
 * "human-like" roster with every scenario wired up: a normal duty rotation,
 * a planned location crew (which the rotation has adapted around), a special
 * event, and a single-person cover day.
 *
 * DEV-ONLY: seeded into an empty store while developing so the preview is not
 * blank. Release builds (where __DEV__ is false) never call this, so the
 * published app always starts clean for real squadron data.
 */
export function buildDemoState(): AppState {
  let seq = 0;
  const id = (p: string) => `demo-${p}-${seq++}`;

  const captains: Person[] = [
    "Lara",
    "Amer",
    "Radwan",
    "Bashar",
    "Bandar",
    "Motasem",
  ].map((name, i) => ({
    id: `cap-${name.toLowerCase()}`,
    name,
    role: "captain",
    active: true,
    createdAt: i,
  }));

  const copilots: Person[] = ["Aydam", "Aseel", "Mostafa", "Naamneh", "Maryam"].map(
    (name, i) => ({
      id: `co-${name.toLowerCase()}`,
      name,
      role: "copilot",
      active: true,
      createdAt: 10 + i,
    }),
  );

  // A commander who personally takes the odd day — never in the rotation.
  const commander: Person = {
    id: "cap-khaled",
    name: "Khaled",
    role: "captain",
    active: true,
    singleCover: true,
    createdAt: 20,
  };

  const people: Person[] = [...captains, ...copilots, commander];

  // Plan the current week + the next two weeks.
  const weekStart = startOfWeek(todayISO());
  const dates: string[] = [];
  for (let w = 0; w < 3; w++) {
    dates.push(...eachDay(addDays(weekStart, w * 7), addDays(weekStart, w * 7 + 6)));
  }

  const locationDefs = [
    { id: "loc-aqaba", name: "Aqaba", excluded: ["cap-bandar"] },
    { id: "loc-azraq", name: "Azraq", excluded: [] as string[] },
  ];

  // A location crew (Lara + Aydam) deployed to Aqaba for the first three days.
  const locStart = dates[0];
  const locEnd = dates[2];
  const locations: LocationAssignment[] = [
    {
      id: id("loc"),
      location: "Aqaba",
      startDate: locStart,
      endDate: locEnd,
      personId: "cap-lara",
    },
    {
      id: id("loc"),
      location: "Aqaba",
      startDate: locStart,
      endDate: locEnd,
      personId: "co-aydam",
    },
  ];

  // A special event (Independence Day) with its own crew on day 4.
  const eventDate = dates[3];
  const specials: SpecialAssignment[] = [
    {
      id: id("sp"),
      eventKey: "independence_day",
      eventName: "Independence Day",
      date: eventDate,
      role: "captain",
      personId: "cap-radwan",
    },
    {
      id: id("sp"),
      eventKey: "independence_day",
      eventName: "Independence Day",
      date: eventDate,
      role: "copilot",
      personId: "co-aseel",
    },
  ];

  // A single-person cover on day 5 (just a name on the sheet, no rotation cost).
  const soloDate = dates[4];
  const solos: SoloAssignment[] = [
    { id: id("solo"), date: soloDate, personId: "cap-khaled" },
  ];

  // Auto-fill the whole stretch around the planned location + event commitments.
  const assignments: Assignment[] = autoFill(
    {
      people,
      assignments: [],
      specials,
      locations,
      settings: DEFAULT_STATE.settings,
      splitWeekends: [],
      extraCrews: {},
    },
    dates,
  );

  return {
    ...DEFAULT_STATE,
    people,
    assignments,
    specials,
    locations,
    locationDefs,
    solos,
    settings: {
      ...DEFAULT_STATE.settings,
      squadronName: "NO.8 SQDN",
    },
  };
}
