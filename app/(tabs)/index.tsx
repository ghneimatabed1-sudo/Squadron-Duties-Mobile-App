import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { PlanCrewSheet } from "@/components/PlanCrewSheet";
import { SlotEditorSheet, SlotTarget } from "@/components/SlotEditorSheet";
import { SoloPickerSheet } from "@/components/SoloPickerSheet";
import {
  Btn,
  Card,
  EmptyState,
  font,
  Header,
  IconButton,
  Loading,
  Pill,
  Screen,
  tap,
  useUI,
} from "@/components/ui";
import { useApp } from "@/context/AppContext";
import {
  addDays,
  dayOfWeek,
  isWeekend,
  parseISO,
  startOfWeek,
  todayISO,
  weekDates,
} from "@/lib/dates";
import { safeFileBase } from "@/lib/filenames";
import { exportRosterSheet } from "@/lib/io";
import { buildRosterHtml, RosterDay, RosterLocation } from "@/lib/rosterHtml";
import { CrewKind, MAX_EXTRA_CREWS, SlotRole } from "@/lib/types";

export default function ScheduleScreen() {
  const { colors, row, textAlign } = useUI();
  const app = useApp();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(todayISO()));
  const [target, setTarget] = useState<SlotTarget | null>(null);
  const [soloDate, setSoloDate] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [balanceOpen, setBalanceOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [planEventOpen, setPlanEventOpen] = useState(false);
  const [planLocationOpen, setPlanLocationOpen] = useState(false);

  if (!app.ready) return <Loading />;

  const t = app.t;
  const dates = weekDates(weekStart); // Mon → Sun
  const preWeekend = dates.slice(0, 3); // Mon–Wed
  const weekendGroup = dates.slice(3, 6); // Thu–Sat
  const postWeekend = dates.slice(6); // Sun
  const weekendSplit = app.isWeekendSplit(weekendGroup[0]);
  const formatDate = (iso: string) => {
    const d = parseISO(iso);
    return `${app.weekday(dayOfWeek(iso))} · ${d.getDate()}/${d.getMonth() + 1}`;
  };
  const rangeLabel = `${formatShort(dates[0])} – ${formatShort(dates[6])}`;
  const hasPeople = app.state.people.some((p) => !p.availabilityOnly);
  const heading = app.settings.squadronName.trim() || t("roster_title");

  const shareRoster = async (weeks: number) => {
    setShareOpen(false);
    const html = buildSheetHtml(app, weekStart, weeks);
    const exportDates: string[] = [];
    for (let w = 0; w < weeks; w++) {
      exportDates.push(...weekDates(addDays(weekStart, w * 7)));
    }
    const first = parseISO(exportDates[0]);
    const last = parseISO(exportDates[exportDates.length - 1]);
    const fmtFile = (d: Date) => `${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()}`;
    // Name the file after the squadron (same title shown inside the sheet) plus
    // the date range, so it's identifiable in a file manager / share sheet
    // without opening it. Strip characters that are invalid in filenames.
    const safeTitle = safeFileBase(
      app.settings.squadronName.trim() || t("roster_title"),
    );
    const fileName = `${safeTitle} ${fmtFile(first)} to ${fmtFile(last)}.pdf`;
    await exportRosterSheet(html, fileName);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Header
        title={heading}
        subtitle={`${t("week_of")} ${rangeLabel}`}
        right={
          hasPeople ? (
            <IconButton
              icon="share"
              onPress={() => {
                tap();
                setShareOpen(true);
              }}
            />
          ) : undefined
        }
      />
      <Screen scroll>
        {/* week nav */}
        <View style={{ flexDirection: row, alignItems: "center", gap: 8, marginBottom: 14 }}>
          <IconButton icon="chevron-left" onPress={() => setWeekStart(addDays(weekStart, -7))} />
          <Pressable
            onPress={() => {
              tap();
              setWeekStart(startOfWeek(todayISO()));
            }}
            style={{
              flex: 1,
              alignItems: "center",
              paddingVertical: 11,
              backgroundColor: colors.secondary,
              borderRadius: colors.radius,
            }}
          >
            <Text style={{ fontFamily: font.semibold, fontSize: 14, color: colors.secondaryForeground }}>
              {t("today")}
            </Text>
          </Pressable>
          <IconButton icon="chevron-right" onPress={() => setWeekStart(addDays(weekStart, 7))} />
        </View>

        {!hasPeople ? (
          <EmptyState
            icon="users"
            title={t("empty_roster")}
            hint={t("empty_roster_hint")}
          />
        ) : (
          <>
            <View style={{ flexDirection: row, gap: 8, marginBottom: 14 }}>
              <Btn
                label={t("fill_week")}
                icon="zap"
                variant="secondary"
                size="sm"
                onPress={() => app.generateWeek(weekStart)}
                style={{ flex: 1 }}
              />
              <Btn
                label={t("balance")}
                icon="sliders"
                variant="secondary"
                size="sm"
                onPress={() => {
                  tap();
                  setBalanceOpen(true);
                }}
                style={{ flex: 1 }}
              />
              <Btn
                label={t("plan_ahead")}
                icon="calendar"
                variant="primary"
                size="sm"
                onPress={() => {
                  tap();
                  setPlanOpen(true);
                }}
                style={{ flex: 1 }}
              />
            </View>

            <View style={{ flexDirection: row, gap: 8, marginBottom: 14 }}>
              <Btn
                label={t("plan_special_event")}
                icon="star"
                variant="secondary"
                size="sm"
                onPress={() => {
                  tap();
                  setPlanEventOpen(true);
                }}
                style={{ flex: 1 }}
              />
              <Btn
                label={t("plan_special_location")}
                icon="map-pin"
                variant="secondary"
                size="sm"
                onPress={() => {
                  tap();
                  setPlanLocationOpen(true);
                }}
                style={{ flex: 1 }}
              />
            </View>

            {preWeekend.map((date) => (
              <DayCard
                key={date}
                date={date}
                formatDate={formatDate}
                onSlot={(crew, role, crewIndex) =>
                  setTarget({ date, crew, role, crewIndex })
                }
                onSolo={() => setSoloDate(date)}
              />
            ))}

            {weekendSplit ? (
              <>
                <WeekendSplitHeader
                  onMerge={() => app.setWeekendSplit(weekendGroup[0], false)}
                />
                {weekendGroup.map((date) => (
                  <DayCard
                    key={date}
                    date={date}
                    formatDate={formatDate}
                    onSlot={(crew, role, crewIndex) =>
                      setTarget({ date, crew, role, crewIndex })
                    }
                    onSolo={() => setSoloDate(date)}
                  />
                ))}
              </>
            ) : (
              <WeekendBlockCard
                weekendDates={weekendGroup}
                onSlot={(crew, role) =>
                  setTarget({ date: weekendGroup[0], crew, role, weekendBlock: true })
                }
                onSplit={() => app.setWeekendSplit(weekendGroup[0], true)}
                onClear={() => weekendGroup.forEach((d) => app.clearDay(d))}
              />
            )}

            {postWeekend.map((date) => (
              <DayCard
                key={date}
                date={date}
                formatDate={formatDate}
                onSlot={(crew, role, crewIndex) =>
                  setTarget({ date, crew, role, crewIndex })
                }
                onSolo={() => setSoloDate(date)}
              />
            ))}
          </>
        )}
      </Screen>

      <SlotEditorSheet
        target={target}
        onClose={() => setTarget(null)}
        formatDate={formatDate}
      />
      <SoloPickerSheet
        date={soloDate}
        onClose={() => setSoloDate(null)}
        formatDate={formatDate}
      />
      <ShareSheet
        visible={shareOpen}
        onClose={() => setShareOpen(false)}
        onPick={shareRoster}
      />
      <PlanAheadSheet
        visible={planOpen}
        onClose={() => setPlanOpen(false)}
        onPick={(weeks) => {
          setPlanOpen(false);
          app.generateWeek(weekStart, weeks);
        }}
      />
      <PlanCrewSheet
        kind="event"
        visible={planEventOpen}
        onClose={() => setPlanEventOpen(false)}
      />
      <PlanCrewSheet
        kind="location"
        visible={planLocationOpen}
        onClose={() => setPlanLocationOpen(false)}
      />
      <BalanceSheet
        visible={balanceOpen}
        dates={dates}
        weekLabel={rangeLabel}
        onClose={() => setBalanceOpen(false)}
      />
    </View>
  );
}

