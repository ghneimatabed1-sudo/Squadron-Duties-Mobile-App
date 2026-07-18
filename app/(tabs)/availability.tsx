import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
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
import {
  buildAvailabilityExport,
  codeKey,
  countCodes,
  DayOffCandidate,
  recommendDayOff,
  sanitizeCode,
} from "@/lib/availability";
import { buildAvailabilityHtml } from "@/lib/availabilityHtml";
import {
  addDays,
  addMonths,
  dayOfWeek,
  endOfMonth,
  isValidISO,
  isWeekend,
  parseISO,
  startOfMonth,
  todayISO,
} from "@/lib/dates";
import { safeFileBase } from "@/lib/filenames";
import { exportRosterSheet, exportToFile, importFromFile } from "@/lib/io";
import { monthNames } from "@/lib/i18n";
import { Person } from "@/lib/types";

type Mode = "day" | "month" | "setup";

export default function AvailabilityScreen() {
  const { colors } = useUI();
  const app = useApp();
  const [mode, setMode] = useState<Mode>("day");
  const [exporting, setExporting] = useState(false);
  const [recommending, setRecommending] = useState(false);

  if (!app.ready) return <Loading />;
  const t = app.t;
  const hasPeople = app.orderedPeople.length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Header
        title={t("tab_availability")}
        right={
          hasPeople ? (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <IconButton
                icon="gift"
                onPress={() => setRecommending(true)}
                color={colors.foreground}
                bg={colors.muted}
              />
              <IconButton
                icon="share"
                onPress={() => setExporting(true)}
                color={colors.primaryForeground}
                bg={colors.primary}
              />
            </View>
          ) : undefined
        }
      />
      <Screen scroll>
        {!hasPeople ? (
          <EmptyState icon="clipboard" title={t("empty_roster")} hint={t("no_people")} />
        ) : (
          <>
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { key: "day", label: t("avail_day") },
                { key: "month", label: t("avail_month") },
                { key: "setup", label: t("avail_setup") },
              ]}
            />
            <View style={{ height: 14 }} />
            {mode === "day" ? <DayBoard /> : null}
            {mode === "month" ? <MonthView /> : null}
            {mode === "setup" ? <SetupView /> : null}
          </>
        )}
      </Screen>
      {exporting ? <ExportSheet onClose={() => setExporting(false)} /> : null}
      {recommending ? <RecommendSheet onClose={() => setRecommending(false)} /> : null}
    </View>
  );
}

