import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  Btn,
  Card,
  DateField,
  EmptyState,
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
import {
  addDays,
  addMonths,
  dayOfWeek,
  endOfMonth,
  isValidISO,
  parseISO,
  startOfMonth,
  todayISO,
} from "@/lib/dates";
import { PersonTotals } from "@/lib/fairness";
import { CrewKind, SlotRole } from "@/lib/types";

export default function TrackingScreen() {
  const { colors, row } = useUI();
  const app = useApp();
  const today = todayISO();
  const [from, setFrom] = useState(() => startOfMonth(today));
  const [to, setTo] = useState(today);
  const [logging, setLogging] = useState(false);

  if (!app.ready) return <Loading />;
  const t = app.t;

  const validRange = isValidISO(from) && isValidISO(to) && from <= to;
  const hasPeople = app.state.people.some((p) => p.active);
  const captains = validRange ? app.totals(from, to, "captain") : [];
  const copilots = validRange ? app.totals(from, to, "copilot") : [];

  // Anchor on the first of the month so month math never rolls over on the
  // 29th–31st (e.g. Mar 31 minus a month must give February, not March).
  const firstThis = startOfMonth(today);
  const firstPrev = addMonths(firstThis, -1);
  const quick: { key: string; label: string; range: () => [string, string] }[] = [
    { key: "d14", label: t("last_14"), range: () => [addDays(today, -13), today] },
    { key: "this", label: t("this_month"), range: () => [firstThis, today] },
    {
      key: "last",
      label: t("last_month"),
      range: () => [firstPrev, endOfMonth(firstPrev)],
    },
    {
      key: "both",
      label: t("this_and_last"),
      range: () => [firstPrev, today],
    },
  ];
  const activeQuick = quick.find((q) => {
    const [qf, qt] = q.range();
    return qf === from && qt === to;
  })?.key;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Header
        title={t("tab_tracking")}
        right={
          hasPeople ? (
            <IconButton
              icon="plus"
              onPress={() => setLogging(true)}
              color={colors.primaryForeground}
              bg={colors.primary}
            />
          ) : undefined
        }
      />
      <Screen scroll>
        {!hasPeople ? (
          <EmptyState icon="bar-chart-2" title={t("tab_tracking")} hint={t("no_people")} />
        ) : (
          <>
            <View style={{ flexDirection: row, gap: 8, flexWrap: "wrap" }}>
              {quick.map((q) => {
                const on = activeQuick === q.key;
                return (
                  <Pressable
                    key={q.key}
                    onPress={() => {
                      tap();
                      const [qf, qt] = q.range();
                      setFrom(qf);
                      setTo(qt);
                    }}
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 8,
                      borderRadius: 999,
                      backgroundColor: on ? colors.primary : colors.card,
                      borderWidth: StyleSheet.hairlineWidth,
                      borderColor: on ? colors.primary : colors.border,
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: font.semibold,
                        fontSize: 13,
                        color: on ? colors.primaryForeground : colors.foreground,
                      }}
                    >
                      {q.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={{ gap: 12, marginTop: 14 }}>
              <DateField label={t("from")} value={from} onChange={setFrom} formatDate={(iso) => fmtDate(app, iso)} />
              <DateField label={t("to")} value={to} onChange={setTo} formatDate={(iso) => fmtDate(app, iso)} />
            </View>

            <View style={{ height: 16 }} />
            <SectionLabel text={t("captains")} />
            {captains.length === 0 ? (
              <Text style={{ fontFamily: font.regular, color: colors.mutedForeground }}>—</Text>
            ) : (
              captains.map((row) => <TotalRow key={row.person.id} row={row} />)
            )}

            <View style={{ height: 16 }} />
            <SectionLabel text={t("copilots")} />
            {copilots.length === 0 ? (
              <Text style={{ fontFamily: font.regular, color: colors.mutedForeground }}>—</Text>
            ) : (
              copilots.map((row) => <TotalRow key={row.person.id} row={row} />)
            )}

            <View style={{ flexDirection: row, gap: 8, marginTop: 16 }}>
              <Feather name="info" size={14} color={colors.mutedForeground} />
              <Text
                style={{
                  flex: 1,
                  fontFamily: font.regular,
                  fontSize: 12.5,
                  color: colors.mutedForeground,
                  lineHeight: 18,
                }}
              >
                {t("tracking_range_hint")}
              </Text>
            </View>
          </>
        )}
      </Screen>
      {logging ? <LogPastDutyModal onClose={() => setLogging(false)} /> : null}
    </View>
  );
}

function LogPastDutyModal({ onClose }: { onClose: () => void }) {
  const { colors, row, textAlign } = useUI();
  const app = useApp();
  const insets = useSafeAreaInsets();
  const t = app.t;

  const [date, setDate] = useState(todayISO());
  const [crew, setCrew] = useState<CrewKind>("duty");
  const [role, setRole] = useState<SlotRole>("captain");
  const [activated, setActivated] = useState(false);
  const [personId, setPersonId] = useState<string | null>(null);

  const candidates = useMemo(
    () => app.recommendSlot(date, role),
    [app, date, role],
  );
  const canSave = !!personId && isValidISO(date);

  const submit = () => {
    if (!canSave || !personId) return;
    app.logPastDuty(date, crew, role, personId, crew === "standby" ? activated : undefined);
    onClose();
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: insets.bottom + 16, borderColor: colors.border }]}>
        <View style={{ flexDirection: row, alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <Text style={{ fontFamily: font.bold, fontSize: 18, color: colors.foreground }}>{t("log_past_duty")}</Text>
          <IconButton icon="x" onPress={onClose} />
        </View>
        <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: colors.mutedForeground, lineHeight: 18, marginBottom: 14, textAlign }}>
          {t("past_duty_hint")}
        </Text>

        <ScrollView style={{ maxHeight: 480 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={{ gap: 14 }}>
            <DateField label={t("date")} value={date} onChange={setDate} formatDate={(iso) => fmtDate(app, iso)} />

            <View style={{ gap: 8 }}>
              <Text style={{ fontFamily: font.medium, fontSize: 13, color: colors.mutedForeground, textAlign }}>{t("crew")}</Text>
              <Segmented
                value={crew}
                onChange={(v) => {
                  setCrew(v);
                  setPersonId(null);
                }}
                options={[
                  { key: "duty", label: t("duty") },
                  { key: "standby", label: t("standby") },
                ]}
              />
            </View>

            <View style={{ gap: 8 }}>
              <Text style={{ fontFamily: font.medium, fontSize: 13, color: colors.mutedForeground, textAlign }}>{t("role")}</Text>
              <Segmented
                value={role}
                onChange={(v) => {
                  setRole(v);
                  setPersonId(null);
                }}
                options={[
                  { key: "captain", label: t("captain") },
                  { key: "copilot", label: t("copilot") },
                ]}
              />
            </View>

            {crew === "standby" ? (
              <Pressable
                onPress={() => {
                  tap();
                  setActivated((a) => !a);
                }}
                style={{
                  flexDirection: row,
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: 13,
                  borderRadius: colors.radius,
                  backgroundColor: activated ? colors.primary + "14" : colors.card,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: activated ? colors.primary : colors.border,
                }}
              >
                <Text style={{ fontFamily: font.semibold, fontSize: 14.5, color: colors.foreground, textAlign }}>
                  {t("activated")}
                </Text>
                <Feather
                  name={activated ? "check-circle" : "circle"}
                  size={20}
                  color={activated ? colors.primary : colors.mutedForeground}
                />
              </Pressable>
            ) : null}

            <View style={{ gap: 8 }}>
              <Text style={{ fontFamily: font.medium, fontSize: 13, color: colors.mutedForeground, textAlign }}>{t("priority_order")}</Text>
              {candidates.map((c) => {
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
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: font.semibold, fontSize: 14.5, color: colors.foreground }}>{c.person.name}</Text>
                    </View>
                    {selected ? <Feather name="check-circle" size={18} color={colors.primary} /> : null}
                  </Pressable>
                );
              })}
            </View>

            <Btn label={t("save")} icon="check" onPress={submit} disabled={!canSave} />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function fmtDate(app: ReturnType<typeof useApp>, iso: string): string {
  const d = parseISO(iso);
  return `${app.weekday(dayOfWeek(iso))} · ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

function TotalRow({ row }: { row: PersonTotals }) {
  const { colors, row: dir, textAlign } = useUI();
  const app = useApp();
  const t = app.t;

  const balanced = Math.abs(row.balance) < 0.25;
  const bp = balanced
    ? { label: t("balanced"), tone: "muted" as const }
    : row.balance < 0
      ? { label: `${Math.abs(row.balance).toFixed(1)} ${t("owed")}`, tone: "owed" as const }
      : { label: `${row.balance.toFixed(1)} ${t("ahead")}`, tone: "ahead" as const };

  return (
    <Card style={{ marginBottom: 8 }}>
      <View style={{ flexDirection: dir, alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <Text style={{ fontFamily: font.semibold, fontSize: 15.5, color: colors.foreground, textAlign }}>
          {row.person.name}
        </Text>
        <Pill label={bp.label} tone={bp.tone} />
      </View>
      <View style={{ flexDirection: dir, gap: 8, flexWrap: "wrap" }}>
        <Stat icon="shield" label={t("duties")} value={row.duty} />
        <Stat icon="clock" label={t("standbys")} value={row.standby} />
        <Stat icon="star" label={t("specials")} value={row.special} />
        <Stat icon="map-pin" label={t("locations")} value={row.location} />
      </View>
    </Card>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: number;
}) {
  const { colors, row } = useUI();
  return (
    <View
      style={{
        flexDirection: row,
        alignItems: "center",
        gap: 6,
        backgroundColor: colors.muted,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
      }}
    >
      <Feather name={icon} size={13} color={colors.mutedForeground} />
      <Text style={{ fontFamily: font.medium, fontSize: 12.5, color: colors.mutedForeground }}>
        {label}
      </Text>
      <Text style={{ fontFamily: font.bold, fontSize: 13, color: colors.foreground }}>{value}</Text>
    </View>
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
