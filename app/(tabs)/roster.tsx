import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
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
import { dayOfWeek, parseISO, todayISO } from "@/lib/dates";
import { SlotRole } from "@/lib/types";

function fmtDate(app: ReturnType<typeof useApp>, iso: string): string {
  const d = parseISO(iso);
  return `${app.weekday(dayOfWeek(iso))} · ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

export default function RosterScreen() {
  const { colors, row } = useUI();
  const app = useApp();
  const [adding, setAdding] = useState(false);

  if (!app.ready) return <Loading />;
  const t = app.t;

  const rosterPeople = app.state.people.filter((p) => !p.availabilityOnly);
  const captains = rosterPeople.filter((p) => p.role === "captain");
  const copilots = rosterPeople.filter((p) => p.role === "copilot");
  const empty = rosterPeople.length === 0;

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
  const [renaming, setRenaming] = useState(false);
  const person = app.state.people.find((p) => p.id === id);
  const today = todayISO();
  const awayNow = app.state.leaves.some(
    (lv) => lv.personId === id && today >= lv.startDate && today <= lv.endDate,
  );
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
            name={
              person.singleCover
                ? "shield"
                : person.role === "captain"
                  ? "award"
                  : "user"
            }
            size={17}
            color={person.active ? colors.primary : colors.mutedForeground}
          />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ fontFamily: font.semibold, fontSize: 15.5, color: colors.foreground, textAlign }}>
            {person.name}
          </Text>
          <View style={{ flexDirection: row, alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {person.singleCover ? (
              <Pill label={t("type_single_cover")} tone="accent" />
            ) : null}
            {awayNow ? <Pill label={t("away_pill")} tone="owed" /> : null}
            <Text style={{ fontFamily: font.medium, fontSize: 12.5, color: person.active ? colors.success : colors.mutedForeground, textAlign }}>
              {person.active ? t("in_rotation") : t("out_of_rotation")}
            </Text>
          </View>
          <Pressable
            onPress={() => {
              tap();
              app.setPersonSingleCover(id, !person.singleCover);
            }}
            style={{
              flexDirection: row,
              alignItems: "center",
              gap: 5,
              alignSelf: "flex-start",
              marginTop: 4,
              paddingVertical: 4,
              paddingHorizontal: 9,
              borderRadius: 999,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: colors.border,
              backgroundColor: colors.muted,
            }}
          >
            <Feather
              name={person.singleCover ? "refresh-cw" : "shield"}
              size={11}
              color={colors.mutedForeground}
            />
            <Text style={{ fontFamily: font.medium, fontSize: 11.5, color: colors.mutedForeground }}>
              {person.singleCover ? t("move_to_rotation") : t("make_single_cover")}
            </Text>
          </Pressable>
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
          icon="edit-2"
          size={16}
          onPress={() => setRenaming(true)}
        />
        <IconButton
          icon="trash-2"
          size={16}
          onPress={confirmDelete}
          color={colors.destructive}
          bg={colors.destructive + "14"}
        />
      </View>
      {renaming ? (
        <RenamePersonModal
          id={id}
          initialName={person.name}
          onClose={() => setRenaming(false)}
        />
      ) : null}
    </Card>
  );
}

function RenamePersonModal({
  id,
  initialName,
  onClose,
}: {
  id: string;
  initialName: string;
  onClose: () => void;
}) {
  const { colors, row, textAlign } = useUI();
  const app = useApp();
  const insets = useSafeAreaInsets();
  const t = app.t;
  const [name, setName] = useState(initialName);
  const [addingAway, setAddingAway] = useState(false);
  const [awayStart, setAwayStart] = useState(todayISO());
  const [awayEnd, setAwayEnd] = useState(todayISO());

  const myLeaves = useMemo(
    () =>
      app.state.leaves
        .filter((lv) => lv.personId === id)
        .sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [app.state.leaves, id],
  );

  const submit = () => {
    if (!name.trim()) return;
    app.renamePerson(id, name);
    onClose();
  };

  const addAway = () => {
    if (awayEnd < awayStart) return;
    app.addLeave(id, awayStart, awayEnd);
    setAddingAway(false);
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
        <View style={{ flexDirection: row, alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <Text style={{ fontFamily: font.bold, fontSize: 18, color: colors.foreground }}>
            {t("edit_person")}
          </Text>
          <IconButton icon="x" onPress={onClose} />
        </View>
        <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: colors.mutedForeground, lineHeight: 18, marginBottom: 14 }}>
          {t("rename_person_hint")}
        </Text>
        <View style={{ gap: 14 }}>
          <Field label={t("person_name")} value={name} onChangeText={setName} placeholder={t("name_placeholder")} />

          <View style={{ gap: 6 }}>
            <Text style={{ fontFamily: font.medium, fontSize: 13, color: colors.mutedForeground, textAlign }}>
              {t("away_dates")}
            </Text>
            <Text style={{ fontFamily: font.regular, fontSize: 12, color: colors.mutedForeground, lineHeight: 17, textAlign }}>
              {t("away_dates_hint")}
            </Text>
            {myLeaves.length === 0 && !addingAway ? (
              <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: colors.mutedForeground, textAlign }}>
                {t("no_away_ranges")}
              </Text>
            ) : null}
            {myLeaves.map((lv) => (
              <View
                key={lv.id}
                style={{
                  flexDirection: row,
                  alignItems: "center",
                  gap: 8,
                  paddingVertical: 8,
                  paddingHorizontal: 10,
                  borderRadius: 10,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: colors.border,
                  backgroundColor: colors.muted,
                }}
              >
                <Feather name="slash" size={13} color={colors.mutedForeground} />
                <Text style={{ flex: 1, fontFamily: font.medium, fontSize: 12.5, color: colors.foreground, textAlign }}>
                  {lv.startDate === lv.endDate
                    ? fmtDate(app, lv.startDate)
                    : `${fmtDate(app, lv.startDate)} → ${fmtDate(app, lv.endDate)}`}
                </Text>
                <IconButton
                  icon="trash-2"
                  size={14}
                  onPress={() => app.removeLeave(lv.id)}
                  color={colors.destructive}
                  bg={colors.destructive + "14"}
                />
              </View>
            ))}
            {addingAway ? (
              <View style={{ gap: 10, marginTop: 4 }}>
                <DateField label={t("start_date")} value={awayStart} onChange={(v) => { setAwayStart(v); if (awayEnd < v) setAwayEnd(v); }} formatDate={(iso) => fmtDate(app, iso)} />
                <DateField label={t("end_date")} value={awayEnd} onChange={setAwayEnd} formatDate={(iso) => fmtDate(app, iso)} />
                <Btn label={t("add")} icon="check" onPress={addAway} disabled={awayEnd < awayStart} />
              </View>
            ) : (
              <Btn label={t("add_away_range")} icon="plus" variant="secondary" onPress={() => { setAwayStart(todayISO()); setAwayEnd(todayISO()); setAddingAway(true); }} />
            )}
          </View>

          <Btn label={t("save")} icon="check" onPress={submit} disabled={!name.trim()} />
        </View>
      </View>
    </Modal>
  );
}

function AddPersonModal({ onClose }: { onClose: () => void }) {
  const { colors, row } = useUI();
  const app = useApp();
  const insets = useSafeAreaInsets();
  const t = app.t;
  const [name, setName] = useState("");
  const [role, setRole] = useState<SlotRole>("captain");
  const [kind, setKind] = useState<"normal" | "single">("normal");

  const submit = () => {
    if (!name.trim()) return;
    app.addPerson(name, role, kind === "single");
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
          <View style={{ gap: 6 }}>
            <Text style={{ fontFamily: font.medium, fontSize: 13, color: colors.mutedForeground }}>{t("person_type")}</Text>
            <Segmented
              value={kind}
              onChange={setKind}
              options={[
                { key: "normal", label: t("type_normal") },
                { key: "single", label: t("type_single_cover") },
              ]}
            />
            {kind === "single" ? (
              <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: colors.mutedForeground, lineHeight: 18, marginTop: 2 }}>
                {t("single_cover_desc")}
              </Text>
            ) : null}
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