function fmtDate(app: ReturnType<typeof useApp>, iso: string): string {
  const d = parseISO(iso);
  return `${app.weekday(dayOfWeek(iso))} · ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

function monthLabel(app: ReturnType<typeof useApp>, firstOfMonth: string): string {
  const d = parseISO(firstOfMonth);
  return `${monthNames[app.lang][d.getMonth()]} ${d.getFullYear()}`;
}

// ---------------- Day board ----------------

function DayBoard() {
  const { colors, row, textAlign } = useUI();
  const app = useApp();
  const t = app.t;
  const [date, setDate] = useState(todayISO());
  const [picking, setPicking] = useState<Person | null>(null);

  const codeMeaning = (code: string) =>
    app.state.availabilityCodes.find((c) => codeKey(c.code) === codeKey(code))
      ?.label;

  return (
    <View>
      <DateField label="" value={date} onChange={setDate} formatDate={(iso) => fmtDate(app, iso)} />
      <Text
        style={{
          fontFamily: font.regular,
          fontSize: 12.5,
          color: colors.mutedForeground,
          marginTop: 10,
          marginBottom: 12,
          textAlign,
        }}
      >
        {t("avail_day_hint")}
      </Text>
      {app.orderedPeople.map((p, i) => {
        const code = app.getAvailability(date, p.id);
        const meaning = code ? codeMeaning(code) : undefined;
        return (
          <Pressable
            key={p.id}
            onPress={() => {
              tap();
              setPicking(p);
            }}
          >
            <Card style={{ marginBottom: 8 }}>
              <View style={{ flexDirection: row, alignItems: "center", gap: 12 }}>
                <Text
                  style={{
                    fontFamily: font.bold,
                    fontSize: 13,
                    color: colors.mutedForeground,
                    width: 22,
                    textAlign: "center",
                  }}
                >
                  {i + 1}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: font.semibold, fontSize: 15, color: colors.foreground, textAlign }}>
                    {p.name}
                  </Text>
                  <Text style={{ fontFamily: font.regular, fontSize: 12, color: colors.mutedForeground, textAlign }}>
                    {t(p.role)}
                    {meaning && meaning !== code ? ` · ${meaning}` : ""}
                  </Text>
                </View>
                {code ? (
                  <Pill label={code} tone="accent" />
                ) : (
                  <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: colors.mutedForeground }}>
                    {t("avail_no_mark")}
                  </Text>
                )}
              </View>
            </Card>
          </Pressable>
        );
      })}
      {picking ? (
        <CodePickerSheet person={picking} date={date} onClose={() => setPicking(null)} />
      ) : null}
    </View>
  );
}

function CodePickerSheet({
  person,
  date,
  onClose,
}: {
  person: Person;
  date: string;
  onClose: () => void;
}) {
  const { colors, row, textAlign } = useUI();
  const app = useApp();
  const insets = useSafeAreaInsets();
  const t = app.t;
  const [custom, setCustom] = useState("");
  const current = app.getAvailability(date, person.id);

  // Most-used codes first so frequent ones are one tap away.
  const codes = useMemo(() => {
    const usage = new Map<string, number>();
    for (const e of app.state.availability) {
      const k = codeKey(e.code);
      usage.set(k, (usage.get(k) ?? 0) + 1);
    }
    return [...app.state.availabilityCodes].sort(
      (a, b) => (usage.get(codeKey(b.code)) ?? 0) - (usage.get(codeKey(a.code)) ?? 0),
    );
  }, [app.state.availability, app.state.availabilityCodes]);

  const pick = (code: string | null) => {
    app.setAvailability(date, person.id, code);
    onClose();
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View
        style={[
          styles.sheet,
          { backgroundColor: colors.background, paddingBottom: insets.bottom + 16, borderColor: colors.border },
        ]}
      >
        <View style={{ flexDirection: row, alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <Text style={{ fontFamily: font.bold, fontSize: 18, color: colors.foreground }}>{person.name}</Text>
          <IconButton icon="x" onPress={onClose} />
        </View>
        <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: colors.mutedForeground, marginBottom: 12, textAlign }}>
          {fmtDate(app, date)}
        </Text>
        <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
          <SectionLabel text={t("avail_pick_code")} />
          <View style={{ flexDirection: row, flexWrap: "wrap", gap: 8 }}>
            {codes.map((c) => {
              const on = current ? codeKey(current) === codeKey(c.code) : false;
              return (
                <Pressable
                  key={c.id}
                  onPress={() => {
                    tap();
                    pick(c.code);
                  }}
                  style={{
                    paddingHorizontal: 13,
                    paddingVertical: 9,
                    borderRadius: 12,
                    backgroundColor: on ? colors.primary : colors.card,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: on ? colors.primary : colors.border,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: font.bold,
                      fontSize: 14,
                      color: on ? colors.primaryForeground : colors.foreground,
                      textAlign: "center",
                    }}
                  >
                    {c.code}
                  </Text>
                  <Text
                    style={{
                      fontFamily: font.regular,
                      fontSize: 10.5,
                      color: on ? colors.primaryForeground : colors.mutedForeground,
                      textAlign: "center",
                    }}
                  >
                    {c.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={{ height: 14 }} />
          <Field
            label={t("avail_custom_code")}
            value={custom}
            onChangeText={setCustom}
            placeholder={t("avail_code_placeholder")}
          />
          <View style={{ height: 10 }} />
          <Btn
            label={t("save")}
            icon="check"
            onPress={() => pick(custom)}
            disabled={!sanitizeCode(custom)}
          />
          {current ? (
            <>
              <View style={{ height: 8 }} />
              <Btn label={t("avail_clear_mark")} icon="x" variant="ghost" onPress={() => pick(null)} />
            </>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ---------------- Month view ----------------

function MonthView() {
  const { colors, row, textAlign } = useUI();
  const app = useApp();
  const t = app.t;
  const [month, setMonth] = useState(() => startOfMonth(todayISO()));
  const [personId, setPersonId] = useState<string | null>(
    app.orderedPeople[0]?.id ?? null,
  );
  const person =
    app.orderedPeople.find((p) => p.id === personId) ?? app.orderedPeople[0];

  const monthEnd = endOfMonth(month);
  const daysInMonth = parseISO(monthEnd).getDate();

  const marks = useMemo(() => {
    const m = new Map<number, string>();
    if (!person) return m;
    for (const e of app.state.availability) {
      if (e.personId !== person.id) continue;
      if (e.date < month || e.date > monthEnd) continue;
      m.set(parseISO(e.date).getDate(), e.code);
    }
    return m;
  }, [app.state.availability, person, month, monthEnd]);

  const totals = useMemo(() => {
    if (!person) return [] as { code: string; count: number }[];
    const per = countCodes(app.state.availability, month, monthEnd).get(person.id);
    if (!per) return [];
    return [...per.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  }, [app.state.availability, person, month, monthEnd]);

  if (!person) return null;

  return (
    <View>
      <View style={{ flexDirection: row, alignItems: "center", justifyContent: "space-between" }}>
        <IconButton
          icon={app.isRTL ? "chevron-right" : "chevron-left"}
          onPress={() => setMonth((m) => startOfMonth(addMonths(m, -1)))}
        />
        <Text style={{ fontFamily: font.bold, fontSize: 16, color: colors.foreground }}>
          {monthLabel(app, month)}
        </Text>
        <IconButton
          icon={app.isRTL ? "chevron-left" : "chevron-right"}
          onPress={() => setMonth((m) => startOfMonth(addMonths(m, 1)))}
        />
      </View>
      <View style={{ height: 10 }} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {app.orderedPeople.map((p) => {
          const on = p.id === person.id;
          return (
            <Pressable
              key={p.id}
              onPress={() => {
                tap();
                setPersonId(p.id);
              }}
              style={{
                paddingHorizontal: 13,
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
                {p.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={{ height: 14 }} />
      <Card>
        <View style={{ flexDirection: row, flexWrap: "wrap" }}>
          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
            const iso = `${month.slice(0, 8)}${String(d).padStart(2, "0")}`;
            const wk = isWeekend(iso);
            const code = marks.get(d);
            return (
              <View
                key={d}
                style={{
                  width: `${100 / 7}%`,
                  paddingVertical: 7,
                  alignItems: "center",
                  backgroundColor: wk ? colors.muted : "transparent",
                  borderRadius: 8,
                }}
              >
                <Text style={{ fontFamily: font.regular, fontSize: 10.5, color: colors.mutedForeground }}>
                  {d}
                </Text>
                <Text
                  style={{
                    fontFamily: font.bold,
                    fontSize: 12.5,
                    color: code ? colors.primary : colors.border,
                    marginTop: 2,
                  }}
                  numberOfLines={1}
                >
                  {code ?? "·"}
                </Text>
              </View>
            );
          })}
        </View>
      </Card>
      <View style={{ height: 14 }} />
      <SectionLabel text={t("avail_month_totals")} />
      {totals.length === 0 ? (
        <Text style={{ fontFamily: font.regular, fontSize: 13, color: colors.mutedForeground, textAlign }}>
          {t("avail_no_marks")}
        </Text>
      ) : (
        <View style={{ flexDirection: row, flexWrap: "wrap", gap: 8 }}>
          {totals.map((x) => (
            <View
              key={x.code}
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
              <Text style={{ fontFamily: font.bold, fontSize: 12.5, color: colors.foreground }}>{x.code}</Text>
              <Text style={{ fontFamily: font.medium, fontSize: 12.5, color: colors.mutedForeground }}>
                {x.count}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ---------------- Setup: fixed order + codes ----------------

function SetupView() {
  const { colors, row, textAlign } = useUI();
  const app = useApp();
  const t = app.t;

  const confirmDeleteCode = (id: string) => {
    if (Platform.OS === "web") {
      // eslint-disable-next-line no-alert
      if (window.confirm(t("avail_delete_code_confirm"))) app.removeAvailabilityCode(id);
      return;
    }
    Alert.alert(t("avail_codes"), t("avail_delete_code_confirm"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("delete"), style: "destructive", onPress: () => app.removeAvailabilityCode(id) },
    ]);
  };

  return (
    <View>
      <SectionLabel text={t("avail_order")} />
      <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: colors.mutedForeground, marginBottom: 10, lineHeight: 18, textAlign }}>
        {t("avail_order_hint")}
      </Text>
      {app.orderedPeople.map((p, i) => (
        <Card key={p.id} style={{ marginBottom: 8 }}>
          <View style={{ flexDirection: row, alignItems: "center", gap: 12 }}>
            <Text style={{ fontFamily: font.bold, fontSize: 13, color: colors.mutedForeground, width: 22, textAlign: "center" }}>
              {i + 1}
            </Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: font.semibold, fontSize: 15, color: colors.foreground, textAlign }}>
                {p.name}
              </Text>
              <Text style={{ fontFamily: font.regular, fontSize: 12, color: colors.mutedForeground, textAlign }}>
                {t(p.role)}
              </Text>
            </View>
            <IconButton icon="arrow-up" size={16} onPress={() => app.moveRosterOrder(p.id, -1)} />
            <IconButton icon="arrow-down" size={16} onPress={() => app.moveRosterOrder(p.id, 1)} />
          </View>
        </Card>
      ))}

      <View style={{ height: 18 }} />
      <SectionLabel text={t("avail_codes")} />
      <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: colors.mutedForeground, marginBottom: 10, lineHeight: 18, textAlign }}>
        {t("avail_codes_hint")}
      </Text>
      {app.state.availabilityCodes.map((c) => (
        <CodeRow key={c.id} id={c.id} onDelete={() => confirmDeleteCode(c.id)} />
      ))}
      <AddCodeCard />
    </View>
  );
}

function AddCodeCard() {
  const { colors, row } = useUI();
  const app = useApp();
  const t = app.t;
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const ok = app.addAvailabilityCode(code, label);
    if (!ok) {
      setError(t("avail_code_exists"));
      return;
    }
    setCode("");
    setLabel("");
    setError(null);
  };

  return (
    <Card style={{ marginTop: 4, gap: 10 }}>
      <View style={{ flexDirection: row, gap: 10 }}>
        <View style={{ width: 110 }}>
          <Field
            label={t("avail_code_label")}
            value={code}
            onChangeText={(v) => {
              setCode(v);
              setError(null);
            }}
            placeholder={t("avail_code_placeholder")}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label={t("avail_code_meaning")}
            value={label}
            onChangeText={setLabel}
            placeholder={t("avail_code_meaning")}
          />
        </View>
      </View>
      {error ? (
        <Text style={{ fontFamily: font.medium, fontSize: 12.5, color: colors.destructive }}>
          {error}
        </Text>
      ) : null}
      <Btn
        label={t("avail_add_code")}
        icon="plus"
        variant="secondary"
        onPress={add}
        disabled={!sanitizeCode(code)}
      />
    </Card>
  );
}

function CodeRow({ id, onDelete }: { id: string; onDelete: () => void }) {
  const { colors, row, textAlign } = useUI();
  const app = useApp();
  const t = app.t;
  const code = app.state.availabilityCodes.find((c) => c.id === id);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(code?.label ?? "");
  const [codeText, setCodeText] = useState(code?.code ?? "");
  const [error, setError] = useState<string | null>(null);
  if (!code) return null;

  return (
    <Card style={{ marginBottom: 8 }}>
      <View style={{ flexDirection: row, alignItems: "center", gap: 12 }}>
        {editing ? (
          <View style={{ width: 90 }}>
            <Field
              label=""
              value={codeText}
              onChangeText={(v) => {
                setCodeText(v);
                setError(null);
              }}
              placeholder={t("avail_code_label")}
            />
          </View>
        ) : (
          <Pill label={code.code} tone="accent" />
        )}
        <View style={{ flex: 1 }}>
          {editing ? (
            <Field label="" value={label} onChangeText={setLabel} placeholder={t("avail_code_meaning")} />
          ) : (
            <Text style={{ fontFamily: font.medium, fontSize: 13.5, color: colors.foreground, textAlign }}>
              {code.label}
            </Text>
          )}
        </View>
        <IconButton
          icon={editing ? "check" : "edit-2"}
          size={15}
          onPress={() => {
            if (editing) {
              const ok = app.updateAvailabilityCode(id, { code: codeText, label });
              if (!ok) {
                setError(t("avail_code_exists"));
                return;
              }
              setError(null);
              setEditing(false);
            } else {
              setLabel(code.label);
              setCodeText(code.code);
              setError(null);
              setEditing(true);
            }
          }}
        />
        <IconButton icon="trash-2" size={15} onPress={onDelete} color={colors.destructive} bg={colors.destructive + "14"} />
      </View>
      {error ? (
        <Text style={{ fontFamily: font.medium, fontSize: 12.5, color: colors.destructive, marginTop: 8, textAlign }}>
          {error}
        </Text>
      ) : null}
      <Pressable
        onPress={() => {
          tap();
          app.updateAvailabilityCode(id, { countsAsDayOff: !code.countsAsDayOff });
        }}
        style={{ flexDirection: row, alignItems: "center", gap: 8, marginTop: 10 }}
      >
        <Feather
          name={code.countsAsDayOff ? "check-square" : "square"}
          size={17}
          color={code.countsAsDayOff ? colors.primary : colors.mutedForeground}
        />
        <Text style={{ fontFamily: font.medium, fontSize: 12.5, color: colors.mutedForeground }}>
          {t("avail_counts_day_off")}
        </Text>
      </Pressable>
    </Card>
  );
}

// ---------------- Export / import ----------------

function ExportSheet({ onClose }: { onClose: () => void }) {
  const { colors, row, textAlign } = useUI();
  const app = useApp();
  const insets = useSafeAreaInsets();
  const t = app.t;
  const [month, setMonth] = useState(() => startOfMonth(todayISO()));
  const [selectedPeople, setSelectedPeople] = useState<Set<string>>(
    () => new Set(app.orderedPeople.map((p) => p.id)),
  );
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(
    () => new Set(app.state.availabilityCodes.map((c) => codeKey(c.code))),
  );
  const [notice, setNotice] = useState<string | null>(null);

  const monthEnd = endOfMonth(month);
  const daysInMonth = parseISO(monthEnd).getDate();

  const togglePerson = (id: string) =>
    setSelectedPeople((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleCode = (k: string) =>
    setSelectedCodes((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const people = app.orderedPeople.filter((p) => selectedPeople.has(p.id));
  const filteredEntries = app.state.availability.filter(
    (e) =>
      e.date >= month &&
      e.date <= monthEnd &&
      selectedPeople.has(e.personId) &&
      selectedCodes.has(codeKey(e.code)),
  );

  const fileBase = () => {
    const name = safeFileBase(app.settings.squadronName, "Squadron");
    return `${name} availability ${month.slice(0, 7)}`;
  };

  const sharePdf = async () => {
    const per = countCodes(filteredEntries, month, monthEnd);
    const weekendDays: number[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${month.slice(0, 8)}${String(d).padStart(2, "0")}`;
      if (isWeekend(iso)) weekendDays.push(d);
    }
    const usedKeys = new Set(filteredEntries.map((e) => codeKey(e.code)));
    const html = buildAvailabilityHtml({
      title: app.settings.squadronName || t("app_name"),
      subtitle: monthLabel(app, month),
      isRTL: app.isRTL,
      daysInMonth,
      weekendDays,
      labels: {
        number: t("avail_number"),
        name: t("person_name"),
        totals: t("avail_month_totals"),
        codes: t("avail_codes"),
        generatedOn: t("generated_on"),
      },
      legend: app.state.availabilityCodes
        .filter((c) => usedKeys.has(codeKey(c.code)))
        .map((c) => ({ code: c.code, label: c.label })),
      generatedOn: fmtDate(app, todayISO()),
      people: people.map((p, i) => {
        const marks: Record<number, string> = {};
        for (const e of filteredEntries) {
          if (e.personId !== p.id) continue;
          marks[parseISO(e.date).getDate()] = e.code;
        }
        const perTotals = per.get(p.id);
        return {
          index: i + 1,
          name: p.name,
          role: t(p.role),
          marks,
          totals: perTotals
            ? [...perTotals.entries()]
                .map(([code, count]) => ({ code, count }))
                .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
            : [],
        };
      }),
    });
    await exportRosterSheet(html, `${fileBase()}.pdf`);
    onClose();
  };

  const exportData = async () => {
    const data = buildAvailabilityExport({
      squadronName: app.settings.squadronName,
      month: month.slice(0, 7),
      people,
      order: people.map((p) => p.id),
      codes: app.state.availabilityCodes.filter((c) =>
        selectedCodes.has(codeKey(c.code)),
      ),
      entries: filteredEntries,
    });
    await exportToFile(JSON.stringify(data, null, 2), `${fileBase()}.json`);
    onClose();
  };

  const importData = async () => {
    try {
      const json = await importFromFile();
      if (!json) return;
      const r = app.importAvailabilityJson(json);
      setNotice(
        `${t("avail_import_done")} — ${t("avail_import_summary")
          .replace("{a}", String(r.added))
          .replace("{u}", String(r.updated))
          .replace("{s}", String(r.skipped))}`,
      );
    } catch {
      setNotice(t("avail_import_failed"));
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View
        style={[
          styles.sheet,
          { backgroundColor: colors.background, paddingBottom: insets.bottom + 16, borderColor: colors.border },
        ]}
      >
        <View style={{ flexDirection: row, alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <Text style={{ fontFamily: font.bold, fontSize: 18, color: colors.foreground }}>{t("avail_export")}</Text>
          <IconButton icon="x" onPress={onClose} />
        </View>
        <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: colors.mutedForeground, marginBottom: 12, textAlign }}>
          {t("avail_export_hint")}
        </Text>
        <ScrollView style={{ maxHeight: 480 }}>
          <SectionLabel text={t("avail_month_label")} />
          <View style={{ flexDirection: row, alignItems: "center", justifyContent: "space-between" }}>
            <IconButton
              icon={app.isRTL ? "chevron-right" : "chevron-left"}
              onPress={() => setMonth((m) => startOfMonth(addMonths(m, -1)))}
            />
            <Text style={{ fontFamily: font.bold, fontSize: 15, color: colors.foreground }}>
              {monthLabel(app, month)}
            </Text>
            <IconButton
              icon={app.isRTL ? "chevron-left" : "chevron-right"}
              onPress={() => setMonth((m) => startOfMonth(addMonths(m, 1)))}
            />
          </View>
          <View style={{ height: 12 }} />
          <SectionLabel text={t("avail_people")} />
          <View style={{ flexDirection: row, flexWrap: "wrap", gap: 8 }}>
            {app.orderedPeople.map((p) => {
              const on = selectedPeople.has(p.id);
              return (
                <Toggle key={p.id} label={p.name} on={on} onPress={() => togglePerson(p.id)} />
              );
            })}
          </View>
          <View style={{ height: 12 }} />
          <SectionLabel text={t("avail_codes")} />
          <View style={{ flexDirection: row, flexWrap: "wrap", gap: 8 }}>
            {app.state.availabilityCodes.map((c) => {
              const k = codeKey(c.code);
              return (
                <Toggle key={c.id} label={c.code} on={selectedCodes.has(k)} onPress={() => toggleCode(k)} />
              );
            })}
          </View>
          <View style={{ height: 16 }} />
          <Btn label={t("avail_share_pdf")} icon="printer" onPress={sharePdf} disabled={people.length === 0} />
          <View style={{ height: 8 }} />
          <Btn label={t("avail_export_data")} icon="download" variant="ghost" onPress={exportData} disabled={people.length === 0} />
          <View style={{ height: 8 }} />
          <Btn label={t("avail_import_data")} icon="upload" variant="ghost" onPress={importData} />
          <Text style={{ fontFamily: font.regular, fontSize: 12, color: colors.mutedForeground, marginTop: 8, lineHeight: 17, textAlign }}>
            {t("avail_import_merge_hint")}
          </Text>
          {notice ? (
            <Text style={{ fontFamily: font.medium, fontSize: 12.5, color: colors.primary, marginTop: 8, textAlign }}>
              {notice}
            </Text>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

function Toggle({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const { colors } = useUI();
  return (
    <Pressable
      onPress={() => {
        tap();
        onPress();
      }}
      style={{
        paddingHorizontal: 12,
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
        {label}
      </Text>
    </Pressable>
  );
}

// ---------------- Day-off recommendation ----------------

function RecommendSheet({ onClose }: { onClose: () => void }) {
  const { colors, row, textAlign } = useUI();
  const app = useApp();
  const insets = useSafeAreaInsets();
  const t = app.t;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [date, setDate] = useState(() => addDays(todayISO(), 1));
  const [results, setResults] = useState<DayOffCandidate[] | null>(null);

  const toggle = (id: string) => {
    setResults(null);
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const run = () => {
    const people = app.orderedPeople.filter((p) => selected.has(p.id));
    setResults(
      recommendDayOff(people, app.state.availability, app.state.availabilityCodes, date),
    );
  };

  const dayOffCodes = app.state.availabilityCodes
    .filter((c) => c.countsAsDayOff)
    .map((c) => c.code)
    .join("، ");

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View
        style={[
          styles.sheet,
          { backgroundColor: colors.background, paddingBottom: insets.bottom + 16, borderColor: colors.border },
        ]}
      >
        <View style={{ flexDirection: row, alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <Text style={{ fontFamily: font.bold, fontSize: 18, color: colors.foreground }}>{t("avail_recommend")}</Text>
          <IconButton icon="x" onPress={onClose} />
        </View>
        <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: colors.mutedForeground, marginBottom: 12, lineHeight: 18, textAlign }}>
          {t("avail_recommend_hint")}
        </Text>
        <ScrollView style={{ maxHeight: 480 }}>
          <SectionLabel text={t("avail_select_people")} />
          {(["captain", "copilot"] as const).map((role) => {
            const group = app.orderedPeople.filter((p) => p.role === role);
            if (group.length === 0) return null;
            return (
              <View key={role} style={{ marginBottom: 10 }}>
                <Text
                  style={{
                    fontFamily: font.bold,
                    fontSize: 12.5,
                    color: colors.mutedForeground,
                    marginBottom: 6,
                    textAlign,
                  }}
                >
                  {t(role)}
                </Text>
                <View style={{ flexDirection: row, flexWrap: "wrap", gap: 8 }}>
                  {group.map((p) => (
                    <Toggle key={p.id} label={p.name} on={selected.has(p.id)} onPress={() => toggle(p.id)} />
                  ))}
                </View>
              </View>
            );
          })}
          <View style={{ height: 2 }} />
          <DateField
            label={t("avail_for_date")}
            value={date}
            onChange={(d) => {
              setResults(null);
              setDate(d);
            }}
            formatDate={(iso) => fmtDate(app, iso)}
          />
          <View style={{ height: 12 }} />
          <Btn
            label={t("avail_recommend_btn")}
            icon="gift"
            onPress={run}
            disabled={selected.size < 2 || !isValidISO(date)}
          />
          {selected.size > 0 && selected.size < 2 ? (
            <Text style={{ fontFamily: font.regular, fontSize: 12, color: colors.mutedForeground, marginTop: 6, textAlign }}>
              {t("avail_need_two")}
            </Text>
          ) : null}
          {results
            ? results.map((c, i) => (
                <Card key={c.person.id} style={{ marginTop: 10, borderColor: i === 0 ? colors.primary : colors.border, borderWidth: i === 0 ? 1 : StyleSheet.hairlineWidth }}>
                  <View style={{ flexDirection: row, alignItems: "center", justifyContent: "space-between" }}>
                    <Text style={{ fontFamily: font.semibold, fontSize: 15, color: colors.foreground, textAlign }}>
                      {c.person.name}
                      <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: colors.mutedForeground }}>
                        {"  ·  "}
                        {t(c.person.role)}
                      </Text>
                    </Text>
                    {i === 0 ? <Pill label={t("recommended")} tone="accent" /> : null}
                  </View>
                  <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: colors.mutedForeground, marginTop: 5, lineHeight: 18, textAlign }}>
                    {c.dayOffCount} {t("avail_day_off_days")}
                    {" · "}
                    {c.daysSinceLast === null
                      ? t("avail_never_day_off")
                      : `${t("avail_last_day_off")}: ${c.daysSinceLast} ${t("avail_days_ago")}`}
                  </Text>
                  {i === 0 ? (
                    <Text style={{ fontFamily: font.medium, fontSize: 12.5, color: colors.primary, marginTop: 4, textAlign }}>
                      {t("avail_reason_fewest")}
                      {dayOffCodes ? ` (${dayOffCodes})` : ""}
                    </Text>
                  ) : null}
                </Card>
              ))
            : null}
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
