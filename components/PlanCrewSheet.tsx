import { Feather } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useApp } from "@/context/AppContext";
import { dayOfWeek, eachDay, isValidISO, parseISO, todayISO } from "@/lib/dates";
import {
  LocationAssignment,
  SlotRole,
  SpecialAssignment,
} from "@/lib/types";

import { Btn, DateField, Field, font, IconButton, Pill, Segmented, tap, useUI } from "./ui";

type Kind = "event" | "location";
type Mode = "same" | "perday";

interface Crew {
  key: string;
  captainId: string | null;
  copilotId: string | null;
}

const EVENT_PRESETS: { key: string; labelKey: string }[] = [
  { key: "independence_day", labelKey: "indep_day" },
  { key: "eid_fitr", labelKey: "eid_fitr" },
  { key: "eid_adha", labelKey: "eid_adha" },
  { key: "custom", labelKey: "custom_event" },
];

let crewSeq = 0;
function newCrew(): Crew {
  crewSeq += 1;
  return { key: `c${crewSeq}`, captainId: null, copilotId: null };
}

export function PlanCrewSheet({
  kind,
  visible,
  onClose,
}: {
  kind: Kind;
  visible: boolean;
  onClose: () => void;
}) {
  const { colors, row, textAlign } = useUI();
  const app = useApp();
  const insets = useSafeAreaInsets();
  const t = app.t;

  const [start, setStart] = useState(todayISO());
  const [end, setEnd] = useState(todayISO());
  const [mode, setMode] = useState<Mode>("same");

  // "same" mode: one set of crews covering the whole stretch.
  const [sameCrews, setSameCrews] = useState<Crew[]>([newCrew()]);
  // "per-day" mode: an independent set of crews per day.
  const [dayCrews, setDayCrews] = useState<Record<string, Crew[]>>({});

  // Event-only fields.
  const [presetKey, setPresetKey] = useState("independence_day");
  const [customName, setCustomName] = useState("");

  // Location-only field.
  const defs = app.state.locationDefs;
  const [locName, setLocName] = useState(defs[0]?.name ?? "");

  // Person picker (nested modal) state.
  const [picker, setPicker] = useState<{
    refDates: string[];
    role: SlotRole;
    excluded: string[];
    onSelect: (id: string) => void;
  } | null>(null);

  const reset = () => {
    setStart(todayISO());
    setEnd(todayISO());
    setMode("same");
    setSameCrews([newCrew()]);
    setDayCrews({});
    setPresetKey("independence_day");
    setCustomName("");
    setLocName(defs[0]?.name ?? "");
  };

  const close = () => {
    setPicker(null);
    reset();
    onClose();
  };

  const days = useMemo(
    () => (isValidISO(start) && isValidISO(end) && end >= start ? eachDay(start, end) : []),
    [start, end],
  );

  const eventKey =
    presetKey === "custom" ? `custom_${customName.trim().toLowerCase()}` : presetKey;
  const eventName =
    presetKey === "custom"
      ? customName.trim()
      : t(EVENT_PRESETS.find((p) => p.key === presetKey)!.labelKey);

  const fmt = (iso: string) => {
    const d = parseISO(iso);
    return `${app.weekday(dayOfWeek(iso))} · ${d.getDate()}/${d.getMonth() + 1}`;
  };

  // Ensure each in-range day owns at least one crew row in state, so reads are
  // pure (never mint a fresh crew during render — that breaks update/remove by
  // generating non-matching keys each render).
  useEffect(() => {
    if (mode !== "perday") return;
    setDayCrews((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const d of days) {
        if (!next[d] || next[d].length === 0) {
          next[d] = [newCrew()];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [mode, days]);

  // ---- crew mutation helpers ----
  const crewsForDay = (date: string): Crew[] => dayCrews[date] ?? [];
  const setCrewsForDay = (date: string, crews: Crew[]) =>
    setDayCrews((prev) => ({ ...prev, [date]: crews }));

  const updateSame = (key: string, patch: Partial<Crew>) =>
    setSameCrews((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  const updateDay = (date: string, key: string, patch: Partial<Crew>) =>
    setCrewsForDay(
      date,
      crewsForDay(date).map((c) => (c.key === key ? { ...c, ...patch } : c)),
    );

  // ---- validity ----
  const collectRecords = ():
    | { specials: Omit<SpecialAssignment, "id">[] }
    | { locations: Omit<LocationAssignment, "id">[] }
    | null => {
    if (!days.length) return null;

    if (kind === "event") {
      if (!eventName) return null;
      const out: Omit<SpecialAssignment, "id">[] = [];
      const pushCrew = (date: string, c: Crew) => {
        if (c.captainId)
          out.push({ eventKey, eventName, date, role: "captain", personId: c.captainId });
        if (c.copilotId)
          out.push({ eventKey, eventName, date, role: "copilot", personId: c.copilotId });
      };
      if (mode === "same") {
        for (const d of days) for (const c of sameCrews) pushCrew(d, c);
      } else {
        for (const d of days) for (const c of crewsForDay(d)) pushCrew(d, c);
      }
      return out.length ? { specials: out } : null;
    }

    // location
    if (!locName.trim()) return null;
    const location = locName.trim();
    const out: Omit<LocationAssignment, "id">[] = [];
    if (mode === "same") {
      for (const c of sameCrews) {
        if (c.captainId)
          out.push({ location, startDate: start, endDate: end, personId: c.captainId });
        if (c.copilotId)
          out.push({ location, startDate: start, endDate: end, personId: c.copilotId });
      }
    } else {
      for (const d of days)
        for (const c of crewsForDay(d)) {
          if (c.captainId)
            out.push({ location, startDate: d, endDate: d, personId: c.captainId });
          if (c.copilotId)
            out.push({ location, startDate: d, endDate: d, personId: c.copilotId });
        }
    }
    return out.length ? { locations: out } : null;
  };

  const records = collectRecords();
  const canSave = records !== null;

  const submit = () => {
    if (!records) return;
    if ("specials" in records) app.planSpecials(records.specials);
    else app.planLocations(records.locations);
    tap();
    close();
  };

  // Open the nested person picker for a crew slot.
  const openPicker = (
    refDates: string[],
    role: SlotRole,
    excluded: string[],
    onSelect: (id: string) => void,
  ) => {
    tap();
    setPicker({ refDates, role, excluded, onSelect });
  };

  const renderCrewRow = (
    crew: Crew,
    refDates: string[],
    siblings: Crew[],
    onPatch: (patch: Partial<Crew>) => void,
    onRemove: (() => void) | null,
  ) => {
    // Exclude people already picked for the same role in sibling crews on this day.
    const excludedCaptains = siblings
      .filter((c) => c.key !== crew.key)
      .map((c) => c.captainId)
      .filter((x): x is string => !!x);
    const excludedCopilots = siblings
      .filter((c) => c.key !== crew.key)
      .map((c) => c.copilotId)
      .filter((x): x is string => !!x);

    return (
      <View
        key={crew.key}
        style={{
          gap: 8,
          backgroundColor: colors.card,
          borderRadius: colors.radius,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          padding: 10,
        }}
      >
        <View style={{ flexDirection: row, alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ fontFamily: font.semibold, fontSize: 13, color: colors.mutedForeground, textAlign }}>
            {t("crew_label")}
          </Text>
          {onRemove ? (
            <IconButton
              icon="trash-2"
              size={15}
              onPress={() => {
                tap();
                onRemove();
              }}
              color={colors.destructive}
              bg={colors.destructive + "14"}
            />
          ) : null}
        </View>
        <PersonSlot
          roleLabel={t("choose_captain")}
          personId={crew.captainId}
          onPress={() =>
            openPicker(refDates, "captain", excludedCaptains, (id) =>
              onPatch({ captainId: id }),
            )
          }
          onClear={() => onPatch({ captainId: null })}
        />
        <PersonSlot
          roleLabel={t("choose_copilot")}
          personId={crew.copilotId}
          onPress={() =>
            openPicker(refDates, "copilot", excludedCopilots, (id) =>
              onPatch({ copilotId: id }),
            )
          }
          onClear={() => onPatch({ copilotId: null })}
        />
      </View>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} />
      <View
        style={[
          styles.sheet,
          { backgroundColor: colors.background, paddingBottom: insets.bottom + 16, borderColor: colors.border },
        ]}
      >
        <View style={{ flexDirection: row, alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <Text style={{ fontFamily: font.bold, fontSize: 18, color: colors.foreground, textAlign }}>
            {kind === "event" ? t("plan_special_event") : t("plan_special_location")}
          </Text>
          <IconButton icon="x" onPress={close} />
        </View>

        <ScrollView style={{ maxHeight: 520 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={{ gap: 14 }}>
            <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: colors.mutedForeground, lineHeight: 18, textAlign }}>
              {kind === "event" ? t("plan_event_hint") : t("plan_location_hint")}
            </Text>

            {kind === "event" ? (
              <View style={{ gap: 6 }}>
                <Text style={{ fontFamily: font.medium, fontSize: 13, color: colors.mutedForeground, textAlign }}>
                  {t("event")}
                </Text>
                <View style={{ flexDirection: row, flexWrap: "wrap", gap: 8 }}>
                  {EVENT_PRESETS.map((p) => {
                    const active = p.key === presetKey;
                    return (
                      <Pressable
                        key={p.key}
                        onPress={() => {
                          tap();
                          setPresetKey(p.key);
                        }}
                        style={{
                          paddingHorizontal: 12,
                          paddingVertical: 8,
                          borderRadius: 999,
                          backgroundColor: active ? colors.primary : colors.muted,
                        }}
                      >
                        <Text style={{ fontFamily: font.semibold, fontSize: 13, color: active ? colors.primaryForeground : colors.mutedForeground }}>
                          {t(p.labelKey)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {presetKey === "custom" ? (
                  <Field label={t("event_name")} value={customName} onChangeText={setCustomName} placeholder={t("event_name")} />
                ) : null}
              </View>
            ) : (
              <View style={{ gap: 8 }}>
                <Text style={{ fontFamily: font.medium, fontSize: 13, color: colors.mutedForeground, textAlign }}>
                  {t("choose_location")}
                </Text>
                {defs.length === 0 ? (
                  <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: colors.mutedForeground, textAlign }}>
                    {t("no_location_defs")}
                  </Text>
                ) : (
                  <View style={{ flexDirection: row, flexWrap: "wrap", gap: 8 }}>
                    {defs.map((d) => {
                      const sel = d.name.trim().toLowerCase() === locName.trim().toLowerCase();
                      return (
                        <Pressable
                          key={d.id}
                          onPress={() => {
                            tap();
                            setLocName(d.name);
                          }}
                          style={{
                            paddingHorizontal: 13,
                            paddingVertical: 8,
                            borderRadius: 999,
                            backgroundColor: sel ? colors.primary : colors.card,
                            borderWidth: StyleSheet.hairlineWidth,
                            borderColor: sel ? colors.primary : colors.border,
                          }}
                        >
                          <Text style={{ fontFamily: font.semibold, fontSize: 13.5, color: sel ? colors.primaryForeground : colors.foreground }}>
                            {d.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </View>
            )}

            <Text style={{ fontFamily: font.medium, fontSize: 13, color: colors.mutedForeground, textAlign }}>
              {t("plan_dates")}
            </Text>
            <DateField label={t("start_date")} value={start} onChange={setStart} formatDate={fmt} />
            <DateField label={t("end_date")} value={end} onChange={setEnd} formatDate={fmt} />

            <View style={{ gap: 6 }}>
              <Text style={{ fontFamily: font.medium, fontSize: 13, color: colors.mutedForeground, textAlign }}>
                {t("crew_mode")}
              </Text>
              <Segmented
                value={mode}
                onChange={setMode}
                options={[
                  { key: "same", label: t("same_crew") },
                  { key: "perday", label: t("per_day") },
                ]}
              />
              <Text style={{ fontFamily: font.regular, fontSize: 12, color: colors.mutedForeground, textAlign }}>
                {mode === "same" ? t("same_crew_hint") : t("per_day_hint")}
              </Text>
            </View>

            {mode === "same" ? (
              <View style={{ gap: 10 }}>
                {sameCrews.map((crew) =>
                  renderCrewRow(
                    crew,
                    days,
                    sameCrews,
                    (patch) => updateSame(crew.key, patch),
                    sameCrews.length > 1 ? () => setSameCrews((prev) => prev.filter((c) => c.key !== crew.key)) : null,
                  ),
                )}
                <Btn
                  label={t("add_crew")}
                  icon="plus"
                  variant="ghost"
                  size="sm"
                  onPress={() => {
                    tap();
                    setSameCrews((prev) => [...prev, newCrew()]);
                  }}
                />
              </View>
            ) : days.length === 0 ? null : (
              <View style={{ gap: 16 }}>
                {days.map((d) => {
                  const crews = crewsForDay(d);
                  return (
                    <View key={d} style={{ gap: 10 }}>
                      <Text style={{ fontFamily: font.bold, fontSize: 14, color: colors.foreground, textAlign }}>
                        {fmt(d)}
                      </Text>
                      {crews.map((crew) =>
                        renderCrewRow(
                          crew,
                          [d],
                          crews,
                          (patch) => updateDay(d, crew.key, patch),
                          crews.length > 1
                            ? () => setCrewsForDay(d, crews.filter((c) => c.key !== crew.key))
                            : null,
                        ),
                      )}
                      <Btn
                        label={t("add_crew")}
                        icon="plus"
                        variant="ghost"
                        size="sm"
                        onPress={() => {
                          tap();
                          setCrewsForDay(d, [...crews, newCrew()]);
                        }}
                      />
                    </View>
                  );
                })}
              </View>
            )}

            {!canSave ? (
              <Text style={{ fontFamily: font.regular, fontSize: 12, color: colors.mutedForeground, textAlign }}>
                {t("plan_crew_empty")}
              </Text>
            ) : null}

            <Btn label={t("confirm_plan")} icon="check" onPress={submit} disabled={!canSave} />
          </View>
        </ScrollView>
      </View>

      {picker ? (
        <PersonPickerModal
          kind={kind}
          locationName={locName}
          refDates={picker.refDates}
          role={picker.role}
          excluded={picker.excluded}
          onClose={() => setPicker(null)}
          onSelect={(id) => {
            picker.onSelect(id);
            setPicker(null);
          }}
        />
      ) : null}
    </Modal>
  );
}

function PersonSlot({
  roleLabel,
  personId,
  onPress,
  onClear,
}: {
  roleLabel: string;
  personId: string | null;
  onPress: () => void;
  onClear: () => void;
}) {
  const { colors, row, textAlign } = useUI();
  const app = useApp();
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: row,
        alignItems: "center",
        gap: 10,
        paddingVertical: 10,
        paddingHorizontal: 11,
        borderRadius: colors.radius,
        backgroundColor: colors.background,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
      }}
    >
      <Feather name={personId ? "user-check" : "user-plus"} size={16} color={personId ? colors.primary : colors.mutedForeground} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: font.medium, fontSize: 11.5, color: colors.mutedForeground, textAlign }}>
          {roleLabel}
        </Text>
        <Text style={{ fontFamily: font.semibold, fontSize: 14.5, color: personId ? colors.foreground : colors.mutedForeground, textAlign }}>
          {personId ? app.personName(personId) : "—"}
        </Text>
      </View>
      {personId ? (
        <IconButton
          icon="x"
          size={14}
          onPress={() => {
            tap();
            onClear();
          }}
          color={colors.mutedForeground}
          bg="transparent"
        />
      ) : (
        <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
      )}
    </Pressable>
  );
}

function PersonPickerModal({
  kind,
  locationName,
  refDates,
  role,
  excluded,
  onClose,
  onSelect,
}: {
  kind: Kind;
  locationName: string;
  refDates: string[];
  role: SlotRole;
  excluded: string[];
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const { colors, row, textAlign } = useUI();
  const app = useApp();
  const insets = useSafeAreaInsets();
  const t = app.t;
  const excludedSet = new Set(excluded);
  const refKey = refDates.join(",");

  // Location crews use their own rotation: any active person of the role may go
  // to a location even if they currently sit on the daily roster — assigning
  // them simply pulls them out of it. Only true conflicts (another location /
  // special on these days) or a per-location exclusion bar them. Events keep
  // the strict duty rules (recommendSlot), intersected across the stretch.
  const candidates = useMemo(() => {
    const dates = refDates.length ? refDates : [];
    if (kind === "location") {
      return app.recommendLocationCrew(dates, role, locationName, excluded);
    }
    const perDay = dates.map((d) => app.recommendSlot(d, role));
    const base = perDay[0] ?? [];
    return base
      .filter((c) => !excludedSet.has(c.person.id))
      .map((c) => {
        let eligible = c.eligible;
        let reasonKey = c.reasonKey;
        for (let i = 1; i < perDay.length; i++) {
          const cc = perDay[i].find((x) => x.person.id === c.person.id);
          if (cc && !cc.eligible) {
            eligible = false;
            reasonKey = cc.reasonKey;
            break;
          }
        }
        return { ...c, eligible, reasonKey };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, kind, locationName, refKey, role, excluded]);
  const firstEligible = candidates.find((c) => c.eligible)?.person.id;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View
        style={[
          styles.sheet,
          { backgroundColor: colors.background, paddingBottom: insets.bottom + 16, borderColor: colors.border },
        ]}
      >
        <View style={{ flexDirection: row, alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <Text style={{ fontFamily: font.bold, fontSize: 17, color: colors.foreground, textAlign }}>
            {role === "captain" ? t("choose_captain") : t("choose_copilot")}
          </Text>
          <IconButton icon="x" onPress={onClose} />
        </View>

        <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
          {candidates.length === 0 ? (
            <Text style={{ fontFamily: font.regular, fontSize: 13, color: colors.mutedForeground, textAlign, paddingVertical: 12 }}>
              —
            </Text>
          ) : (
            candidates.map((c) => (
              <Pressable
                key={c.person.id}
                disabled={!c.eligible}
                onPress={() => {
                  tap();
                  onSelect(c.person.id);
                }}
                style={{
                  flexDirection: row,
                  alignItems: "center",
                  gap: 10,
                  padding: 11,
                  borderRadius: colors.radius,
                  marginBottom: 6,
                  backgroundColor: colors.card,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: colors.border,
                  opacity: c.eligible ? 1 : 0.5,
                }}
              >
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={{ flexDirection: row, alignItems: "center", gap: 8 }}>
                    <Text style={{ fontFamily: font.semibold, fontSize: 14.5, color: colors.foreground, textAlign }}>
                      {c.person.name}
                    </Text>
                    {c.person.id === firstEligible ? <Pill label={t("recommended")} tone="primary" /> : null}
                  </View>
                  {!c.eligible ? (
                    <Text style={{ fontFamily: font.medium, fontSize: 12, color: colors.mutedForeground, textAlign }}>
                      {t(c.reasonKey ?? "not_eligible")}
                    </Text>
                  ) : null}
                </View>
                {c.eligible ? <Feather name="chevron-right" size={18} color={colors.mutedForeground} /> : null}
              </Pressable>
            ))
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
});
