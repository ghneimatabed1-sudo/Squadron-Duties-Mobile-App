import { Feather } from "@expo/vector-icons";
import React from "react";
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

import { font, IconButton, Pill, tap, useUI } from "./ui";

export function SoloPickerSheet({
  date,
  onClose,
  formatDate,
}: {
  date: string | null;
  onClose: () => void;
  formatDate: (iso: string) => string;
}) {
  const { colors, row, textAlign } = useUI();
  const app = useApp();
  const insets = useSafeAreaInsets();
  const t = app.t;

  const visible = date !== null;
  const current = date ? app.getSolo(date) : undefined;
  const people = app.state.people.filter((p) => p.active && !p.availabilityOnly);

  const choose = (personId: string | null) => {
    if (!date) return;
    app.setSolo(date, personId);
    tap();
    onClose();
  };

  if (!date) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
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
        <View
          style={{
            flexDirection: row,
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 4,
          }}
        >
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: row, alignItems: "center", gap: 8 }}>
              <Text style={{ fontFamily: font.bold, fontSize: 18, color: colors.foreground, textAlign }}>
                {t("non_counting")}
              </Text>
              <Pill label={t("does_not_count")} tone="muted" />
            </View>
            <Text style={{ fontFamily: font.medium, fontSize: 13, color: colors.mutedForeground, marginTop: 2, textAlign }}>
              {formatDate(date)}
            </Text>
          </View>
          <IconButton icon="x" onPress={onClose} />
        </View>

        <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: colors.mutedForeground, marginTop: 6, lineHeight: 18, textAlign }}>
          {t("non_counting_hint")}
        </Text>

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
            <IconButton
              icon="x"
              onPress={() => choose(null)}
              color={colors.destructive}
              bg={colors.destructive + "18"}
            />
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
          {t("choose_anyone")}
        </Text>

        <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
          {people.map((p) => {
            const isCurrent = p.id === current?.personId;
            return (
              <Pressable
                key={p.id}
                onPress={() => choose(p.id)}
                style={{
                  flexDirection: row,
                  alignItems: "center",
                  gap: 10,
                  paddingVertical: 11,
                  paddingHorizontal: 12,
                  borderRadius: colors.radius,
                  marginBottom: 6,
                  backgroundColor: colors.card,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: isCurrent ? colors.primary : colors.border,
                }}
              >
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={{ fontFamily: font.semibold, fontSize: 15, color: colors.foreground, textAlign }}>
                    {p.name}
                  </Text>
                  <Text style={{ fontFamily: font.medium, fontSize: 12, color: colors.mutedForeground, textAlign }}>
                    {t(p.role)}
                  </Text>
                </View>
                {isCurrent ? (
                  <Feather name="check" size={18} color={colors.success} />
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
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
