import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  Btn,
  Card,
  DateField,
  EmptyState,
  Field,
  font,
  Header,
  IconButton,
  Loading,
  Pill,
  Screen,
  SectionLabel,
  Segmented,
  tap,
  useUI,
} from "@/components/ui";
import { useApp } from "@/context/AppContext";
import { dayOfWeek, isValidISO, parseISO, todayISO } from "@/lib/dates";
import { LocationAssignment, SlotRole } from "@/lib/types";

type Tab = "special" | "location";

export default function EventsScreen() {
  const { colors } = useUI();
  const app = useApp();
  const [tab, setTab] = useState<Tab>("special");

  if (!app.ready) return <Loading />;
  const t = app.t;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Header title={t("tab_events")} />
      <Screen scroll>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { key: "special", label: t("special_events") },
            { key: "location", label: t("location_duty") },
          ]}
        />
        <View style={{ height: 16 }} />
        {tab === "special" ? <SpecialSection /> : <LocationSection />}
      </Screen>
    </View>
  );
}

function fmt(app: ReturnType<typeof useApp>, iso: string): string {
  const d = parseISO(iso);
  return `${app.weekday(dayOfWeek(iso))} · ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

// ---------------- Special events ----------------

function SpecialSection() {
  const { colors, row, textAlign } = useUI();
  const app = useApp();
  const t = app.t;
  const [adding, setAdding] = useState(false);

  const sorted = [...app.state.specials].sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <View>
      <Btn label={t("add_special")} icon="plus" onPress={() => setAdding(true)} style={{ marginBottom: 14 }} />
      <View style={{ flexDirection: row, gap: 8, marginBottom: 14 }}>
        <Feather name="info" size={14} color={colors.mutedForeground} />
        <Text style={{ flex: 1, fontFamily: font.regular, fontSize: 12.5, color: colors.mutedForeground, lineHeight: 18 }}>
          {t("year_over_year_hint")}
        </Text>
      </View>

      {sorted.length === 0 ? (
        <EmptyState icon="star" title={t("special_events")} hint={t("no_specials")} />
      ) : (
        sorted.map((s) => (
          <Card key={s.id} style={{ marginBottom: 8 }}>
            <View style={{ flexDirection: row, alignItems: "center", gap: 10 }}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.accent + "22", alignItems: "center", justifyContent: "center" }}>
                <Feather name="star" size={16} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: font.semibold, fontSize: 15, color: colors.foreground, textAlign }}>
                  {s.eventName}
                </Text>
                <Text style={{ fontFamily: font.medium, fontSize: 12.5, color: colors.mutedForeground, textAlign }}>
                  {app.personName(s.personId)} · {t(s.role)} · {fmt(app, s.date)}
                </Text>
              </View>
              <IconButton icon="trash-2" size={16} onPress={() => app.removeSpecial(s.id)} color={colors.destructive} bg={colors.destructive + "14"} />
            </View>
          </Card>
        ))
      )}

      {adding ? <AddSpecialModal onClose={() => setAdding(false)} /> : null}
    </View>
  );
}

const PRESETS: { key: string; labelKey: string }[] = [
  { key: "independence_day", labelKey: "indep_day" },
  { key: "eid_fitr", labelKey: "eid_fitr" },
  { key: "eid_adha", labelKey: "eid_adha" },
  { key: "custom", labelKey: "custom_event" },
];

function AddSpecialModal({ onClose }: { onClose: () => void }) {
  const { colors, row } = useUI();
  const app = useApp();
  const insets = useSafeAreaInsets();
  const t = app.t;

  const [presetKey, setPresetKey] = useState("independence_day");
  const [customName, setCustomName] = useState("");
  const [role, setRole] = useState<SlotRole>("captain");
  const [date, setDate] = useState(todayISO());
  const [personId, setPersonId] = useState<string | null>(null);

  const eventKey = presetKey === "custom" ? `custom_${customName.trim().toLowerCase()}` : presetKey;
  const candidates = useMemo(
    () => app.recommendSpecial(eventKey, role),
    [app, eventKey, role],
  );
  const firstEligible = candidates.find((c) => c.eligible)?.person.id;

  const eventName =
    presetKey === "custom"
      ? customName.trim()
      : t(PRESETS.find((p) => p.key === presetKey)!.labelKey);

  const canSave = !!personId && !!eventName && isValidISO(date);

  const submit = () => {
    if (!canSave || !personId) return;
    app.addSpecial(eventKey, eventName, date, role, personId);
    onClose();
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: insets.bottom + 16, borderColor: colors.border }]}>
        <View style={{ flexDirection: row, alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <Text style={{ fontFamily: font.bold, fontSize: 18, color: colors.foreground }}>{t("add_special")}</Text>
          <IconButton icon="x" onPress={onClose} />
        </View>

        <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={{ gap: 14 }}>
            <View style={{ gap: 6 }}>
              <Text style={{ fontFamily: font.medium, fontSize: 13, color: colors.mutedForeground }}>{t("event")}</Text>
              <View style={{ flexDirection: row, flexWrap: "wrap", gap: 8 }}>
                {PRESETS.map((p) => {
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
            </View>

            {presetKey === "custom" ? (
              <Field label={t("event_name")} value={customName} onChangeText={setCustomName} placeholder={t("event_name")} />
            ) : null}

            <View style={{ gap: 6 }}>
              <Text style={{ fontFamily: font.medium, fontSize: 13, color: colors.mutedForeground }}>{t("role")}</Text>
              <Segmented
                value={role}
                onChange={(r) => {
                  setRole(r);
                  setPersonId(null);
                }}
                options={[
                  { key: "captain", label: t("captain") },
                  { key: "copilot", label: t("copilot") },
                ]}
              />
            </View>

            <DateField label={t("date")} value={date} onChange={setDate} formatDate={(iso) => fmt(app, iso)} />

            <View style={{ gap: 8 }}>
              <Text style={{ fontFamily: font.medium, fontSize: 13, color: colors.mutedForeground }}>{t("priority_order")}</Text>
              {candidates.map((c) => {
                const selected = c.person.id === personId;
                return (
                  <Pressable
                    key={c.person.id}
                    disabled={!c.eligible}
                    onPress={() => {
                      tap();
                      setPersonId(c.person.id);
                    }}
                    style={{
                      flexDirection: row,
                      alignItems: "center",
                      gap: 10,
                      padding: 11,
                      borderRadius: colors.radius,
                      backgroundColor: selected ? colors.primary + "14" : colors.card,
                      borderWidth: StyleSheet.hairlineWidth,
                      borderColor: selected ? colors.primary : colors.border,
                      opacity: c.eligible ? 1 : 0.5,
                    }}
                  >
                    <View style={{ flex: 1, gap: 4 }}>
                      <View style={{ flexDirection: row, alignItems: "center", gap: 8 }}>
                        <Text style={{ fontFamily: font.semibold, fontSize: 14.5, color: colors.foreground }}>{c.person.name}</Text>
                        {c.person.id === firstEligible ? <Pill label={t("recommended")} tone="primary" /> : null}
                      </View>
                      <Text style={{ fontFamily: font.medium, fontSize: 12, color: colors.mutedForeground }}>
                        {(c.eventCount ?? 0)} {t("times")}
                      </Text>
                    </View>
                    {selected ? <Feather name="check-circle" size={18} color={colors.primary} /> : null}
                  </Pressable>
                );
              })}
            </View>

            <Btn label={t("add")} icon="check" onPress={submit} disabled={!canSave} />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ---------------- Location duty ----------------

function LocationSection() {
  const { colors, row, textAlign } = useUI();
  const app = useApp();
  const t = app.t;
  const [editing, setEditing] = useState<LocationAssignment | null>(null);
  const [adding, setAdding] = useState(false);
  const [newLoc, setNewLoc] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const sorted = [...app.state.locations].sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  const defs = app.state.locationDefs;
  const people = app.state.people;

  const addDef = () => {
    if (!newLoc.trim()) return;
    app.addLocationDef(newLoc);
    setNewLoc("");
    tap();
  };

  return (
    <View>
      {/* ---- Locations & exclusions manager ---- */}
      <SectionLabel text={t("manage_locations")} />
      <View
        style={{
          flexDirection: row,
          gap: 8,
          marginBottom: 12,
          alignItems: "center",
        }}
      >
        <TextInput
          value={newLoc}
          onChangeText={setNewLoc}
          placeholder={t("add_location_name")}
          placeholderTextColor={colors.mutedForeground}
          onSubmitEditing={addDef}
          returnKeyType="done"
          style={{
            flex: 1,
            backgroundColor: colors.card,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.border,
            borderRadius: colors.radius,
            paddingHorizontal: 14,
            paddingVertical: 11,
            fontFamily: font.medium,
            fontSize: 15,
            color: colors.foreground,
            textAlign,
          }}
        />
        <IconButton
          icon="plus"
          onPress={addDef}
          color={colors.primaryForeground}
          bg={colors.primary}
        />
      </View>

      {defs.length === 0 ? (
        <Text
          style={{
            fontFamily: font.regular,
            fontSize: 12.5,
            color: colors.mutedForeground,
            lineHeight: 18,
            marginBottom: 18,
            textAlign,
          }}
        >
          {t("no_location_defs")}
        </Text>
      ) : (
        defs.map((d) => {
          const open = expanded === d.id;
          return (
            <Card key={d.id} style={{ marginBottom: 8 }}>
              <Pressable
                onPress={() => {
                  tap();
                  setExpanded(open ? null : d.id);
                }}
                style={{ flexDirection: row, alignItems: "center", gap: 10 }}
              >
                <Feather name="map-pin" size={16} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: font.semibold, fontSize: 15, color: colors.foreground, textAlign }}>
                    {d.name}
                  </Text>
                  <Text style={{ fontFamily: font.medium, fontSize: 12, color: colors.mutedForeground, textAlign }}>
                    {d.excluded.length > 0
                      ? `${d.excluded.length} ${t("excluded_word")}`
                      : t("everyone_eligible")}
                  </Text>
                </View>
                <Feather name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.mutedForeground} />
                <IconButton
                  icon="trash-2"
                  size={15}
                  onPress={() => app.removeLocationDef(d.id)}
                  color={colors.destructive}
                  bg={colors.destructive + "14"}
                />
              </Pressable>

              {open ? (
                <View style={{ marginTop: 12, gap: 8 }}>
                  <Text style={{ fontFamily: font.medium, fontSize: 12, color: colors.mutedForeground, textAlign }}>
                    {t("exclude_hint")}
                  </Text>
                  <View style={{ flexDirection: row, flexWrap: "wrap", gap: 8 }}>
                    {people.map((p) => {
                      const off = d.excluded.includes(p.id);
                      return (
                        <Pressable
                          key={p.id}
                          onPress={() => {
                            tap();
                            app.toggleLocationExclusion(d.id, p.id);
                          }}
                          style={{
                            flexDirection: row,
                            alignItems: "center",
                            gap: 6,
                            paddingHorizontal: 11,
                            paddingVertical: 7,
                            borderRadius: 999,
                            backgroundColor: off ? colors.destructive + "18" : colors.muted,
                            borderWidth: StyleSheet.hairlineWidth,
                            borderColor: off ? colors.destructive : colors.border,
                          }}
                        >
                          <Feather
                            name={off ? "slash" : "check"}
                            size={12}
                            color={off ? colors.destructive : colors.mutedForeground}
                          />
                          <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: off ? colors.destructive : colors.foreground }}>
                            {p.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : null}
            </Card>
          );
        })
      )}

      {/* ---- Assigned location duties ---- */}
      <View style={{ height: 8 }} />
      <SectionLabel text={t("assigned_duties")} />
      <Btn
        label={t("add_location")}
        icon="plus"
        size="sm"
        onPress={() => {
          if (defs.length === 0) return;
          setEditing(null);
          setAdding(true);
        }}
        disabled={defs.length === 0}
        style={{ marginBottom: 12, alignSelf: "flex-start" }}
      />
      {defs.length === 0 ? (
        <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: colors.mutedForeground, marginBottom: 8, textAlign }}>
          {t("select_location_first")}
        </Text>
      ) : null}

      {sorted.length === 0 ? (
        <EmptyState icon="map-pin" title={t("location_duty")} hint={t("no_locations")} />
      ) : (
        sorted.map((l) => (
          <Card key={l.id} style={{ marginBottom: 8 }}>
            <View style={{ flexDirection: row, alignItems: "center", gap: 10 }}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary + "18", alignItems: "center", justifyContent: "center" }}>
                <Feather name="map-pin" size={16} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: font.semibold, fontSize: 15, color: colors.foreground, textAlign }}>{l.location}</Text>
                <Text style={{ fontFamily: font.medium, fontSize: 12.5, color: colors.mutedForeground, textAlign }}>
                  {app.personName(l.personId)} · {fmt(app, l.startDate)} → {fmt(app, l.endDate)}
                </Text>
              </View>
              <IconButton
                icon="edit-2"
                size={15}
                onPress={() => {
                  setEditing(l);
                  setAdding(true);
                }}
              />
              <IconButton icon="trash-2" size={15} onPress={() => app.removeLocation(l.id)} color={colors.destructive} bg={colors.destructive + "14"} />
            </View>
          </Card>
        ))
      )}

      {adding ? (
        <AddLocationModal
          initial={editing}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      ) : null}
    </View>
  );
}

function AddLocationModal({
  initial,
  onClose,
}: {
  initial: LocationAssignment | null;
  onClose: () => void;
}) {
  const { colors, row, textAlign } = useUI();
  const app = useApp();
  const insets = useSafeAreaInsets();
  const t = app.t;
  const defs = app.state.locationDefs;

  const [name, setName] = useState(initial?.location ?? "");
  const [start, setStart] = useState(initial?.startDate ?? todayISO());
  const [end, setEnd] = useState(initial?.endDate ?? todayISO());
  const [personId, setPersonId] = useState<string | null>(initial?.personId ?? null);

  const activeDef = useMemo(
    () => defs.find((d) => d.name.trim().toLowerCase() === name.trim().toLowerCase()),
    [defs, name],
  );
  const candidates = useMemo(
    () => app.recommendLocation(activeDef?.excluded ?? []),
    [app, activeDef],
  );
  const firstId = candidates[0]?.person.id;
  const canSave =
    !!name.trim() && !!personId && isValidISO(start) && isValidISO(end) && end >= start;

  const submit = () => {
    if (!canSave || !personId) return;
    if (initial) {
      app.updateLocation(initial.id, name.trim(), start, end, personId);
    } else {
      app.addLocation(name.trim(), start, end, personId);
    }
    onClose();
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: insets.bottom + 16, borderColor: colors.border }]}>
        <View style={{ flexDirection: row, alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <Text style={{ fontFamily: font.bold, fontSize: 18, color: colors.foreground }}>
            {initial ? t("edit_location") : t("add_location")}
          </Text>
          <IconButton icon="x" onPress={onClose} />
        </View>

        <ScrollView style={{ maxHeight: 480 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={{ gap: 14 }}>
            <View style={{ gap: 8 }}>
              <Text style={{ fontFamily: font.medium, fontSize: 13, color: colors.mutedForeground, textAlign }}>
                {t("choose_location")}
              </Text>
              <View style={{ flexDirection: row, flexWrap: "wrap", gap: 8 }}>
                {defs.map((d) => {
                  const sel = d.name.trim().toLowerCase() === name.trim().toLowerCase();
                  return (
                    <Pressable
                      key={d.id}
                      onPress={() => {
                        tap();
                        setName(d.name);
                        if (d.excluded.includes(personId ?? "")) setPersonId(null);
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
            </View>

            <DateField label={t("start_date")} value={start} onChange={setStart} formatDate={(iso) => fmt(app, iso)} />
            <DateField label={t("end_date")} value={end} onChange={setEnd} formatDate={(iso) => fmt(app, iso)} />

            <View style={{ gap: 8 }}>
              <Text style={{ fontFamily: font.medium, fontSize: 13, color: colors.mutedForeground, textAlign }}>
                {t("next_priority")}
              </Text>
              {candidates.map((c, i) => {
                const selected = c.person.id === personId;
                return (
                  <Pressable
                    key={c.person.id}
                    onPress={() => {
                      tap();
                      setPersonId(c.person.id);
                    }}
                    style={{
                      flexDirection: row,
                      alignItems: "center",
                      gap: 10,
                      padding: 11,
                      borderRadius: colors.radius,
                      backgroundColor: selected ? colors.primary + "14" : colors.card,
                      borderWidth: StyleSheet.hairlineWidth,
                      borderColor: selected ? colors.primary : colors.border,
                    }}
                  >
                    <View
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 12,
                        backgroundColor: colors.muted,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Text style={{ fontFamily: font.bold, fontSize: 12, color: colors.mutedForeground }}>
                        {i + 1}
                      </Text>
                    </View>
                    <View style={{ flex: 1, gap: 4 }}>
                      <View style={{ flexDirection: row, alignItems: "center", gap: 8 }}>
                        <Text style={{ fontFamily: font.semibold, fontSize: 14.5, color: colors.foreground }}>{c.person.name}</Text>
                        {c.person.id === firstId ? <Pill label={t("recommended")} tone="primary" /> : null}
                        <Pill label={t(c.person.role)} tone="muted" />
                      </View>
                      <Text style={{ fontFamily: font.medium, fontSize: 12, color: colors.mutedForeground }}>
                        {c.count} {t("times")}
                      </Text>
                    </View>
                    {selected ? <Feather name="check-circle" size={18} color={colors.primary} /> : null}
                  </Pressable>
                );
              })}
            </View>

            <Btn label={initial ? t("save") : t("add")} icon="check" onPress={submit} disabled={!canSave} />
          </View>
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
