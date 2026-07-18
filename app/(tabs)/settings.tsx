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
