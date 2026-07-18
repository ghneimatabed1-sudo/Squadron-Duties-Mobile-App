import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  codeKey,
  defaultCodes,
  ensureCode,
  mergeAvailability,
  MergeResult,
  orderPeople,
  parseAvailabilityExport,
  sanitizeCode,
} from "@/lib/availability";
import { addDays, eachDay, startOfWeek, todayISO, weekDates, weekendDates } from "@/lib/dates";
import { buildDemoState } from "@/lib/demo";
import {
  Candidate,
  computeTotals,
  LocationCandidate,
  PersonTotals,
  recommendForLocation,
  recommendForLocationCrew,
  recommendForSlot,
  recommendForSpecial,
} from "@/lib/fairness";
import { makeT, weekdayNames, weekdayShort } from "@/lib/i18n";
import { autoFill, rebalanceAssignments, upsertAssignment } from "@/lib/schedule";
import { loadState, normalize, saveState } from "@/lib/storage";
import {
  AppState,
  Assignment,
  AvailabilityCode,
  CrewKind,
  DEFAULT_SETTINGS,
  DEFAULT_STATE,
  Language,
  LocationAssignment,
  LocationDef,
  MAX_EXTRA_CREWS,
  Person,
  Settings,
  SlotRole,
  SoloAssignment,
  SpecialAssignment,
  uid,
} from "@/lib/types";

export interface RebalanceChange {
  date: string;
  crew: CrewKind;
  role: SlotRole;
  crewIndex: number;
  oldId: string | null;
  newId: string | null;
}

interface AppContextValue {
  ready: boolean;
  state: AppState;
  settings: Settings;
  lang: Language;
  isRTL: boolean;
  t: (key: string, fallback?: string) => string;
  weekday: (dow: number) => string;
  weekdayAbbr: (dow: number) => string;

  // settings
  setLanguage: (lang: Language) => void;
  updateSettings: (partial: Partial<Settings>) => void;

  // people
  addPerson: (name: string, role: SlotRole, singleCover?: boolean) => void;
  setPersonActive: (id: string, active: boolean) => void;
  setPersonSingleCover: (id: string, singleCover: boolean) => void;
  deletePerson: (id: string) => void;

  // schedule
  getAssignment: (
    date: string,
    crew: CrewKind,
    role: SlotRole,
    crewIndex?: number,
  ) => Assignment | undefined;
  setAssignment: (
    date: string,
    crew: CrewKind,
    role: SlotRole,
    personId: string | null,
    crewIndex?: number,
  ) => void;
  setWeekendBlock: (
    anyDate: string,
    crew: CrewKind,
    role: SlotRole,
    personId: string | null,
  ) => void;
  toggleActivated: (date: string, role: SlotRole) => void;
  clearDay: (date: string) => void;
  generateWeek: (weekStart: string, weeks?: number) => void;
  rebalancePreview: (dates: string[]) => RebalanceChange[];
  applyRebalance: (dates: string[]) => void;

  // occasional extra duty crews (2 captains + 2 co-pilots on a day, etc.)
  extraCrewCount: (date: string) => number;
  addCrew: (date: string) => void;
  removeCrew: (date: string) => void;

  // per-weekend mode: block (one crew, default) vs split (one crew per day)
  isWeekendSplit: (date: string) => boolean;
  setWeekendSplit: (date: string, split: boolean) => void;

  // non-counting single-person cover
  getSolo: (date: string) => SoloAssignment | undefined;
  setSolo: (date: string, personId: string | null) => void;

  // events
  addSpecial: (
    eventKey: string,
    eventName: string,
    date: string,
    role: SlotRole,
    personId: string,
  ) => void;
  removeSpecial: (id: string) => void;
  addLocation: (
    location: string,
    startDate: string,
    endDate: string,
    personId: string,
  ) => void;
  updateLocation: (
    id: string,
    location: string,
    startDate: string,
    endDate: string,
    personId: string,
  ) => void;
  removeLocation: (id: string) => void;

  // plan-ahead crews (batch). Each special record is one person on one day for
  // one role; a crew is captain + co-pilot, multiple crews per day = more
  // records. Each location record is one person over a (possibly single-day)
  // range.
  planSpecials: (records: Omit<SpecialAssignment, "id">[]) => void;
  planLocations: (records: Omit<LocationAssignment, "id">[]) => void;

