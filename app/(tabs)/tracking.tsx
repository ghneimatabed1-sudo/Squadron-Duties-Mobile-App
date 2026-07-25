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
import { safeFileBase } from "@/lib/filenames";
import { exportRosterSheet } from "@/lib/io";
import { buildReportHtml, ReportSection } from "@/lib/reportHtml";
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
  const [checking, setChecking] = useState(false);
  const [exporting, setExporting] = useState(false);

  if (!app.ready) return <Loading />;
  const t = app.t;

  const validRange = isValidISO(from) && isValidISO(to) && from <= to;
  const hasPeople = app.state.people.some((p) => p.active && !p.availabilityOnly);
  const captains = validRange ? app.totals(from, to, "captain") : [];
  const copilots = validRange ? app.totals(from, to, "copilot") : [];

  // Anchor on the first of the month so month math never rolls over on the
  // 29th–31st (e.g. Mar 31 minus a month must give February, not March).
  const firstThis = startOfMonth(today);
  const firstPrev = addMonths(firstThis, -1);
  const quick: { key: string; label: string; range: () => [string, string] }[] = [
    { key: "d14", label: t("last_14"), range: () => [addDays(today, -13), today] },
    // Planned duties on future days count for fairness the moment they are
    // written — this range makes them visible without waiting for days to pass.
    { key: "n14", label: t("next_14"), range: () => [today, addDays(today, 13)] },
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

            <View style={{ flexDirection: row, gap: 8, marginTop: 14 }}>
              <View style={{ flex: 1 }}>
                <Btn
                  label={t("fairness_check")}
                  icon="check-circle"
                  variant="secondary"
                  onPress={() => setChecking(true)}
                  disabled={!validRange}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Btn
                  label={t("export_report")}
                  icon="share"
                  variant="secondary"
                  onPress={() => setExporting(true)}
                  disabled={!validRange}
                />
              </View>
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
      {checking ? (
        <FairnessCheckModal
          captains={captains}
          copilots={copilots}
          onClose={() => setChecking(false)}
        />
      ) : null}
      {exporting ? (
        <ExportReportModal
          captains={captains}
          copilots={copilots}
          from={from}
          to={to}
          onClose={() => setExporting(false)}
        />
      ) : null}
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
    () => app.recommendSlot(date, role, crew),
    [app, date, role, crew],
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

function FairnessCheckModal({
  captains,
  copilots,
  onClose,
}: {
  captains: PersonTotals[];
  copilots: PersonTotals[];
  onClose: () => void;
}) {
  const { colors, row, textAlign } = useUI();
  const app = useApp();
  const insets = useSafeAreaInsets();
  const t = app.t;

  // A person is flagged when they are a full turn (or more) away from the
  // group average — smaller fractions are unavoidable rounding, not unfairness.
  const THRESHOLD = 1;
  const groups: { label: string; rows: PersonTotals[] }[] = [
    { label: t("captains"), rows: captains },
    { label: t("copilots"), rows: copilots },
  ].map((g) => ({
    label: g.label,
    rows: g.rows.filter((r) => Math.abs(r.balance) >= THRESHOLD),
  }));
  const allGood = groups.every((g) => g.rows.length === 0);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: insets.bottom + 16, borderColor: colors.border }]}>
        <View style={{ flexDirection: row, alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <Text style={{ fontFamily: font.bold, fontSize: 18, color: colors.foreground }}>{t("fairness_check")}</Text>
          <IconButton icon="x" onPress={onClose} />
        </View>
        <ScrollView style={{ maxHeight: 480 }} showsVerticalScrollIndicator={false}>
          {allGood ? (
            <View style={{ flexDirection: row, gap: 10, alignItems: "center", padding: 14, borderRadius: colors.radius, backgroundColor: colors.primary + "14", borderWidth: StyleSheet.hairlineWidth, borderColor: colors.primary }}>
              <Feather name="check-circle" size={20} color={colors.primary} />
              <Text style={{ flex: 1, fontFamily: font.semibold, fontSize: 14.5, color: colors.foreground, textAlign }}>
                {t("fairness_all_good")}
              </Text>
            </View>
          ) : (
            <>
              <Text style={{ fontFamily: font.regular, fontSize: 13, color: colors.mutedForeground, lineHeight: 19, marginBottom: 12, textAlign }}>
                {t("fairness_issues_hint")}
              </Text>
              {groups.map((g) =>
                g.rows.length === 0 ? null : (
                  <View key={g.label} style={{ marginBottom: 12 }}>
                    <SectionLabel text={g.label} />
                    {g.rows.map((r) => {
                      const owed = r.balance < 0;
                      return (
                        <View
                          key={r.person.id}
                          style={{
                            flexDirection: row,
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: 12,
                            marginBottom: 8,
                            borderRadius: colors.radius,
                            backgroundColor: colors.card,
                            borderWidth: StyleSheet.hairlineWidth,
                            borderColor: colors.border,
                          }}
                        >
                          <Text style={{ fontFamily: font.semibold, fontSize: 14.5, color: colors.foreground, textAlign }}>
                            {r.person.name}
                          </Text>
                          <Pill
                            label={`${Math.abs(r.balance).toFixed(1)} ${owed ? t("owed") : t("ahead")}`}
                            tone={owed ? "owed" : "ahead"}
                          />
                        </View>
                      );
                    })}
                  </View>
                ),
              )}
            </>
          )}
          <View style={{ flexDirection: row, gap: 8, marginTop: 12 }}>
            <Feather name="info" size={14} color={colors.mutedForeground} />
            <Text style={{ flex: 1, fontFamily: font.regular, fontSize: 12.5, color: colors.mutedForeground, lineHeight: 18, textAlign }}>
              {t("fairness_check_hint")}
            </Text>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function ExportReportModal({
  captains,
  copilots,
  from,
  to,
  onClose,
}: {
  captains: PersonTotals[];
  copilots: PersonTotals[];
  from: string;
  to: string;
  onClose: () => void;
}) {
  const { colors, row, textAlign } = useUI();
  const app = useApp();
  const insets = useSafeAreaInsets();
  const t = app.t;

  const all = useMemo(() => [...captains, ...copilots], [captains, copilots]);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(all.map((r) => r.person.id)),
  );
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) => {
    tap();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const doExport = async () => {
    if (selected.size === 0 || busy) return;
    setBusy(true);
    try {
      const toSection = (label: string, rows: PersonTotals[]): ReportSection => ({
        title: label,
        rows: rows
          .filter((r) => selected.has(r.person.id))
          .map((r) => ({
            name: r.person.name,
            duty: r.duty,
            weekendDuty: r.weekendDuty,
            standby: r.standby,
            special: r.special,
            location: r.location,
            total: r.total,
            balance: r.balance,
          })),
      });
      const squadron = app.settings.squadronName.trim();
      const html = buildReportHtml({
        title: squadron ? `${squadron} — ${t("report_title")}` : t("report_title"),
        subtitle: `${fmtDate(app, from)}  →  ${fmtDate(app, to)}`,
        isRTL: app.isRTL,
        labels: {
          person: t("person"),
          duties: t("duties"),
          weekend: t("weekend_duties"),
          standbys: t("standbys"),
          specials: t("specials"),
          locations: t("locations"),
          total: t("total"),
          balance: t("balance"),
          owed: t("owed"),
          ahead: t("ahead"),
          balanced: t("balanced"),
        },
        sections: [toSection(t("captains"), captains), toSection(t("copilots"), copilots)],
      });
      const base = safeFileBase(
        `${squadron || t("report_title")} ${from} ${to}`,
        "Duty report",
      );
      await exportRosterSheet(html, `${base}.pdf`, { orientation: "portrait" });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: insets.bottom + 16, borderColor: colors.border }]}>
        <View style={{ flexDirection: row, alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <Text style={{ fontFamily: font.bold, fontSize: 18, color: colors.foreground }}>{t("export_report")}</Text>
          <IconButton icon="x" onPress={onClose} />
        </View>

        <View style={{ flexDirection: row, alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <Text style={{ fontFamily: font.medium, fontSize: 13, color: colors.mutedForeground, textAlign }}>
            {t("choose_people")}
          </Text>
          <View style={{ flexDirection: row, gap: 8 }}>
            <Btn
              label={t("select_all")}
              variant="ghost"
              onPress={() => setSelected(new Set(all.map((r) => r.person.id)))}
            />
            <Btn label={t("select_none")} variant="ghost" onPress={() => setSelected(new Set())} />
          </View>
        </View>

        <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
          {[
            { label: t("captains"), rows: captains },
            { label: t("copilots"), rows: copilots },
          ].map((g) =>
            g.rows.length === 0 ? null : (
              <View key={g.label} style={{ marginBottom: 10 }}>
                <SectionLabel text={g.label} />
                {g.rows.map((r) => {
                  const on = selected.has(r.person.id);
                  return (
                    <Pressable
                      key={r.person.id}
                      onPress={() => toggle(r.person.id)}
                      style={{
                        flexDirection: row,
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: 11,
                        marginBottom: 8,
                        borderRadius: colors.radius,
                        backgroundColor: on ? colors.primary + "14" : colors.card,
                        borderWidth: StyleSheet.hairlineWidth,
                        borderColor: on ? colors.primary : colors.border,
                      }}
                    >
                      <Text style={{ fontFamily: font.semibold, fontSize: 14.5, color: colors.foreground, textAlign }}>
                        {r.person.name}
                      </Text>
                      <Feather
                        name={on ? "check-circle" : "circle"}
                        size={19}
                        color={on ? colors.primary : colors.mutedForeground}
                      />
                    </Pressable>
                  );
                })}
              </View>
            ),
          )}
        </ScrollView>

        {selected.size === 0 ? (
          <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: colors.mutedForeground, marginTop: 8, textAlign }}>
            {t("no_one_selected")}
          </Text>
        ) : null}
        <View style={{ marginTop: 12 }}>
          <Btn
            label={t("export_report")}
            icon="share"
            onPress={doExport}
            disabled={selected.size === 0 || busy}
          />
        </View>
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
        <Stat icon="sun" label={t("weekend_duties")} value={row.weekendDuty} />
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
