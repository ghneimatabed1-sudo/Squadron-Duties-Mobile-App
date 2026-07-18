import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
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
import { CrewKind, SlotRole } from "@/lib/types";

import { Btn, font, IconButton, Pill, tap, useUI } from "./ui";

export interface SlotTarget {
  date: string;
  crew: CrewKind;
  role: SlotRole;
  /** When true, the slot belongs to a block weekend: edits apply to all 3 days. */
  weekendBlock?: boolean;
  /** Duty crew index: 0 = base crew, 1+ = an extra duty crew on that day. */
  crewIndex?: number;
}

/**
 * Queue-position pill: how long this person has waited since their last turn
 * in THIS queue (weekday duty / weekend duty / standby). "Resting" means they
 * worked within the rest gap and should only be used if nobody else can.
 */
function waitPill(
  c: { waitDays: number | null; resting: boolean },
  t: (k: string) => string,
): { label: string; tone: "owed" | "ahead" | "muted" } {
  if (c.resting) return { label: t("resting"), tone: "ahead" };
  if (c.waitDays === null) return { label: t("no_turn_yet"), tone: "owed" };
  return { label: `${c.waitDays} ${t("days_since_turn")}`, tone: "muted" };
}

export function SlotEditorSheet({
  target,
  onClose,
  formatDate,
}: {
  target: SlotTarget | null;
  onClose: () => void;
  formatDate: (iso: string) => string;
}) {
  const { colors, row, textAlign, isRTL } = useUI();
  const app = useApp();
  const insets = useSafeAreaInsets();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const isBlock = target?.weekendBlock ?? false;
  const visible = target !== null;
  const current = target
    ? app.getAssignment(target.date, target.crew, target.role, target.crewIndex ?? 0)
    : undefined;

  const candidates = useMemo(
    () => (target ? app.recommendSlot(target.date, target.role, target.crew) : []),
    [target, app],
  );

  const close = () => {
    setPendingId(null);
    onClose();
  };

  const commit = (personId: string | null) => {
    if (!target) return;
    if (target.weekendBlock) {
      app.setWeekendBlock(target.date, target.crew, target.role, personId);
    } else {
      app.setAssignment(
        target.date,
        target.crew,
        target.role,
        personId,
        target.crewIndex ?? 0,
      );
    }
    tap();
    close();
  };

  if (!target) return null;

  const t = app.t;
  const title =
    `${t(target.role)} · ${target.crew === "duty" ? t("duty") : t("standby")}`;
  const firstEligibleId = candidates.find(
    (c) => c.eligible && !c.singleCover,
  )?.person.id;
  const pendingCand = candidates.find((c) => c.person.id === pendingId);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} />
      <View
        style={[
          styles.sheet,
          {
            backgroundColor: colors.background,
            paddingBottom: insets.bottom + 16,
            borderColor: colors.border,
          },
        ]}
      >
        {/* header */}
        <View
          style={{
            flexDirection: row,
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 4,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: font.bold, fontSize: 18, color: colors.foreground, textAlign }}>
              {title}
            </Text>
            <Text style={{ fontFamily: font.medium, fontSize: 13, color: colors.mutedForeground, marginTop: 2, textAlign }}>
              {isBlock ? t("weekend_one_crew_hint") : formatDate(target.date)}
            </Text>
          </View>
          <IconButton icon="x" onPress={close} />
        </View>

        {/* current occupant */}
        {current ? (
          <View
            style={{
              flexDirection: row,
              alignItems: "center",
              gap: 10,
              backgroundColor: colors.card,
              borderRadius: colors.radius,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: colors.border,
              padding: 12,
              marginTop: 12,
            }}
          >
            <Feather name="user-check" size={18} color={colors.primary} />
            <Text style={{ flex: 1, fontFamily: font.semibold, fontSize: 15, color: colors.foreground, textAlign }}>
              {app.personName(current.personId)}
            </Text>
            {target.crew === "standby" ? (
              <Pressable
                onPress={() => app.toggleActivated(target.date, target.role)}
                style={{
                  flexDirection: row,
                  alignItems: "center",
                  gap: 6,
                  backgroundColor: current.activated
                    ? colors.accent + "22"
                    : colors.muted,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 999,
                }}
              >
                <Feather
                  name="zap"
                  size={13}
                  color={current.activated ? colors.accent : colors.mutedForeground}
                />
                <Text
                  style={{
                    fontFamily: font.semibold,
                    fontSize: 12,
                    color: current.activated ? colors.accent : colors.mutedForeground,
                  }}
                >
                  {t("activated")}
                </Text>
              </Pressable>
            ) : null}
            <IconButton
              icon="user-x"
              onPress={() => commit(null)}
              color={colors.destructive}
              bg={colors.destructive + "18"}
            />
          </View>
        ) : null}

        {/* block-weekend note */}
        {isBlock ? (
          <View
            style={{
              flexDirection: row,
              gap: 8,
              alignItems: "flex-start",
              marginTop: 12,
            }}
          >
            <Feather name="info" size={14} color={colors.accent} style={{ marginTop: 2 }} />
            <Text style={{ flex: 1, fontFamily: font.medium, fontSize: 12.5, color: colors.accent, lineHeight: 17, textAlign }}>
              {t("weekend_block_note")}
            </Text>
          </View>
        ) : null}

        <Text
          style={{
            fontFamily: font.semibold,
            fontSize: 13,
            color: colors.mutedForeground,
            marginTop: 16,
            marginBottom: 8,
            textAlign,
          }}
        >
          {t("choose_person")}
        </Text>

        <ScrollView style={{ maxHeight: 280 }} showsVerticalScrollIndicator={false}>
          {candidates.map((c) => {
            const bp = waitPill(c, t);
            const isPending = c.person.id === pendingId;
            const isCurrent = c.person.id === current?.personId;
            return (
              <Pressable
                key={c.person.id}
                disabled={!c.eligible}
                onPress={() => {
                  tap();
                  if (isCurrent) return;
                  setPendingId(isPending ? null : c.person.id);
                }}
                style={{
                  flexDirection: row,
                  alignItems: "center",
                  gap: 10,
                  paddingVertical: 11,
                  paddingHorizontal: 12,
                  borderRadius: colors.radius,
                  marginBottom: 6,
                  backgroundColor: isPending ? colors.primary + "14" : colors.card,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: isPending ? colors.primary : colors.border,
                  opacity: c.eligible ? 1 : 0.5,
                }}
              >
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={{ flexDirection: row, alignItems: "center", gap: 8 }}>
                    <Text style={{ fontFamily: font.semibold, fontSize: 15, color: colors.foreground }}>
                      {c.person.name}
                    </Text>
                    {c.person.id === firstEligibleId && !isCurrent ? (
                      <Pill label={t("recommended")} tone="primary" />
                    ) : null}
                    {c.singleCover ? (
                      <Pill label={t("type_single_cover")} tone="accent" />
                    ) : null}
                  </View>
                  {!c.eligible ? (
                    <Text style={{ fontFamily: font.medium, fontSize: 12, color: colors.mutedForeground }}>
                      {t(c.reasonKey ?? "not_eligible")}
                    </Text>
                  ) : c.singleCover ? (
                    <Text style={{ fontFamily: font.medium, fontSize: 12, color: colors.mutedForeground }}>
                      {t("does_not_count")}
                    </Text>
                  ) : (
                    <Pill label={bp.label} tone={bp.tone} />
                  )}
                  {c.eligible && c.resting ? (
                    <Text style={{ fontFamily: font.medium, fontSize: 11.5, color: colors.mutedForeground }}>
                      {t("resting_hint")}
                    </Text>
                  ) : null}
                </View>
                {isCurrent ? (
                  <Feather name="check" size={18} color={colors.success} />
                ) : isPending ? (
                  <Feather name="arrow-right-circle" size={20} color={colors.primary} />
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>

        {/* confirm pending pick */}
        {pendingCand ? (
          <View
            style={{
              marginTop: 12,
              backgroundColor: colors.card,
              borderRadius: colors.radius,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: colors.border,
              padding: 14,
              gap: 10,
            }}
          >
            {isBlock ? (
              <View style={{ flexDirection: row, gap: 8, alignItems: "flex-start" }}>
                <Feather name="info" size={13} color={colors.accent} style={{ marginTop: 2 }} />
                <Text
                  style={{
                    flex: 1,
                    fontFamily: font.medium,
                    fontSize: 12,
                    color: colors.accent,
                    lineHeight: 17,
                    textAlign,
                  }}
                >
                  {t("weekend_preview_note")}
                </Text>
              </View>
            ) : null}

            <View style={{ flexDirection: row, gap: 8, alignItems: "flex-start" }}>
              <Feather
                name={pendingCand.resting ? "alert-triangle" : "info"}
                size={14}
                color={pendingCand.resting ? colors.warning : colors.mutedForeground}
                style={{ marginTop: 2 }}
              />
              <Text
                style={{
                  flex: 1,
                  fontFamily: font.medium,
                  fontSize: 12.5,
                  color: pendingCand.resting ? colors.warning : colors.mutedForeground,
                  lineHeight: 18,
                  textAlign,
                }}
              >
                {pendingCand.resting
                  ? `${pendingCand.person.name} — ${t("resting_warning")}`
                  : pendingCand.waitDays === null
                    ? `${pendingCand.person.name} — ${t("no_turn_yet")}`
                    : `${pendingCand.person.name} — ${pendingCand.waitDays} ${t("days_since_turn")}`}
              </Text>
            </View>

            <Btn
              label={t("confirm_swap")}
              icon="check"
              onPress={() => commit(pendingCand.person.id)}
            />
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
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