  // managed locations + per-location exclusions
  addLocationDef: (name: string) => void;
  removeLocationDef: (id: string) => void;
  toggleLocationExclusion: (defId: string, personId: string) => void;

  // historical backfill
  logPastDuty: (
    date: string,
    crew: CrewKind,
    role: SlotRole,
    personId: string,
    activated?: boolean,
  ) => void;

  // derived helpers
  recommendSlot: (date: string, role: SlotRole, crew?: CrewKind) => Candidate[];
  recommendSpecial: (eventKey: string, role: SlotRole) => Candidate[];
  recommendLocation: (excludedIds?: string[]) => LocationCandidate[];
  recommendLocationCrew: (
    dates: string[],
    role: SlotRole,
    locationName: string,
    siblingExcluded: string[],
  ) => Candidate[];
  totals: (startDate: string, endDate: string, role: SlotRole) => PersonTotals[];
  personName: (id: string) => string;

  // availability
  /** Active roster people in the FIXED manual order. */
  orderedPeople: Person[];
  getAvailability: (date: string, personId: string) => string | undefined;
  setAvailability: (date: string, personId: string, code: string | null) => void;
  updateAvailabilityCode: (
    id: string,
    partial: Partial<Pick<AvailabilityCode, "code" | "label" | "countsAsDayOff">>,
  ) => boolean;
  addAvailabilityCode: (code: string, label: string) => boolean;
  removeAvailabilityCode: (id: string) => void;
  moveRosterOrder: (personId: string, direction: -1 | 1) => void;
  importAvailabilityJson: (json: string) => MergeResult;

