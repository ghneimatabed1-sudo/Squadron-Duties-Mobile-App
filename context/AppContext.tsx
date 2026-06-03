import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { addDays, startOfWeek, todayISO, weekDates, weekendDates } from "@/lib/dates";
import {
  Candidate,
  computeTotals,
  LocationCandidate,
  PersonTotals,
  previewSwap,
  recommendForLocation,
  recommendForSlot,
  recommendForSpecial,
  SwapPreview,
} from "@/lib/fairness";
import { makeT, weekdayNames, weekdayShort } from "@/lib/i18n";
import { autoFill, upsertAssignment } from "@/lib/schedule";
import { loadState, normalize, saveState } from "@/lib/storage";
import {
  AppState,
  Assignment,
  CrewKind,
  DEFAULT_SETTINGS,
  DEFAULT_STATE,
  Language,
  LocationAssignment,
  LocationDef,
  Person,
  Settings,
  SlotRole,
  SoloAssignment,
  SpecialAssignment,
  uid,
} from "@/lib/types";

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
  resetWeights: () => void;

  // people
  addPerson: (name: string, role: SlotRole, singleCover?: boolean) => void;
  setPersonActive: (id: string, active: boolean) => void;
  deletePerson: (id: string) => void;

  // schedule
  getAssignment: (
    date: string,
    crew: CrewKind,
    role: SlotRole,
  ) => Assignment | undefined;
  setAssignment: (
    date: string,
    crew: CrewKind,
    role: SlotRole,
    personId: string | null,
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
  recommendSlot: (date: string, role: SlotRole) => Candidate[];
  recommendSpecial: (eventKey: string, role: SlotRole) => Candidate[];
  recommendLocation: (excludedIds?: string[]) => LocationCandidate[];
  swapPreview: (
    date: string,
    crew: CrewKind,
    role: SlotRole,
    outId: string | null,
    inId: string,
  ) => SwapPreview;
  totals: (startDate: string, endDate: string, role: SlotRole) => PersonTotals[];
  personName: (id: string) => string;

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
      if (loaded) setState(loaded);
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
  const resetWeights = useCallback(() => {
    setState((s) => ({
      ...s,
      settings: {
        ...s.settings,
        dutyWeight: DEFAULT_SETTINGS.dutyWeight,
        weekendWeight: DEFAULT_SETTINGS.weekendWeight,
        standbyWeight: DEFAULT_SETTINGS.standbyWeight,
        specialWeight: DEFAULT_SETTINGS.specialWeight,
        windowDays: DEFAULT_SETTINGS.windowDays,
      },
    }));
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
    }));
  }, []);

  // ---- schedule ----
  const getAssignment = useCallback(
    (date: string, crew: CrewKind, role: SlotRole) =>
      state.assignments.find(
        (a) => a.date === date && a.crew === crew && a.role === role,
      ),
    [state.assignments],
  );

  const upsert = useCallback(upsertAssignment, []);

  const setAssignment = useCallback(
    (date: string, crew: CrewKind, role: SlotRole, personId: string | null) => {
      setState((s) => ({
        ...s,
        assignments: upsert(s.assignments, date, crew, role, personId),
      }));
    },
    [upsert],
  );

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
        let next = s.assignments;
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
        return { ...s, splitWeekends: rest, assignments: next };
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
    setState((s) => ({
      ...s,
      assignments: s.assignments.filter((a) => a.date !== date),
      solos: s.solos.filter((so) => so.date !== date),
    }));
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
          settings: s.settings,
          splitWeekends: s.splitWeekends,
        },
        dates,
      );
      return { ...s, assignments: working };
    });
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
    (date: string, role: SlotRole) =>
      recommendForSlot(
        state.people,
        state.assignments,
        state.specials,
        state.settings,
        role,
        date,
        // Use the slot's own date as the fairness reference so manual
        // recommendations for future days rebalance consistently with
        // multi-week auto-planning (today would exclude future picks from
        // the backward-looking window).
        date,
      ),
    [state.people, state.assignments, state.specials, state.settings],
  );

  const recommendSpecial = useCallback(
    (eventKey: string, role: SlotRole) =>
      recommendForSpecial(
        state.people,
        state.assignments,
        state.specials,
        state.settings,
        role,
        eventKey,
        todayISO(),
      ),
    [state.people, state.assignments, state.specials, state.settings],
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

  const swapPreview = useCallback(
    (
      date: string,
      crew: CrewKind,
      role: SlotRole,
      outId: string | null,
      inId: string,
    ) =>
      previewSwap(
        state.people,
        state.assignments,
        state.specials,
        state.settings,
        role,
        date,
        crew,
        outId,
        inId,
        // Reference the slot's own date so the before/after balances reflect
        // the window around that day (consistent with recommendSlot).
        date,
      ),
    [state.people, state.assignments, state.specials, state.settings],
  );

  const totals = useCallback(
    (startDate: string, endDate: string, role: SlotRole) =>
      computeTotals(
        state.people,
        state.assignments,
        state.specials,
        state.locations,
        state.settings,
        startDate,
        endDate,
        role,
      ),
    [
      state.people,
      state.assignments,
      state.specials,
      state.locations,
      state.settings,
    ],
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
    resetWeights,
    addPerson,
    setPersonActive,
    deletePerson,
    getAssignment,
    setAssignment,
    setWeekendBlock,
    toggleActivated,
    clearDay,
    generateWeek,
    isWeekendSplit,
    setWeekendSplit,
    getSolo,
    setSolo,
    addSpecial,
    removeSpecial,
    addLocation,
    updateLocation,
    removeLocation,
    addLocationDef,
    removeLocationDef,
    toggleLocationExclusion,
    logPastDuty,
    recommendSlot,
    recommendSpecial,
    recommendLocation,
    swapPreview,
    totals,
    personName,
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
