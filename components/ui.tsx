import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextStyle,
  View,
  ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";

export const font = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
};

export function useUI() {
  const colors = useColors();
  const { isRTL } = useApp();
  return {
    colors,
    isRTL,
    row: (isRTL ? "row-reverse" : "row") as "row" | "row-reverse",
    textAlign: (isRTL ? "right" : "left") as TextStyle["textAlign"],
    writingDirection: (isRTL ? "rtl" : "ltr") as TextStyle["writingDirection"],
  };
}

export function tap() {
  if (Platform.OS !== "web") {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }
}

// ---------------- Screen + Header ----------------

export function Screen({
  children,
  scroll,
  contentStyle,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  contentStyle?: ViewStyle;
}) {
  const { colors } = useUI();
  const insets = useSafeAreaInsets();
  const bottomPad =
    Platform.OS === "web" ? 100 : insets.bottom + 80;

  if (scroll) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[
            { padding: 16, paddingBottom: bottomPad },
            contentStyle,
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </View>
    );
  }
  return (
    <View
      style={[
        { flex: 1, backgroundColor: colors.background, padding: 16 },
        contentStyle,
      ]}
    >
      {children}
    </View>
  );
}

export function Header({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  const { colors, row, textAlign, writingDirection } = useUI();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top + 8;
  return (
    <View
      style={{
        paddingTop: topPad,
        paddingHorizontal: 16,
        paddingBottom: 14,
        backgroundColor: colors.background,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.border,
      }}
    >
      <View
        style={{
          flexDirection: row,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontFamily: font.bold,
              fontSize: 26,
              color: colors.foreground,
              textAlign,
              writingDirection,
            }}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text
              style={{
                fontFamily: font.medium,
                fontSize: 13,
                color: colors.mutedForeground,
                marginTop: 2,
                textAlign,
                writingDirection,
              }}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right}
      </View>
    </View>
  );
}

// ---------------- Text ----------------

export function TText(props: React.ComponentProps<typeof Text>) {
  const { textAlign, writingDirection, colors } = useUI();
  return (
    <Text
      {...props}
      style={[
        { color: colors.foreground, fontFamily: font.regular, textAlign, writingDirection },
        props.style,
      ]}
    />
  );
}

