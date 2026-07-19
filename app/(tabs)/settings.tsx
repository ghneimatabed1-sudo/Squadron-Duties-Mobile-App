import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import { Alert, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import {
  Btn,
  Card,
  Field,
  font,
  Header,
  Loading,
  Screen,
  SectionLabel,
  Segmented,
  tap,
  useUI,
} from "@/components/ui";
import { useApp } from "@/context/AppContext";
import { safeFileBase } from "@/lib/filenames";
import { weekdayNames } from "@/lib/i18n";
import { exportToFile, importFromFile } from "@/lib/io";

export default function SettingsScreen() {
  const { colors, row, textAlign } = useUI();
  const app = useApp();
  const [busy, setBusy] = useState(false);

  if (!app.ready) return <Loading />;
  const t = app.t;
  const s = app.settings;

  const doExport = async () => {
    try {
      setBusy(true);
      // Name the backup after the squadron + today's date so multiple backups
      // stay distinct and the latest is easy to spot when restoring.
      const safeTitle = safeFileBase(
        s.squadronName.trim() || t("roster_title"),
        "Squadron",
      );
      const d = new Date();
      const stamp = `${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()}`;
      const fileName = `${safeTitle} backup ${stamp}.json`;
      await exportToFile(app.exportJson(), fileName);
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    try {
      setBusy(true);
      const json = await importFromFile();
      if (!json) return;
      app.importJson(json);
      notify(t("import_done"));
    } catch {
      notify(t("import_failed"));
    } finally {
      setBusy(false);
    }
  };

  const doImport = () => {
    if (Platform.OS === "web") {
      // eslint-disable-next-line no-alert
      if (window.confirm(t("import_confirm"))) runImport();
      return;
    }
    Alert.alert(t("import_data"), t("import_confirm"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("confirm"), onPress: runImport },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Header title={t("tab_settings")} />
      <Screen scroll>
        <SectionLabel text={t("language")} />
        <Segmented
          value={app.lang}
          onChange={(l) => app.setLanguage(l)}
          options={[
            { key: "en", label: "English" },
            { key: "ar", label: "العربية" },
          ]}
        />

        <View style={{ height: 20 }} />
        <SectionLabel text={t("squadron_name")} />
        <Card style={{ gap: 8 }}>
          <Field
            label={t("squadron_name")}
            value={s.squadronName}
            onChangeText={(v) => app.updateSettings({ squadronName: v })}
            placeholder={t("squadron_name_placeholder")}
            maxLength={60}
          />
          <Text style={{ fontFamily: font.regular, fontSize: 12, color: colors.mutedForeground, textAlign }}>
            {t("squadron_name_hint")}
          </Text>
        </Card>

        <View style={{ height: 20 }} />
        <SectionLabel text={t("settings_rotation")} />
        <Card>
          <Stepper
            label={t("rest_days")}
            value={s.restDays}
            min={0}
            max={7}
            step={1}
            onChange={(v) => app.updateSettings({ restDays: v })}
            format={(v) => String(v)}
          />
          <Text style={{ fontFamily: font.regular, fontSize: 12, color: colors.mutedForeground, marginTop: 6, textAlign }}>
            {t("rest_days_hint")}
          </Text>
          <Divider />
          <Stepper
            label={t("rest_days_special")}
            value={s.restDaysSpecial}
            min={0}
            max={7}
            step={1}
            onChange={(v) => app.updateSettings({ restDaysSpecial: v })}
            format={(v) => String(v)}
          />
          <Text style={{ fontFamily: font.regular, fontSize: 12, color: colors.mutedForeground, marginTop: 6, textAlign }}>
            {t("rest_days_special_hint")}
          </Text>
          <Divider />
          <Stepper
            label={t("rest_days_location")}
            value={s.restDaysLocation}
            min={0}
            max={7}
            step={1}
            onChange={(v) => app.updateSettings({ restDaysLocation: v })}
            format={(v) => String(v)}
          />
          <Text style={{ fontFamily: font.regular, fontSize: 12, color: colors.mutedForeground, marginTop: 6, textAlign }}>
            {t("rest_days_location_hint")}
          </Text>
        </Card>
        <Card style={{ marginTop: 12 }}>
          <View style={{ flexDirection: row, gap: 10 }}>
            <Feather name="rotate-cw" size={18} color={colors.primary} />
            <Text style={{ flex: 1, fontFamily: font.regular, fontSize: 13, color: colors.mutedForeground, lineHeight: 20, textAlign }}>
              {t("rotation_explainer")}
            </Text>
          </View>
        </Card>

        <View style={{ height: 20 }} />
        <SectionLabel text={t("fixed_days_title")} />
        <FixedDaysSection />

        <View style={{ height: 20 }} />
        <SectionLabel text={t("data_management")} />
        <Card style={{ gap: 12 }}>
          <Text style={{ fontFamily: font.regular, fontSize: 13, color: colors.mutedForeground, textAlign, lineHeight: 19 }}>
            {t("export_hint")}
          </Text>
          <Btn label={t("export_data")} icon="upload" variant="secondary" onPress={doExport} disabled={busy} />
          <Divider />
          <Text style={{ fontFamily: font.regular, fontSize: 13, color: colors.mutedForeground, textAlign, lineHeight: 19 }}>
            {t("import_hint")}
          </Text>
          <Btn label={t("import_data")} icon="download" variant="secondary" onPress={doImport} disabled={busy} />
        </Card>

        <View style={{ height: 20 }} />
        <SectionLabel text={t("about")} />
        <Card>
          <View style={{ flexDirection: row, gap: 10 }}>
            <Feather name="shield" size={18} color={colors.primary} />
            <Text style={{ flex: 1, fontFamily: font.regular, fontSize: 13, color: colors.mutedForeground, lineHeight: 20, textAlign }}>
              {t("about_text")}
            </Text>
          </View>
        </Card>
      </Screen>
    </View>
  );
}

function FixedDaysSection() {
  const { colors, row, textAlign } = useUI();
  const app = useApp();
  const t = app.t;
  const [adding, setAdding] = useState(false);
  const [personId, setPersonId] = useState<string | null>(null);
  const [weekday, setWeekday] = useState<number | null>(null);
  const [onlyFixed, setOnlyFixed] = useState(false);
  const [inclWeekends, setInclWeekends] = useState(false);

  const people = app.state.people.filter(
    (p) => p.active && !p.availabilityOnly,
  );
  const names = weekdayNames[app.lang];
  // Week runs Monday -> Sunday in this app.
  const weekOrder = [1, 2, 3, 4, 5, 6, 0];
  const rules = [...app.state.fixedDays].sort(
    (a, b) => weekOrder.indexOf(a.weekday) - weekOrder.indexOf(b.weekday),
  );
  const nameOf = (id: string) =>
    app.state.people.find((p) => p.id === id)?.name ?? "?";

  const reset = () => {
    setAdding(false);
    setPersonId(null);
    setWeekday(null);
    setOnlyFixed(false);
    setInclWeekends(false);
  };

  const save = () => {
    if (!personId || weekday === null) return;
    app.addFixedDay(personId, weekday, onlyFixed, inclWeekends);
    reset();
  };

  const chip = (on: boolean) => ({
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: on ? colors.primary : colors.muted,
  });
  const chipText = (on: boolean) => ({
    fontFamily: font.medium,
    fontSize: 13,
    color: on ? colors.primaryForeground : colors.foreground,
  });

  return (
    <Card style={{ gap: 12 }}>
      <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: colors.mutedForeground, lineHeight: 18, textAlign }}>
        {t("fixed_days_hint")}
      </Text>

      {rules.length === 0 && !adding ? (
        <Text style={{ fontFamily: font.regular, fontSize: 13, color: colors.mutedForeground, textAlign }}>
          {t("fixed_day_none")}
        </Text>
      ) : null}

      {rules.map((r) => (
        <View
          key={r.id}
          style={{ flexDirection: row, alignItems: "center", gap: 10, backgroundColor: colors.muted, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: font.bold, fontSize: 14, color: colors.foreground, textAlign }}>
              {nameOf(r.personId)}
            </Text>
            <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: colors.mutedForeground, marginTop: 2, textAlign }}>
              {t("fixed_day_every")} {names[r.weekday]}
              {r.onlyFixed ? ` · ${t("fixed_day_out_of_rotation")}` : ""}
              {r.onlyFixed && r.includeWeekends ? ` ${t("fixed_day_with_weekends")}` : ""}
            </Text>
          </View>
          <Pressable
            onPress={() => {
              tap();
              app.removeFixedDay(r.id);
            }}
            hitSlop={8}
          >
            <Feather name="trash-2" size={17} color={colors.destructive} />
          </Pressable>
        </View>
      ))}

      {adding ? (
        <View style={{ gap: 10 }}>
          <Text style={{ fontFamily: font.bold, fontSize: 12.5, color: colors.mutedForeground, textAlign }}>
            {t("fixed_day_person")}
          </Text>
          <View style={{ flexDirection: row, flexWrap: "wrap", gap: 8 }}>
            {people.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => {
                  tap();
                  setPersonId(p.id);
                }}
                style={chip(personId === p.id)}
              >
                <Text style={chipText(personId === p.id)}>{p.name}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={{ fontFamily: font.bold, fontSize: 12.5, color: colors.mutedForeground, textAlign }}>
            {t("fixed_day_weekday")}
          </Text>
          <View style={{ flexDirection: row, flexWrap: "wrap", gap: 8 }}>
            {weekOrder.map((wd) => (
              <Pressable
                key={wd}
                onPress={() => {
                  tap();
                  setWeekday(wd);
                }}
                style={chip(weekday === wd)}
              >
                <Text style={chipText(weekday === wd)}>{names[wd]}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            onPress={() => {
              tap();
              setOnlyFixed((v) => !v);
            }}
            style={{ flexDirection: row, alignItems: "center", gap: 10 }}
          >
            <Feather
              name={onlyFixed ? "check-square" : "square"}
              size={19}
              color={onlyFixed ? colors.primary : colors.mutedForeground}
            />
            <Text style={{ flex: 1, fontFamily: font.medium, fontSize: 13.5, color: colors.foreground, textAlign }}>
              {t("fixed_day_only_toggle")}
            </Text>
          </Pressable>
          {onlyFixed ? (
            <>
              <Text style={{ fontFamily: font.regular, fontSize: 12, color: colors.mutedForeground, textAlign }}>
                {t("fixed_day_only_hint")}
              </Text>
              <Pressable
                onPress={() => {
                  tap();
                  setInclWeekends((v) => !v);
                }}
                style={{ flexDirection: row, alignItems: "center", gap: 10 }}
              >
                <Feather
                  name={inclWeekends ? "check-square" : "square"}
                  size={19}
                  color={inclWeekends ? colors.primary : colors.mutedForeground}
                />
                <Text style={{ flex: 1, fontFamily: font.medium, fontSize: 13.5, color: colors.foreground, textAlign }}>
                  {t("fixed_day_weekends_toggle")}
                </Text>
              </Pressable>
              {inclWeekends ? (
                <Text style={{ fontFamily: font.regular, fontSize: 12, color: colors.mutedForeground, textAlign }}>
                  {t("fixed_day_weekends_hint")}
                </Text>
              ) : null}
            </>
          ) : null}
          <View style={{ flexDirection: row, gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Btn label={t("cancel")} variant="secondary" onPress={reset} />
            </View>
            <View style={{ flex: 1 }}>
              <Btn
                label={t("confirm")}
                onPress={save}
                disabled={!personId || weekday === null}
              />
            </View>
          </View>
        </View>
      ) : (
        <Btn
          label={t("fixed_day_add")}
          icon="plus"
          variant="secondary"
          onPress={() => setAdding(true)}
        />
      )}

      <Text style={{ fontFamily: font.regular, fontSize: 11.5, color: colors.mutedForeground, lineHeight: 16, textAlign }}>
        {t("fixed_day_applies_note")}
      </Text>
    </Card>
  );
}

function notify(msg: string) {
  if (Platform.OS === "web") {
    // eslint-disable-next-line no-alert
    window.alert(msg);
  } else {
    Alert.alert(msg);
  }
}

function Divider() {
  const { colors } = useUI();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 12 }} />;
}

function Stepper({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
}) {
  const { colors, row, textAlign } = useUI();
  const dec = () => onChange(Math.max(min, Math.round((value - step) * 10) / 10));
  const inc = () => onChange(Math.min(max, Math.round((value + step) * 10) / 10));
  return (
    <View style={{ flexDirection: row, alignItems: "center", justifyContent: "space-between" }}>
      <Text style={{ flex: 1, fontFamily: font.medium, fontSize: 14.5, color: colors.foreground, textAlign }}>
        {label}
      </Text>
      <View style={{ flexDirection: row, alignItems: "center", gap: 14 }}>
        <Pressable
          onPress={() => {
            tap();
            dec();
          }}
          style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" }}
        >
          <Feather name="minus" size={16} color={colors.foreground} />
        </Pressable>
        <Text style={{ minWidth: 38, textAlign: "center", fontFamily: font.bold, fontSize: 16, color: colors.foreground }}>
          {format(value)}
        </Text>
        <Pressable
          onPress={() => {
            tap();
            inc();
          }}
          style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" }}
        >
          <Feather name="plus" size={16} color={colors.foreground} />
        </Pressable>
      </View>
    </View>
  );
}
