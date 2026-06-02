import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  Btn,
  Card,
  EmptyState,
  Field,
  font,
  Header,
  IconButton,
  Loading,
  Screen,
  SectionLabel,
  Segmented,
  tap,
  useUI,
} from "@/components/ui";
import { useApp } from "@/context/AppContext";
import { SlotRole } from "@/lib/types";

export default function RosterScreen() {
  const { colors, row } = useUI();
  const app = useApp();
  const [adding, setAdding] = useState(false);

  if (!app.ready) return <Loading />;
  const t = app.t;

  const captains = app.state.people.filter((p) => p.role === "captain");
  const copilots = app.state.people.filter((p) => p.role === "copilot");
  const empty = app.state.people.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Header
        title={t("tab_roster")}
        right={
          <IconButton
            icon="user-plus"
            onPress={() => setAdding(true)}
            color={colors.primaryForeground}
            bg={colors.primary}
          />
        }
      />
      <Screen scroll>
        {empty ? (
          <EmptyState
            icon="users"
            title={t("empty_roster")}
            hint={t("empty_roster_hint")}
          />
        ) : (
          <>
            <SectionLabel text={t("captains")} />
            {captains.length === 0 ? (
              <Text style={{ fontFamily: font.regular, color: colors.mutedForeground, marginBottom: 16 }}>
                —
              </Text>
            ) : (
              captains.map((p) => <PersonRow key={p.id} id={p.id} />)
            )}

            <View style={{ height: 12 }} />
            <SectionLabel text={t("copilots")} />
            {copilots.length === 0 ? (
              <Text style={{ fontFamily: font.regular, color: colors.mutedForeground }}>—</Text>
            ) : (
              copilots.map((p) => <PersonRow key={p.id} id={p.id} />)
            )}
          </>
        )}
      </Screen>

      {adding ? <AddPersonModal onClose={() => setAdding(false)} /> : null}
    </View>
  );
}

function PersonRow({ id }: { id: string }) {
  const { colors, row, textAlign } = useUI();
  const app = useApp();
  const t = app.t;
  const person = app.state.people.find((p) => p.id === id);
  if (!person) return null;

  const confirmDelete = () => {
    if (Platform.OS === "web") {
      // eslint-disable-next-line no-alert
      if (window.confirm(t("delete_person_confirm"))) app.deletePerson(id);
      return;
    }
    Alert.alert(person.name, t("delete_person_confirm"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("delete"), style: "destructive", onPress: () => app.deletePerson(id) },
    ]);
  };

  return (
    <Card style={{ marginBottom: 8 }}>
      <View style={{ flexDirection: row, alignItems: "center", gap: 12 }}>
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: 19,
            backgroundColor: person.active ? colors.primary + "18" : colors.muted,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Feather
            name={person.role === "captain" ? "award" : "user"}
            size={17}
            color={person.active ? colors.primary : colors.mutedForeground}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: font.semibold, fontSize: 15.5, color: colors.foreground, textAlign }}>
            {person.name}
          </Text>
          <Text style={{ fontFamily: font.medium, fontSize: 12.5, color: person.active ? colors.success : colors.mutedForeground, textAlign }}>
            {person.active ? t("in_rotation") : t("out_of_rotation")}
          </Text>
        </View>
        <Pressable
          onPress={() => {
            tap();
            app.setPersonActive(id, !person.active);
          }}
          style={{
            width: 46,
            height: 28,
            borderRadius: 999,
            backgroundColor: person.active ? colors.primary : colors.muted,
            padding: 3,
            justifyContent: "center",
            alignItems: person.active ? "flex-end" : "flex-start",
          }}
        >
          <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: colors.card }} />
        </Pressable>
        <IconButton
          icon="trash-2"
          size={16}
          onPress={confirmDelete}
          color={colors.destructive}
          bg={colors.destructive + "14"}
        />
      </View>
    </Card>
  );
}

function AddPersonModal({ onClose }: { onClose: () => void }) {
  const { colors, row } = useUI();
  const app = useApp();
  const insets = useSafeAreaInsets();
  const t = app.t;
  const [name, setName] = useState("");
  const [role, setRole] = useState<SlotRole>("captain");

  const submit = () => {
    if (!name.trim()) return;
    app.addPerson(name, role);
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
        <View style={{ flexDirection: row, alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <Text style={{ fontFamily: font.bold, fontSize: 18, color: colors.foreground }}>
            {t("add_person")}
          </Text>
          <IconButton icon="x" onPress={onClose} />
        </View>

        <View style={{ gap: 14 }}>
          <Field label={t("person_name")} value={name} onChangeText={setName} placeholder={t("name_placeholder")} />
          <View style={{ gap: 6 }}>
            <Text style={{ fontFamily: font.medium, fontSize: 13, color: colors.mutedForeground }}>{t("role")}</Text>
            <Segmented
              value={role}
              onChange={setRole}
              options={[
                { key: "captain", label: t("captain") },
                { key: "copilot", label: t("copilot") },
              ]}
            />
          </View>
          <Btn label={t("add")} icon="check" onPress={submit} disabled={!name.trim()} />
        </View>
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