  // data
  exportJson: () => string;
  importJson: (json: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(DEFAULT_STATE);
  const [ready, setReady] = useState(false);
  const hydrated = useRef(false);

  useEffect(() => {
    (async () => {
      const loaded = await loadState();
      if (loaded) {
        setState(loaded);
      } else if (typeof __DEV__ !== "undefined" && __DEV__) {
        // DEV-only: seed a populated demo squadron so the preview is not blank.
        // Release builds always start clean for real data.
        setState({ ...buildDemoState(), availabilityCodes: defaultCodes() });
      } else {
        // Fresh install: start with the standard availability codes.
        setState((s) =>
          s.availabilityCodes.length ? s : { ...s, availabilityCodes: defaultCodes() },
        );
      }
      hydrated.current = true;
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (hydrated.current) saveState(state);
  }, [state]);

  const lang = state.settings.language;
  const isRTL = lang === "ar";
  const t = useMemo(() => makeT(lang), [lang]);
  const weekday = useCallback((dow: number) => weekdayNames[lang][dow], [lang]);
  const weekdayAbbr = useCallback(
    (dow: number) => weekdayShort[lang][dow],
    [lang],
  );

  const personName = useCallback(
    (id: string) => state.people.find((p) => p.id === id)?.name ?? "?",
    [state.people],
  );

  // ---- settings ----
  const setLanguage = useCallback((language: Language) => {
    setState((s) => ({ ...s, settings: { ...s.settings, language } }));
  }, []);
  const updateSettings = useCallback((partial: Partial<Settings>) => {
    setState((s) => ({ ...s, settings: { ...s.settings, ...partial } }));
  }, []);
  // ---- people ----
  const addPerson = useCallback(
    (name: string, role: SlotRole, singleCover: boolean = false) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      setState((s) => ({
        ...s,
        people: [
          ...s.people,
          {
            id: uid(),
            name: trimmed,
            role,
            active: true,
            singleCover,
            // New people enter the rotation balanced from today, never "owed".
            activeSince: todayISO(),
            createdAt: Date.now(),
          },
        ],
      }));
    },
    [],
  );
  const setPersonActive = useCallback((id: string, active: boolean) => {
    setState((s) => ({
      ...s,
      people: s.people.map((p) => {
        if (p.id !== id) return p;
        // When someone returns from being away, restamp activeSince so they
        // rejoin balanced — never forced to catch up to the others' totals.
        if (active && !p.active) {
          return { ...p, active, activeSince: todayISO() };
        }
        return { ...p, active };
      }),
    }));
  }, []);
  const setPersonSingleCover = useCallback(
    (id: string, singleCover: boolean) => {
      setState((s) => ({
        ...s,
        people: s.people.map((p) => {
          if (p.id !== id) return p;
          // Moving someone INTO the rotation (single cover -> off): restamp
          // activeSince so they join balanced and aren't forced to catch up to
          // everyone else's accumulated totals. Moving them OUT just flips it.
          if (p.singleCover && !singleCover) {
            return { ...p, singleCover, activeSince: todayISO() };
          }
          return { ...p, singleCover };
        }),
      }));
    },
    [],
  );
  const deletePerson = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      people: s.people.filter((p) => p.id !== id),
      assignments: s.assignments.filter((a) => a.personId !== id),
      specials: s.specials.filter((sp) => sp.personId !== id),
      locations: s.locations.filter((l) => l.personId !== id),
      locationDefs: s.locationDefs.map((d) => ({
        ...d,
        excluded: d.excluded.filter((pid) => pid !== id),
      })),
      solos: s.solos.filter((so) => so.personId !== id),
      availability: s.availability.filter((e) => e.personId !== id),
      rosterOrder: s.rosterOrder.filter((pid) => pid !== id),
    }));
  }, []);

  // ---- availability ----
  const orderedPeople = useMemo(
    () => orderPeople(state.people.filter((p) => p.active), state.rosterOrder),
    [state.people, state.rosterOrder],
  );

  const getAvailability = useCallback(
    (date: string, personId: string) =>
      state.availability.find((e) => e.date === date && e.personId === personId)
        ?.code,
    [state.availability],
  );

  const setAvailability = useCallback(
    (date: string, personId: string, code: string | null) => {
      setState((s) => {
        const rest = s.availability.filter(
          (e) => !(e.date === date && e.personId === personId),
        );
        if (!code || !sanitizeCode(code)) {
          return { ...s, availability: rest };
        }
        const r = ensureCode(s.availabilityCodes, code);
        return {
          ...s,
          availabilityCodes: r.codes,
          availability: [
            ...rest,
            { id: uid(), date, personId, code: r.code },
          ],
        };
      });
    },
    [],
  );

  const updateAvailabilityCode = useCallback(
    (
      id: string,
      partial: Partial<Pick<AvailabilityCode, "code" | "label" | "countsAsDayOff">>,
    ): boolean => {
      let ok = true;
      setState((s) => {
        const target = s.availabilityCodes.find((c) => c.id === id);
        if (!target) {
          ok = false;
          return s;
        }
        let newCode: string | undefined;
        if (partial.code !== undefined) {
          const clean = sanitizeCode(partial.code);
          if (!clean) {
            ok = false;
            return s;
          }
          // Block a rename that collides with a DIFFERENT existing code.
          const clash = s.availabilityCodes.find(
            (c) => c.id !== id && codeKey(c.code) === codeKey(clean),
          );
          if (clash) {
            ok = false;
            return s;
          }
          if (clean !== target.code) newCode = clean;
        }
        const oldKey = codeKey(target.code);
        return {
          ...s,
          availabilityCodes: s.availabilityCodes.map((c) =>
            c.id === id
              ? {
                  ...c,
                  ...(newCode !== undefined ? { code: newCode } : {}),
                  ...(partial.label !== undefined
                    ? {
                        label:
                          partial.label.trim().slice(0, 60) ||
                          (newCode ?? c.code),
                      }
                    : {}),
                  ...(partial.countsAsDayOff !== undefined
                    ? { countsAsDayOff: partial.countsAsDayOff }
                    : {}),
                }
              : c,
          ),
          // Renaming a code carries every existing day mark with it.
          availability:
            newCode !== undefined
              ? s.availability.map((e) =>
                  codeKey(e.code) === oldKey ? { ...e, code: newCode! } : e,
                )
              : s.availability,
        };
      });
      return ok;
    },
    [],
  );

  const addAvailabilityCode = useCallback(
    (code: string, label: string): boolean => {
      const clean = sanitizeCode(code);
      if (!clean) return false;
      let ok = true;
      setState((s) => {
        if (s.availabilityCodes.some((c) => codeKey(c.code) === codeKey(clean))) {
          ok = false;
          return s;
        }
        const r = ensureCode(s.availabilityCodes, clean, label);
        return { ...s, availabilityCodes: r.codes };
      });
      return ok;
    },
    [],
  );

  const removeAvailabilityCode = useCallback((id: string) => {
    setState((s) => {
      const target = s.availabilityCodes.find((c) => c.id === id);
      if (!target) return s;
      return {
        ...s,
        availabilityCodes: s.availabilityCodes.filter((c) => c.id !== id),
        // Marks using a deleted code are removed too — never orphaned.
        availability: s.availability.filter((e) => e.code !== target.code),
      };
    });
  }, []);

  const moveRosterOrder = useCallback(
    (personId: string, direction: -1 | 1) => {
      setState((s) => {
        // Materialize the full current order (listed + unlisted) so a first
        // move works even before the user has ever arranged anyone.
        const ids = orderPeople(
          s.people.filter((p) => p.active),
          s.rosterOrder,
        ).map((p) => p.id);
        const i = ids.indexOf(personId);
        const j = i + direction;
        if (i < 0 || j < 0 || j >= ids.length) return s;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        return { ...s, rosterOrder: ids };
      });
    },
    [],
  );

  const importAvailabilityJson = useCallback(
    (json: string): MergeResult => {
      const incoming = parseAvailabilityExport(json);
      const result = mergeAvailability(
        {
          people: state.people,
          entries: state.availability,
          codes: state.availabilityCodes,
          order: state.rosterOrder,
        },
        incoming,
      );
      setState((s) => ({
        ...s,
        availability: result.entries,
        availabilityCodes: result.codes,
        rosterOrder: result.order,
      }));
      return result;
    },
    [state.people, state.availability, state.availabilityCodes, state.rosterOrder],
  );

  // ---- schedule ----
  const getAssignment = useCallback(
    (date: string, crew: CrewKind, role: SlotRole, crewIndex = 0) =>
      state.assignments.find(
        (a) =>
          a.date === date &&
          a.crew === crew &&
          a.role === role &&
          (a.crewIndex ?? 0) === crewIndex,
      ),
    [state.assignments],
  );

  const upsert = useCallback(upsertAssignment, []);

  const setAssignment = useCallback(
    (
      date: string,
      crew: CrewKind,
      role: SlotRole,
      personId: string | null,
      crewIndex = 0,
    ) => {
      setState((s) => ({
        ...s,
        assignments: upsert(s.assignments, date, crew, role, personId, crewIndex),
      }));
    },
    [upsert],
  );

  const extraCrewCount = useCallback(
    (date: string) => Math.max(0, Math.floor(state.extraCrews[date] ?? 0)),
    [state.extraCrews],
  );

  const addCrew = useCallback((date: string) => {
    setState((s) => {
      const cur = Math.max(0, Math.floor(s.extraCrews[date] ?? 0));
      if (cur >= MAX_EXTRA_CREWS) return s;
      return { ...s, extraCrews: { ...s.extraCrews, [date]: cur + 1 } };
    });
  }, []);

  const removeCrew = useCallback((date: string) => {
    setState((s) => {
      const cur = Math.max(0, Math.floor(s.extraCrews[date] ?? 0));
      if (cur <= 0) return s;
      const next = cur - 1;
      const extraCrews = { ...s.extraCrews };
      if (next === 0) delete extraCrews[date];
      else extraCrews[date] = next;
      // Drop the assignments of the crew being removed (the highest index).
      const assignments = s.assignments.filter(
        (a) => !(a.date === date && (a.crewIndex ?? 0) === cur),
      );
      return { ...s, extraCrews, assignments };
    });
  }, []);

  const setWeekendBlock = useCallback(
    (anyDate: string, crew: CrewKind, role: SlotRole, personId: string | null) => {
      const dates = weekendDates(anyDate);
      setState((s) => {
        let next = s.assignments;
        for (const d of dates) next = upsert(next, d, crew, role, personId);
        return { ...s, assignments: next };
      });
    },
    [upsert],
  );

  const isWeekendSplit = useCallback(
    (date: string) => state.splitWeekends.includes(weekendDates(date)[0]),
    [state.splitWeekends],
  );

  const setWeekendSplit = useCallback(
    (date: string, split: boolean) => {
      const days = weekendDates(date);
      const key = days[0];
      setState((s) => {
        const rest = s.splitWeekends.filter((k) => k !== key);
        if (split) {
          return { ...s, splitWeekends: [...rest, key] };
        }
        // Merging back to a block: the block UI reads/writes only the reference
        // (Thursday) day, so propagate Thursday's crew across all weekend days
        // to keep state, UI, and exports consistent (no hidden Fri/Sat picks).
        const crews: CrewKind[] = ["duty", "standby"];
        const roles: SlotRole[] = ["captain", "copilot"];
        // Extra duty crews are a per-day, split-only exception. The block UI
        // cannot display or manage them, so drop any extra-crew assignments and
        // extraCrews counts across the weekend to avoid hidden/orphaned state.
        const daySet = new Set(days);
        let next = s.assignments.filter(
          (a) => !(daySet.has(a.date) && (a.crewIndex ?? 0) > 0),
        );
        for (const crew of crews) {
          for (const role of roles) {
            const ref = next.find(
              (a) => a.date === key && a.crew === crew && a.role === role,
            );
            const personId = ref?.personId ?? null;
            for (const d of days) {
              if (d === key) continue;
              next = upsert(next, d, crew, role, personId);
            }
          }
        }
        const extraCrews = { ...s.extraCrews };
        for (const d of days) delete extraCrews[d];
        return { ...s, splitWeekends: rest, assignments: next, extraCrews };
      });
    },
    [upsert],
  );

  const toggleActivated = useCallback((date: string, role: SlotRole) => {
    setState((s) => ({
      ...s,
      assignments: s.assignments.map((a) =>
        a.date === date && a.crew === "standby" && a.role === role
          ? { ...a, activated: !a.activated }
          : a,
      ),
    }));
  }, []);

  const clearDay = useCallback((date: string) => {
    setState((s) => {
      const extraCrews = { ...s.extraCrews };
      delete extraCrews[date];
      return {
        ...s,
        assignments: s.assignments.filter((a) => a.date !== date),
        solos: s.solos.filter((so) => so.date !== date),
        extraCrews,
      };
    });
  }, []);

  // ---- non-counting single-person cover ----
  const getSolo = useCallback(
    (date: string) => state.solos.find((so) => so.date === date),
    [state.solos],
  );
  const setSolo = useCallback((date: string, personId: string | null) => {
    setState((s) => {
      const rest = s.solos.filter((so) => so.date !== date);
      if (!personId) return { ...s, solos: rest };
      return { ...s, solos: [...rest, { id: uid(), date, personId }] };
    });
  }, []);

  const generateWeek = useCallback((weekStart: string, weeks: number = 1) => {
    setState((s) => {
      const dates: string[] = [];
      for (let w = 0; w < weeks; w++) {
        dates.push(...weekDates(addDays(weekStart, w * 7)));
      }
      const working = autoFill(
        {
          people: s.people,
          assignments: s.assignments,
          specials: s.specials,
          locations: s.locations,
          settings: s.settings,
          splitWeekends: s.splitWeekends,
          extraCrews: s.extraCrews,
        },
        dates,
      );
      return { ...s, assignments: working };
    });
  }, []);

  // Diff the current schedule for `dates` against a fully rebalanced version.
  // Returns one entry per slot whose occupant would change, so the UI can show
  // a preview before anything is written.
  const rebalancePreview = useCallback(
    (dates: string[]): RebalanceChange[] => {
      const dateSet = new Set(dates);
      const next = rebalanceAssignments(
        {
          people: state.people,
          assignments: state.assignments,
          specials: state.specials,
          locations: state.locations,
          settings: state.settings,
          splitWeekends: state.splitWeekends,
          extraCrews: state.extraCrews,
        },
        dates,
      );
      const slotKey = (a: Assignment) =>
        `${a.date}|${a.crew}|${a.role}|${a.crewIndex ?? 0}`;
      const before = new Map<string, Assignment>();
      for (const a of state.assignments)
        if (dateSet.has(a.date)) before.set(slotKey(a), a);
      const after = new Map<string, Assignment>();
      for (const a of next) if (dateSet.has(a.date)) after.set(slotKey(a), a);

      const changes: RebalanceChange[] = [];
      const keys = new Set([...before.keys(), ...after.keys()]);
      for (const k of keys) {
        const b = before.get(k);
        const a = after.get(k);
        const oldId = b?.personId ?? null;
        const newId = a?.personId ?? null;
        if (oldId === newId) continue;
        const ref = a ?? b!;
        changes.push({
          date: ref.date,
          crew: ref.crew,
          role: ref.role,
          crewIndex: ref.crewIndex ?? 0,
          oldId,
          newId,
        });
      }
      changes.sort(
        (x, y) =>
          x.date.localeCompare(y.date) ||
          x.crew.localeCompare(y.crew) ||
          x.role.localeCompare(y.role) ||
          x.crewIndex - y.crewIndex,
      );
      return changes;
    },
    [state],
  );

  const applyRebalance = useCallback((dates: string[]) => {
    setState((s) => ({
      ...s,
      assignments: rebalanceAssignments(
        {
          people: s.people,
          assignments: s.assignments,
          specials: s.specials,
          locations: s.locations,
          settings: s.settings,
          splitWeekends: s.splitWeekends,
          extraCrews: s.extraCrews,
        },
        dates,
      ),
    }));
  }, []);

  // ---- events ----
  const addSpecial = useCallback(
    (
      eventKey: string,
      eventName: string,
      date: string,
      role: SlotRole,
      personId: string,
    ) => {
      setState((s) => ({
        ...s,
        specials: [
          ...s.specials,
          { id: uid(), eventKey, eventName, date, role, personId },
        ],
      }));
    },
    [],
  );
  const removeSpecial = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      specials: s.specials.filter((sp) => sp.id !== id),
    }));
  }, []);
  const addLocation = useCallback(
    (location: string, startDate: string, endDate: string, personId: string) => {
      setState((s) => ({
        ...s,
        locations: [
          ...s.locations,
          { id: uid(), location, startDate, endDate, personId },
        ],
      }));
    },
    [],
  );
  const updateLocation = useCallback(
    (
      id: string,
      location: string,
      startDate: string,
      endDate: string,
      personId: string,
    ) => {
      setState((s) => ({
        ...s,
        locations: s.locations.map((l) =>
          l.id === id ? { ...l, location, startDate, endDate, personId } : l,
        ),
      }));
    },
    [],
  );
  const removeLocation = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      locations: s.locations.filter((l) => l.id !== id),
    }));
  }, []);

  const planSpecials = useCallback(
    (records: Omit<SpecialAssignment, "id">[]) => {
      if (!records.length) return;
      setState((s) => ({
        ...s,
        specials: [
          ...s.specials,
          ...records.map((r) => ({ ...r, id: uid() })),
        ],
      }));
    },
    [],
  );

  const planLocations = useCallback(
    (records: Omit<LocationAssignment, "id">[]) => {
      if (!records.length) return;
      setState((s) => {
        const newLocs = records.map((r) => ({ ...r, id: uid() }));
        const locations = [...s.locations, ...newLocs];

        // Every day touched by the new location stints.
        const touched = new Set<string>();
        for (const r of records)
          for (const d of eachDay(r.startDate, r.endDate)) touched.add(d);

        // A person sent to a location is OUT of the regular rotation on those
        // days — pull them off any duty/standby slot and any solo cover so the
        // schedule can rebalance the remaining pool around them.
        const onNewLocation = (personId: string, d: string): boolean =>
          newLocs.some(
            (l) => l.personId === personId && d >= l.startDate && d <= l.endDate,
          );
        const assignments = s.assignments.filter(
          (a) => !onNewLocation(a.personId, a.date),
        );
        const solos = s.solos.filter((so) => !onNewLocation(so.personId, so.date));

        // Backfill the vacated slots, fairly rebalanced (auto-fill never picks
        // anyone on a location stint, and only fills the now-empty slots).
        const dates = [...touched].sort();
        const filled = dates.length
          ? autoFill(
              {
                people: s.people,
                assignments,
                specials: s.specials,
                locations,
                settings: s.settings,
                splitWeekends: s.splitWeekends,
                extraCrews: s.extraCrews,
              },
              dates,
            )
          : assignments;

        return { ...s, locations, assignments: filled, solos };
      });
    },
    [],
  );

  // ---- managed locations + exclusions ----
  const addLocationDef = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setState((s) => {
      const key = trimmed.toLowerCase();
      if (s.locationDefs.some((d) => d.name.trim().toLowerCase() === key)) {
        return s;
      }
      return {
        ...s,
        locationDefs: [
          ...s.locationDefs,
          { id: uid(), name: trimmed, excluded: [] },
        ],
      };
    });
  }, []);
  const removeLocationDef = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      locationDefs: s.locationDefs.filter((d) => d.id !== id),
    }));
  }, []);
  const toggleLocationExclusion = useCallback(
    (defId: string, personId: string) => {
      setState((s) => ({
        ...s,
        locationDefs: s.locationDefs.map((d) =>
          d.id === defId
            ? {
                ...d,
                excluded: d.excluded.includes(personId)
                  ? d.excluded.filter((p) => p !== personId)
                  : [...d.excluded, personId],
              }
            : d,
        ),
      }));
    },
    [],
  );

  // ---- historical backfill ----
  const logPastDuty = useCallback(
    (
      date: string,
      crew: CrewKind,
      role: SlotRole,
      personId: string,
      activated?: boolean,
    ) => {
      setState((s) => {
        const rest = s.assignments.filter(
          (a) =>
            !(a.date === date && a.crew === crew && a.role === role) &&
            // Keep one slot per person per day, even when backfilling history.
            !(a.date === date && a.personId === personId),
        );
        rest.push({
          id: uid(),
          date,
          crew,
          role,
          personId,
          activated: crew === "standby" ? activated === true : undefined,
        });
        return { ...s, assignments: rest };
      });
    },
    [],
  );

  // ---- derived ----
  const recommendSlot = useCallback(
    (date: string, role: SlotRole, crew: CrewKind = "duty") =>
      recommendForSlot(
        state.people,
        state.assignments,
        state.specials,
        state.locations,
        state.settings,
        role,
        date,
        // Pass the crew kind so the queue matches auto-fill exactly: duty
        // slots use the weekday/weekend queue, standby uses its own queue.
        crew,
      ),
    [
      state.people,
      state.assignments,
      state.specials,
      state.locations,
      state.settings,
    ],
  );

  const recommendSpecial = useCallback(
    (eventKey: string, role: SlotRole) =>
      recommendForSpecial(
        state.people,
        state.assignments,
        state.specials,
        state.locations,
        role,
        eventKey,
      ),
    [
      state.people,
      state.assignments,
      state.specials,
      state.locations,
      state.settings,
    ],
  );

  const recommendLocation = useCallback(
    (excludedIds?: string[]) =>
      recommendForLocation(
        state.people,
        state.locations,
        excludedIds && excludedIds.length ? new Set(excludedIds) : undefined,
      ),
    [state.people, state.locations],
  );

  const recommendLocationCrew = useCallback(
    (
      dates: string[],
      role: SlotRole,
      locationName: string,
      siblingExcluded: string[],
    ) => {
      const def = state.locationDefs.find(
        (d) =>
          d.name.trim().toLowerCase() === locationName.trim().toLowerCase(),
      );
      return recommendForLocationCrew(
        state.people,
        state.locations,
        state.specials,
        role,
        dates,
        new Set(def?.excluded ?? []),
        new Set(siblingExcluded),
      );
    },
    [state.people, state.locations, state.specials, state.locationDefs],
  );

  const totals = useCallback(
    (startDate: string, endDate: string, role: SlotRole) =>
      computeTotals(
        state.people,
        state.assignments,
        state.specials,
        state.locations,
        startDate,
        endDate,
        role,
      ),
    [state.people, state.assignments, state.specials, state.locations],
  );

  // ---- data ----
  const exportJson = useCallback(() => JSON.stringify(state, null, 2), [state]);
  const importJson = useCallback((json: string) => {
    const parsed = normalize(JSON.parse(json));
    setState(parsed);
  }, []);

  const value: AppContextValue = {
    ready,
    state,
    settings: state.settings,
    lang,
    isRTL,
    t,
    weekday,
    weekdayAbbr,
    setLanguage,
    updateSettings,
    addPerson,
    setPersonActive,
    setPersonSingleCover,
    deletePerson,
    getAssignment,
    setAssignment,
    setWeekendBlock,
    toggleActivated,
    clearDay,
    generateWeek,
    rebalancePreview,
    applyRebalance,
    extraCrewCount,
    addCrew,
    removeCrew,
    isWeekendSplit,
    setWeekendSplit,
    getSolo,
    setSolo,
    addSpecial,
    removeSpecial,
    addLocation,
    planSpecials,
    planLocations,
    updateLocation,
    removeLocation,
    addLocationDef,
    removeLocationDef,
    toggleLocationExclusion,
    logPastDuty,
    recommendSlot,
    recommendSpecial,
    recommendLocation,
    recommendLocationCrew,
    totals,
    personName,
    orderedPeople,
    getAvailability,
    setAvailability,
    updateAvailabilityCode,
    addAvailabilityCode,
    removeAvailabilityCode,
    moveRosterOrder,
    importAvailabilityJson,
    exportJson,
    importJson,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

export { startOfWeek };