// ---------------- Card ----------------

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  const { colors } = useUI();
  return (
    <View
      style={[
        {
          backgroundColor: colors.card,
          borderRadius: colors.radius,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          padding: 14,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

// ---------------- Buttons ----------------

export function Btn({
  label,
  onPress,
  variant = "primary",
  icon,
  disabled,
  size = "md",
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost" | "destructive";
  icon?: keyof typeof Feather.glyphMap;
  disabled?: boolean;
  size?: "sm" | "md";
  style?: ViewStyle;
}) {
  const { colors, row } = useUI();
  const sm = size === "sm";
  const bg =
    variant === "primary"
      ? colors.primary
      : variant === "destructive"
        ? colors.destructive
        : variant === "secondary"
          ? colors.secondary
          : "transparent";
  const fg =
    variant === "primary"
      ? colors.primaryForeground
      : variant === "destructive"
        ? colors.destructiveForeground
        : variant === "secondary"
          ? colors.secondaryForeground
          : colors.primary;
  return (
    <Pressable
      onPress={() => {
        if (disabled) return;
        tap();
        onPress();
      }}
      disabled={disabled}
      style={({ pressed }) => [
        {
          flexDirection: row,
          alignItems: "center",
          justifyContent: "center",
          gap: sm ? 6 : 8,
          backgroundColor: bg,
          borderRadius: colors.radius,
          paddingVertical: sm ? 9 : 13,
          paddingHorizontal: sm ? 12 : 16,
          borderWidth: variant === "ghost" ? StyleSheet.hairlineWidth : 0,
          borderColor: colors.border,
          opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {icon ? <Feather name={icon} size={sm ? 15 : 18} color={fg} /> : null}
      <Text style={{ color: fg, fontFamily: font.semibold, fontSize: sm ? 13.5 : 15 }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function IconButton({
  icon,
  onPress,
  color,
  bg,
  size = 20,
}: {
  icon: keyof typeof Feather.glyphMap;
  onPress: () => void;
  color?: string;
  bg?: string;
  size?: number;
}) {
  const { colors } = useUI();
  return (
    <Pressable
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: colors.radius,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: bg ?? colors.secondary,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Feather name={icon} size={size} color={color ?? colors.foreground} />
    </Pressable>
  );
}

// ---------------- Pill ----------------

export function Pill({
  label,
  tone = "muted",
}: {
  label: string;
  tone?: "muted" | "owed" | "ahead" | "accent" | "primary";
}) {
  const { colors } = useUI();
  const map: Record<string, { bg: string; fg: string }> = {
    muted: { bg: colors.muted, fg: colors.mutedForeground },
    owed: { bg: colors.success + "22", fg: colors.success },
    ahead: { bg: colors.warning + "22", fg: colors.warning },
    accent: { bg: colors.accent + "22", fg: colors.accent },
    primary: { bg: colors.primary + "18", fg: colors.primary },
  };
  const c = map[tone];
  return (
    <View
      style={{
        backgroundColor: c.bg,
        paddingHorizontal: 9,
        paddingVertical: 4,
        borderRadius: 999,
        alignSelf: "flex-start",
      }}
    >
      <Text style={{ color: c.fg, fontFamily: font.semibold, fontSize: 11.5 }}>
        {label}
      </Text>
    </View>
  );
}

// ---------------- Segmented ----------------

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const { colors, row } = useUI();
  return (
    <View
      style={{
        flexDirection: row,
        backgroundColor: colors.muted,
        borderRadius: colors.radius,
        padding: 4,
        gap: 4,
      }}
    >
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => {
              tap();
              onChange(o.key);
            }}
            style={{
              flex: 1,
              paddingVertical: 9,
              borderRadius: colors.radius - 4,
              backgroundColor: active ? colors.card : "transparent",
              alignItems: "center",
            }}
          >
            <Text
              style={{
                fontFamily: active ? font.semibold : font.medium,
                fontSize: 13.5,
                color: active ? colors.foreground : colors.mutedForeground,
              }}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------- Field ----------------

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  maxLength,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
}) {
  const { colors, textAlign, writingDirection } = useUI();
  return (
    <View style={{ gap: 6 }}>
      <Text
        style={{
          fontFamily: font.medium,
          fontSize: 13,
          color: colors.mutedForeground,
          textAlign,
        }}
      >
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        maxLength={maxLength}
        placeholderTextColor={colors.mutedForeground}
        style={{
          backgroundColor: colors.card,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          borderRadius: colors.radius,
          paddingHorizontal: 14,
          paddingVertical: 12,
          fontFamily: font.medium,
          fontSize: 15,
          color: colors.foreground,
          textAlign,
          writingDirection,
        }}
      />
    </View>
  );
}

// ---------------- DateField (stepper) ----------------

export function DateField({
  label,
  value,
  onChange,
  formatDate,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  formatDate: (iso: string) => string;
}) {
  const { colors, row, textAlign } = useUI();
  return (
    <View style={{ gap: 6 }}>
      <Text
        style={{
          fontFamily: font.medium,
          fontSize: 13,
          color: colors.mutedForeground,
          textAlign,
        }}
      >
        {label}
      </Text>
      <View
        style={{
          flexDirection: row,
          alignItems: "center",
          backgroundColor: colors.card,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          borderRadius: colors.radius,
          paddingHorizontal: 8,
          paddingVertical: 6,
          justifyContent: "space-between",
        }}
      >
        <IconButton
          icon="chevron-left"
          onPress={() => onChange(shiftDate(value, -1))}
        />
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
          style={{
            flex: 1,
            textAlign: "center",
            marginHorizontal: 4,
            fontFamily: font.semibold,
            fontSize: 15,
            color: colors.foreground,
          }}
        >
          {formatDate(value)}
        </Text>
        <IconButton
          icon="chevron-right"
          onPress={() => onChange(shiftDate(value, 1))}
        />
      </View>
    </View>
  );
}

function shiftDate(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

// ---------------- Empty / Loading ----------------

export function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  hint?: string;
}) {
  const { colors } = useUI();
  return (
    <View style={{ alignItems: "center", paddingVertical: 48, gap: 10 }}>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: colors.muted,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Feather name={icon} size={28} color={colors.mutedForeground} />
      </View>
      <Text
        style={{
          fontFamily: font.semibold,
          fontSize: 16,
          color: colors.foreground,
        }}
      >
        {title}
      </Text>
      {hint ? (
        <Text
          style={{
            fontFamily: font.regular,
            fontSize: 13.5,
            color: colors.mutedForeground,
            textAlign: "center",
            paddingHorizontal: 24,
            lineHeight: 19,
          }}
        >
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export function Loading() {
  const { colors } = useUI();
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.background,
      }}
    >
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

export function SectionLabel({ text }: { text: string }) {
  const { colors, textAlign } = useUI();
  return (
    <Text
      style={{
        fontFamily: font.bold,
        fontSize: 13,
        letterSpacing: 0.5,
        textTransform: "uppercase",
        color: colors.mutedForeground,
        marginBottom: 10,
        marginTop: 4,
        textAlign,
      }}
    >
      {text}
    </Text>
  );
}