function WeekendSplitHeader({ onMerge }: { onMerge: () => void }) {
  const { colors, row, textAlign } = useUI();
  const app = useApp();
  const t = app.t;

  return (
    <View
      style={{
        flexDirection: row,
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 10,
        marginTop: 2,
      }}
    >
      <View style={{ flexDirection: row, alignItems: "center", gap: 8 }}>
        <Feather name="columns" size={15} color={colors.accent} />
        <Text style={{ fontFamily: font.bold, fontSize: 14, color: colors.foreground, textAlign }}>
          {t("weekend")} · {t("split_label")}
        </Text>
      </View>
      <Pressable
        onPress={() => {
          tap();
          onMerge();
        }}
        style={{
          flexDirection: row,
          alignItems: "center",
          gap: 6,
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderRadius: colors.radius,
          backgroundColor: colors.secondary,
        }}
      >
        <Feather name="minimize-2" size={13} color={colors.secondaryForeground} />
        <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: colors.secondaryForeground }}>
          {t("merge_weekend")}
        </Text>
      </Pressable>
    </View>
  );
}

function WeekendBlockCard({
  weekendDates,
  onSlot,
  onSplit,
  onClear,
}: {
  weekendDates: string[];
  onSlot: (crew: CrewKind, role: SlotRole) => void;
  onSplit: () => void;
  onClear: () => void;
}) {
  const { colors, row, textAlign } = useUI();
  const app = useApp();
  const t = app.t;
  const ref = weekendDates[0];
  const containsToday = weekendDates.includes(todayISO());
  const first = parseISO(weekendDates[0]);
  const last = parseISO(weekendDates[weekendDates.length - 1]);
  const rangeLabel = `${first.getDate()}/${first.getMonth() + 1} – ${last.getDate()}/${last.getMonth() + 1}`;

  return (
    <Card
      style={{
        marginBottom: 12,
        borderColor: containsToday ? colors.primary : colors.accent,
        borderWidth: containsToday ? 1.5 : 1,
      }}
    >
      <View
        style={{
          flexDirection: row,
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <View style={{ flexDirection: row, alignItems: "baseline", gap: 8 }}>
          <Text style={{ fontFamily: font.bold, fontSize: 16, color: colors.foreground }}>
            {t("weekend")}
          </Text>
          <Text style={{ fontFamily: font.medium, fontSize: 13, color: colors.mutedForeground }}>
            {rangeLabel}
          </Text>
        </View>
        <View style={{ flexDirection: row, alignItems: "center", gap: 8 }}>
          <Pill label={t("weekend")} tone="accent" />
          <IconButton
            icon="trash-2"
            size={16}
            onPress={() => {
              tap();
              onClear();
            }}
            color={colors.mutedForeground}
            bg="transparent"
          />
        </View>
      </View>

      <Text style={{ fontFamily: font.regular, fontSize: 12, color: colors.mutedForeground, marginTop: -4, marginBottom: 10, textAlign }}>
        {t("weekend_one_crew_hint")}
      </Text>

      <CrewBlock label={t("duty_crew")} crew="duty" date={ref} onSlot={onSlot} icon="shield" />
      <View style={{ height: 10 }} />
      <CrewBlock label={t("standby_crew")} crew="standby" date={ref} onSlot={onSlot} icon="clock" />

      <View style={{ height: 10 }} />
      <Pressable
        onPress={() => {
          tap();
          onSplit();
        }}
        style={{
          flexDirection: row,
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          backgroundColor: colors.muted,
          borderRadius: colors.radius,
          paddingHorizontal: 12,
          paddingVertical: 11,
        }}
      >
        <Feather name="columns" size={14} color={colors.foreground} />
        <Text style={{ fontFamily: font.semibold, fontSize: 13.5, color: colors.foreground }}>
          {t("split_weekend")}
        </Text>
      </Pressable>
    </Card>
  );
}

function PlanAheadSheet({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (weeks: number) => void;
}) {
  const { colors, row, textAlign } = useUI();
  const app = useApp();
  const t = app.t;
  const options = [1, 2, 3, 4, 6];
  const labelFor = (n: number) =>
    n === 1 ? t("one_week") : `${n} ${t("weeks_unit")}`;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            backgroundColor: colors.background,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            padding: 20,
            paddingBottom: 34,
            gap: 14,
          }}
        >
          <View style={{ flexDirection: row, alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ fontFamily: font.bold, fontSize: 18, color: colors.foreground, textAlign }}>
              {t("plan_ahead_title")}
            </Text>
            <IconButton icon="x" size={18} onPress={onClose} bg="transparent" color={colors.mutedForeground} />
          </View>
          <Text style={{ fontFamily: font.regular, fontSize: 13.5, color: colors.mutedForeground, textAlign, lineHeight: 19 }}>
            {t("plan_ahead_hint")}
          </Text>
          {options.map((n) => (
            <Btn
              key={n}
              label={labelFor(n)}
              icon="calendar"
              variant={n === 2 ? "primary" : "secondary"}
              onPress={() => onPick(n)}
            />
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function BalanceSheet({
  visible,
  dates,
  weekLabel,
  onClose,
}: {
  visible: boolean;
  dates: string[];
  weekLabel: string;
  onClose: () => void;
}) {
  const { colors, row, textAlign } = useUI();
  const app = useApp();
  const t = app.t;
  const changes = useMemo(
    () => (visible ? app.rebalancePreview(dates) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible, dates, app.state],
  );
  const nameOf = (id: string | null) => (id ? app.personName(id) : "—");
  const dayLabel = (iso: string) =>
    `${app.weekday(dayOfWeek(iso))} · ${formatShort(iso)}`;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            backgroundColor: colors.background,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            padding: 20,
            paddingBottom: 34,
            gap: 14,
          }}
        >
          <View style={{ flexDirection: row, alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ fontFamily: font.bold, fontSize: 18, color: colors.foreground, textAlign }}>
              {t("balance_title")}
            </Text>
            <IconButton icon="x" size={18} onPress={onClose} bg="transparent" color={colors.mutedForeground} />
          </View>
          <Text style={{ fontFamily: font.regular, fontSize: 13.5, color: colors.mutedForeground, textAlign, lineHeight: 19 }}>
            {changes.length === 0
              ? t("already_balanced")
              : `${t("balance_hint")} (${weekLabel})`}
          </Text>

          {changes.length > 0 ? (
            <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
              <View style={{ gap: 8 }}>
                {changes.map((c, i) => (
                  <View
                    key={`${c.date}-${c.crew}-${c.role}-${c.crewIndex}-${i}`}
                    style={{
                      flexDirection: row,
                      alignItems: "center",
                      gap: 10,
                      padding: 11,
                      borderRadius: colors.radius,
                      backgroundColor: colors.card,
                      borderWidth: StyleSheet.hairlineWidth,
                      borderColor: colors.border,
                    }}
                  >
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={{ fontFamily: font.semibold, fontSize: 13.5, color: colors.foreground, textAlign }}>
                        {dayLabel(c.date)}
                      </Text>
                      <Text style={{ fontFamily: font.medium, fontSize: 12, color: colors.mutedForeground, textAlign }}>
                        {t(c.crew)} · {t(c.role)}
                      </Text>
                    </View>
                    <View style={{ flexDirection: row, alignItems: "center", gap: 6, flexShrink: 1 }}>
                      <Text style={{ fontFamily: font.medium, fontSize: 12.5, color: colors.mutedForeground }}>
                        {nameOf(c.oldId)}
                      </Text>
                      <Feather name="arrow-right" size={13} color={colors.mutedForeground} />
                      <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: colors.primary }}>
                        {nameOf(c.newId)}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </ScrollView>
          ) : null}

          {changes.length > 0 ? (
            <Btn
              label={`${t("apply")} (${changes.length})`}
              icon="check"
              variant="primary"
              onPress={() => {
                app.applyRebalance(dates);
                onClose();
              }}
            />
          ) : null}
          <Btn label={t("close")} variant="secondary" onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function DayCard({
  date,
  formatDate,
  onSlot,
  onSolo,
}: {
  date: string;
  formatDate: (iso: string) => string;
  onSlot: (crew: CrewKind, role: SlotRole, crewIndex: number) => void;
  onSolo: () => void;
}) {
  const { colors, row, textAlign } = useUI();
  const app = useApp();
  const t = app.t;
  const wknd = isWeekend(date);
  const solo = app.getSolo(date);
  const isToday = date === todayISO();
  const dow = dayOfWeek(date);
  const d = parseISO(date);
  const extraCrews = app.extraCrewCount(date);

  return (
    <Card
      style={{
        marginBottom: 12,
        borderColor: isToday ? colors.primary : colors.border,
        borderWidth: isToday ? 1.5 : StyleSheet.hairlineWidth,
      }}
    >
      <View
        style={{
          flexDirection: row,
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <View style={{ flexDirection: row, alignItems: "baseline", gap: 8 }}>
          <Text style={{ fontFamily: font.bold, fontSize: 16, color: colors.foreground }}>
            {app.weekday(dow)}
          </Text>
          <Text style={{ fontFamily: font.medium, fontSize: 13, color: colors.mutedForeground }}>
            {d.getDate()}/{d.getMonth() + 1}
          </Text>
        </View>
        <View style={{ flexDirection: row, alignItems: "center", gap: 8 }}>
          {wknd ? <Pill label={t("weekend")} tone="accent" /> : null}
          <IconButton
            icon="trash-2"
            size={16}
            onPress={() => app.clearDay(date)}
            color={colors.mutedForeground}
            bg="transparent"
          />
        </View>
      </View>

      <CrewBlock label={t("duty_crew")} crew="duty" date={date} onSlot={onSlot} icon="shield" />
      {Array.from({ length: extraCrews }).map((_, i) => {
        const idx = i + 1;
        return (
          <View key={idx} style={{ marginTop: 10 }}>
            <CrewBlock
              label={`${t("crew_label")} ${idx + 1}`}
              crew="duty"
              date={date}
              crewIndex={idx}
              onSlot={onSlot}
              icon="shield"
              onRemove={idx === extraCrews ? () => app.removeCrew(date) : undefined}
            />
          </View>
        );
      })}
      {extraCrews < MAX_EXTRA_CREWS ? (
        <Pressable
          onPress={() => {
            tap();
            app.addCrew(date);
          }}
          style={{
            flexDirection: row,
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            marginTop: 8,
            paddingVertical: 9,
            borderRadius: colors.radius,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.border,
          }}
        >
          <Feather name="plus" size={14} color={colors.primary} />
          <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: colors.primary }}>
            {t("add_crew")}
          </Text>
        </Pressable>
      ) : null}

      <View style={{ height: 10 }} />
      <CrewBlock label={t("standby_crew")} crew="standby" date={date} onSlot={onSlot} icon="clock" />

      <View style={{ height: 10 }} />
      <Pressable
        onPress={() => {
          tap();
          onSolo();
        }}
        style={{
          flexDirection: row,
          alignItems: "center",
          gap: 10,
          backgroundColor: colors.muted,
          borderRadius: colors.radius,
          paddingHorizontal: 12,
          paddingVertical: 10,
        }}
      >
        <Feather name="user" size={14} color={colors.mutedForeground} />
        {solo ? (
          <>
            <Text style={{ flex: 1, fontFamily: font.semibold, fontSize: 14, color: colors.foreground, textAlign }}>
              {app.personName(solo.personId)}
            </Text>
            <Pill label={t("does_not_count")} tone="muted" />
          </>
        ) : (
          <Text style={{ flex: 1, fontFamily: font.regular, fontSize: 13, color: colors.mutedForeground, textAlign }}>
            {t("non_counting_add")}
          </Text>
        )}
        <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
      </Pressable>
    </Card>
  );
}

function CrewBlock({
  label,
  crew,
  date,
  onSlot,
  icon,
  crewIndex = 0,
  onRemove,
}: {
  label: string;
  crew: CrewKind;
  date: string;
  onSlot: (crew: CrewKind, role: SlotRole, crewIndex: number) => void;
  icon: keyof typeof Feather.glyphMap;
  crewIndex?: number;
  onRemove?: () => void;
}) {
  const { colors, row, textAlign } = useUI();
  const app = useApp();
  const t = app.t;
  const roles: SlotRole[] = ["captain", "copilot"];

  return (
    <View
      style={{
        backgroundColor: colors.muted,
        borderRadius: colors.radius,
        padding: 10,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: row, alignItems: "center", gap: 6 }}>
        <Feather name={icon} size={13} color={colors.mutedForeground} />
        <Text style={{ flex: 1, fontFamily: font.semibold, fontSize: 12, color: colors.mutedForeground, textAlign }}>
          {label}
        </Text>
        {onRemove ? (
          <IconButton
            icon="x"
            size={14}
            onPress={onRemove}
            color={colors.mutedForeground}
            bg="transparent"
          />
        ) : null}
      </View>
      {roles.map((role) => {
        const a = app.getAssignment(date, crew, role, crewIndex);
        return (
          <Pressable
            key={role}
            onPress={() => {
              tap();
              onSlot(crew, role, crewIndex);
            }}
            style={{
              flexDirection: row,
              alignItems: "center",
              gap: 10,
              backgroundColor: colors.card,
              borderRadius: colors.radius - 4,
              paddingHorizontal: 12,
              paddingVertical: 10,
            }}
          >
            <Text style={{ width: 78, fontFamily: font.medium, fontSize: 12.5, color: colors.mutedForeground }}>
              {t(role)}
            </Text>
            {a ? (
              <Text style={{ flex: 1, fontFamily: font.semibold, fontSize: 14.5, color: colors.foreground }}>
                {app.personName(a.personId)}
              </Text>
            ) : (
              <Text style={{ flex: 1, fontFamily: font.regular, fontSize: 14, color: colors.mutedForeground }}>
                {t("tap_assign")}
              </Text>
            )}
            {crew === "standby" && a?.activated ? (
              <Feather name="zap" size={15} color={colors.accent} />
            ) : null}
            <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
          </Pressable>
        );
      })}
    </View>
  );
}

function formatShort(iso: string): string {
  const d = parseISO(iso);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

function ShareSheet({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (weeks: number) => void;
}) {
  const { colors, row, textAlign } = useUI();
  const app = useApp();
  const t = app.t;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            backgroundColor: colors.background,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            padding: 20,
            paddingBottom: 34,
            gap: 14,
          }}
        >
          <View style={{ flexDirection: row, alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ fontFamily: font.bold, fontSize: 18, color: colors.foreground, textAlign }}>
              {t("export_roster_title")}
            </Text>
            <IconButton icon="x" size={18} onPress={onClose} bg="transparent" color={colors.mutedForeground} />
          </View>
          <Text style={{ fontFamily: font.regular, fontSize: 13.5, color: colors.mutedForeground, textAlign, lineHeight: 19 }}>
            {t("export_roster_hint")}
          </Text>
          <Btn label={t("export_this_week")} icon="file-text" variant="secondary" onPress={() => onPick(1)} />
          <Btn label={t("export_two_weeks")} icon="calendar" variant="primary" onPress={() => onPick(2)} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function buildSheetHtml(
  app: ReturnType<typeof useApp>,
  weekStart: string,
  weeks: number,
): string {
  const t = app.t;
  const dates: string[] = [];
  for (let w = 0; w < weeks; w++) {
    dates.push(...weekDates(addDays(weekStart, w * 7)));
  }

  const nameOf = (
    date: string,
    crew: CrewKind,
    role: SlotRole,
    crewIndex = 0,
  ): string => {
    const a = app.getAssignment(date, crew, role, crewIndex);
    return a ? app.personName(a.personId) : "—";
  };

  const days: RosterDay[] = dates.map((date) => {
    const d = parseISO(date);
    const solo = app.getSolo(date);
    const specials = app.state.specials
      .filter((s) => s.date === date)
      .map((s) => ({
        name: s.eventName,
        person: app.personName(s.personId),
      }));
    // Location duties covering this day, grouped by location (crew names joined).
    const dayLocMap = new Map<string, string[]>();
    for (const l of app.state.locations) {
      if (date < l.startDate || date > l.endDate) continue;
      const arr = dayLocMap.get(l.location) ?? [];
      arr.push(app.personName(l.personId));
      dayLocMap.set(l.location, arr);
    }
    const dayLocations = [...dayLocMap.entries()].map(([location, people]) => ({
      location,
      people: people.join(", "),
    }));
    return {
      weekday: app.weekday(dayOfWeek(date)),
      dateLabel: `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`,
      isWeekend: isWeekend(date),
      dutyCaptain: nameOf(date, "duty", "captain"),
      dutyCopilot: nameOf(date, "duty", "copilot"),
      standbyCaptain: nameOf(date, "standby", "captain"),
      standbyCopilot: nameOf(date, "standby", "copilot"),
      extraDuty: (() => {
        // Count declared extra crews, but also infer from any crewIndex>0
        // assignments (e.g. restored from an older backup) so the export
        // never silently drops a filled crew.
        const declared = app.extraCrewCount(date);
        const assigned = app.state.assignments.reduce(
          (m, a) =>
            a.date === date && a.crew === "duty"
              ? Math.max(m, a.crewIndex ?? 0)
              : m,
          0,
        );
        const n = Math.max(declared, assigned);
        return n > 0
          ? Array.from({ length: n }, (_, i) => ({
              captain: nameOf(date, "duty", "captain", i + 1),
              copilot: nameOf(date, "duty", "copilot", i + 1),
            }))
          : undefined;
      })(),
      solo: solo ? app.personName(solo.personId) : undefined,
      specials: specials.length ? specials : undefined,
      locations: dayLocations.length ? dayLocations : undefined,
    };
  });

  const first = parseISO(dates[0]);
  const last = parseISO(dates[dates.length - 1]);
  const rangeStart = dates[0];
  const rangeEnd = dates[dates.length - 1];
  const fmtDate = (iso: string): string => {
    const p = parseISO(iso);
    return `${p.getDate()}/${p.getMonth() + 1}/${p.getFullYear()}`;
  };
  const arrow = app.isRTL ? "←" : "→";
  // Group location stints by location + date range so a crew (captain +
  // co-pilot over the same range) reads as one line with both names.
  const locGroups = new Map<
    string,
    { location: string; startDate: string; endDate: string; people: string[] }
  >();
  for (const l of app.state.locations) {
    if (!(l.startDate <= rangeEnd && l.endDate >= rangeStart)) continue;
    const key = `${l.location}|${l.startDate}|${l.endDate}`;
    const g =
      locGroups.get(key) ??
      {
        location: l.location,
        startDate: l.startDate,
        endDate: l.endDate,
        people: [],
      };
    g.people.push(app.personName(l.personId));
    locGroups.set(key, g);
  }
  const locations: RosterLocation[] = [...locGroups.values()]
    .sort((a, b) => (a.startDate < b.startDate ? -1 : 1))
    .map((g) => ({
      location: g.location,
      detail: `${g.people.join(", ")} · ${fmtDate(g.startDate)} ${arrow} ${fmtDate(g.endDate)}`,
    }));

  const subtitle = `${first.getDate()}/${first.getMonth() + 1}/${first.getFullYear()} – ${last.getDate()}/${last.getMonth() + 1}/${last.getFullYear()}`;
  const now = new Date();
  const generatedOn = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`;

  return buildRosterHtml({
    title: app.settings.squadronName.trim() || t("roster_title"),
    subtitle,
    isRTL: app.isRTL,
    generatedOn,
    labels: {
      day: t("date"),
      dutyCrew: t("duty_crew"),
      standbyCrew: t("standby_crew"),
      captain: t("captain"),
      copilot: t("copilot"),
      weekend: t("weekend"),
      solo: t("single_cover"),
      crew: t("crew_label"),
      generatedOn: t("generated_on"),
      locationDuty: t("location_duty"),
    },
    days,
    locations,
  });
}
