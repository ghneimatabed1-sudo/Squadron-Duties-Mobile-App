import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs } from "expo-router";
import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import { SymbolView } from "expo-symbols";
import React from "react";
import { Platform, StyleSheet, View, useColorScheme } from "react-native";

import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";

const TABS: {
  name: string;
  titleKey: string;
  feather: keyof typeof Feather.glyphMap;
  sf: string;
}[] = [
  { name: "index", titleKey: "tab_schedule", feather: "calendar", sf: "calendar" },
  { name: "roster", titleKey: "tab_roster", feather: "users", sf: "person.2" },
  { name: "availability", titleKey: "tab_availability", feather: "clipboard", sf: "checklist" },
  { name: "tracking", titleKey: "tab_tracking", feather: "bar-chart-2", sf: "chart.bar" },
  { name: "events", titleKey: "tab_events", feather: "star", sf: "star" },
  { name: "settings", titleKey: "tab_settings", feather: "settings", sf: "gearshape" },
];

function NativeTabLayout() {
  const { t } = useApp();
  return (
    <NativeTabs>
      {TABS.map((tab) => (
        <NativeTabs.Trigger key={tab.name} name={tab.name}>
          <Icon sf={tab.sf as never} />
          <Label>{t(tab.titleKey)}</Label>
        </NativeTabs.Trigger>
      ))}
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const colors = useColors();
  const { t } = useApp();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: false,
        tabBarLabelStyle: { fontFamily: "Inter_500Medium", fontSize: 11 },
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : colors.background,
          borderTopWidth: isWeb ? 1 : 0,
          borderTopColor: colors.border,
          elevation: 0,
          ...(isWeb ? { height: 84 } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={100}
              tint={isDark ? "dark" : "light"}
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View
              style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]}
            />
          ) : null,
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: t(tab.titleKey),
            tabBarIcon: ({ color }) =>
              isIOS ? (
                <SymbolView name={tab.sf as never} tintColor={color} size={24} />
              ) : (
                <Feather name={tab.feather} size={22} color={color} />
              ),
          }}
        />
      ))}
    </Tabs>
  );
}

export default function TabLayout() {
  if (isLiquidGlassAvailable()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}
