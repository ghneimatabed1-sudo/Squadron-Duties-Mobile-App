import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  Card,
  EmptyState,
  font,
  Header,
  Loading,
  Pill,
  Screen,
  SectionLabel,
  tap,
  useUI,
} from "@/components/ui";
import { useApp } from "@/context/AppContext";
import { addDays, addMonths, dayOfWeek, diffDays, parseISO, todayISO } from "@/lib/dates";
import {
  ForecastCrew,
  forecastWeekends,
  LocationQueueRow,
  locationQueue,
  WeekendForecast,
} from "@/lib/forecast";

type HorizonKey = "w3" | "m1" | "m2" | "m3";

export default function DutiesScreen() {
  const { colors, row } = useUI();
  const app = useApp();
  const [horizon, setHorizon] = useState<HorizonKey>("w3");

  const today = todayISO();
  const horizons: { key: HorizonKey; label: string; end: string }[] = [
    { key: "w3", label: app.ready ? app.t("h_3w") : "", end: addDays(today, 21) },
    { key: "m1", label: app.ready ? app.t("h_1m") : "", end: addMonths(today, 1) },
    { key: "m2", label: app.ready ? app.t("h_2m") : "", end: addMonths(today, 2) },
    { key: "m3", label: app.ready ? app.t("h_3m") : "", end: addMonths(today, 3) },
  ];
  const end = horizons.find((h) => h.key === horizon)!.end;

  const weekends = useMemo(
    () => (app.ready ? forecastWeekends(app.state, today, diffDays(end, today)) : []),
    [app.ready, app.state, today, end],
  );
  const capQueue = useMemo(
    () => (app.ready ? locationQueue(app.state, "captain") : []),
    [app.ready, app.state],
  );
  const cpQueue = useMemo(
    () => (app.ready ? locationQueue(app.state, "copilot") : []),
    [app.ready, app.state],
  );

  if (!app.ready) return <Loading />;
  const t = app.t;
  const hasPeople = app.state.people.some((p) => p.active);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Header title={t("tab_duties")} />
      <Screen scroll>
        {!hasPeople ? (
          <EmptyState icon="compass" title={t("tab_duties")} hint={t("no_people")} />
        ) : (
          <>
            <View style={{ flexDirection: row, gap: 8, flexWrap: "wrap" }}>
              {horizons.map((h) => {
                const on = horizon === h.key;
                return (
                  <Pressable
                    key={h.key}
                    onPress={() => {
                      tap();
                      setHorizon(h.key);
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
                      {h.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Hint text={t("duties_hint")} />

            <View style={{ height: 12 }} />
            <SectionLabel text={t("duties_weekend_title")} />
            {weekends.length === 0 ? (
              <Text style={{ fontFamily: font.regular, color: colors.mutedForeground }}>—</Text>
            ) : (
              weekends.map((w) => <WeekendCard key={w.key} w={w} />)
            )}

            <View style={{ height: 20 }} />
            <SectionLabel text={t("duties_location_title")} />
            <Hint text={t("duties_loc_hint")} />
            <View style={{ height: 8 }} />
            <Text style={sub(colors).h}>{t("captains")}</Text>
            <QueueList rows={capQueue} />
            <View style={{ height: 14 }} />
            <Text style={sub(colors).h}>{t("copilots")}</Text>
            <QueueList rows={cpQueue} />
          </>
        )}
      </Screen>
    </View>
  );
}

function Hint({ text }: { text: string }) {
  const { colors, row } = useUI();
  return (
    <View style={{ flexDirection: row, gap: 8, marginTop: 12 }}>
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
        {text}
      </Text>
    </View>
  );
}

function fmtShort(app: ReturnType<typeof useApp>, iso: string): string {
  const d = parseISO(iso);
  return `${app.weekday(dayOfWeek(iso))} ${d.getDate()}/${d.getMonth() + 1}`;
}

function WeekendCard({ w }: { w: WeekendForecast }) {
  const { colors, row, textAlign } = useUI();
  const app = useApp();
  const t = app.t;
  const first = w.dates[0];
  const last = w.dates[w.dates.length - 1];
  const range =
    w.dates.length > 1 ? `${fmtShort(app, first)} – ${fmtShort(app, last)}` : fmtShort(app, first);

  return (
    <Card style={{ marginBottom: 8 }}>
      <View
        style={{
          flexDirection: row,
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <Text style={{ fontFamily: font.semibold, fontSize: 14.5, color: colors.foreground, textAlign }}>
          {range}
        </Text>
        {w.split ? <Pill label={t("split_weekend")} tone="muted" /> : null}
      </View>
      <View style={{ gap: 10 }}>
        {w.crews.map((c) => (
          <CrewRows key={c.date} crew={c} showDate={w.split} />
        ))}
      </View>
    </Card>
  );
}

function CrewRows({ crew, showDate }: { crew: ForecastCrew; showDate: boolean }) {
  const { colors, textAlign } = useUI();
  const app = useApp();
  return (
    <View style={{ gap: 6 }}>
      {showDate ? (
        <Text
          style={{
            fontFamily: font.medium,
            fontSize: 12.5,
            color: colors.mutedForeground,
            textAlign,
          }}
        >
          {fmtShort(app, crew.date)}
        </Text>
      ) : null}
      <PickRow roleKey="captain" pick={crew.captain} />
      <PickRow roleKey="copilot" pick={crew.copilot} />
    </View>
  );
}

function PickRow({
  roleKey,
  pick,
}: {
  roleKey: "captain" | "copilot";
  pick: { person: { name: string }; planned: boolean } | null;
}) {
  const { colors, row } = useUI();
  const t = useApp().t;
  return (
    <View style={{ flexDirection: row, alignItems: "center", gap: 8 }}>
      <Text
        style={{
          fontFamily: font.medium,
          fontSize: 12.5,
          color: colors.mutedForeground,
          width: 74,
        }}
      >
        {t(roleKey)}
      </Text>
      <Text
        style={{
          flex: 1,
          fontFamily: font.semibold,
          fontSize: 14.5,
          color: pick ? colors.foreground : colors.mutedForeground,
        }}
      >
        {pick ? pick.person.name : "—"}
      </Text>
      {pick ? (
        <Pill label={pick.planned ? t("planned") : t("predicted")} tone={pick.planned ? "primary" : "accent"} />
      ) : null}
    </View>
  );
}

function QueueList({ rows }: { rows: LocationQueueRow[] }) {
  const { colors, row } = useUI();
  const app = useApp();
  const t = app.t;
  if (rows.length === 0) {
    return <Text style={{ fontFamily: font.regular, color: colors.mutedForeground }}>—</Text>;
  }
  return (
    <View style={{ gap: 6 }}>
      {rows.map((r, i) => (
        <View
          key={r.person.id}
          style={{
            flexDirection: row,
            alignItems: "center",
            gap: 10,
            backgroundColor: colors.card,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.border,
            borderRadius: colors.radius,
            paddingHorizontal: 12,
            paddingVertical: 10,
          }}
        >
          <View
            style={{
              width: 26,
              height: 26,
              borderRadius: 13,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: i === 0 ? colors.primary : colors.muted,
            }}
          >
            <Text
              style={{
                fontFamily: font.bold,
                fontSize: 12.5,
                color: i === 0 ? colors.primaryForeground : colors.mutedForeground,
              }}
            >
              {i + 1}
            </Text>
          </View>
          <Text style={{ flex: 1, fontFamily: font.semibold, fontSize: 14.5, color: colors.foreground }}>
            {r.person.name}
          </Text>
          <Text style={{ fontFamily: font.medium, fontSize: 12.5, color: colors.mutedForeground }}>
            {r.count} · {r.lastDate ? fmtShortFull(r.lastDate) : t("duties_never")}
          </Text>
        </View>
      ))}
    </View>
  );
}

function fmtShortFull(iso: string): string {
  const d = parseISO(iso);
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

function sub(colors: ReturnType<typeof useUI>["colors"]) {
  return StyleSheet.create({
    h: {
      fontFamily: font.semibold,
      fontSize: 13.5,
      color: colors.foreground,
      marginBottom: 6,
      marginTop: 4,
    },
  });
}
