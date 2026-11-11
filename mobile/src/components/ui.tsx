// The app's few building blocks, so every screen looks the same: a screen with
// safe-area spacing and a centred column on tablets, cards, text styles and
// thumb-sized buttons. Colours come from the phone's light or dark setting.
import type { PropsWithChildren, ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, useColorScheme, View, type TextProps, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Brand, Colors, MaxWidth, Space, TapHeight, type Palette } from '@/constants/theme';

export function usePalette(): Palette {
  return Colors[useColorScheme() === 'dark' ? 'dark' : 'light'];
}

export function Screen({ children, scroll = true }: PropsWithChildren<{ scroll?: boolean }>) {
  const c = usePalette();
  const inner = <View style={styles.column}>{children}</View>;
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.background }]} edges={['top', 'left', 'right']}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {inner}
        </ScrollView>
      ) : (
        <View style={[styles.fill, styles.scroll]}>{inner}</View>
      )}
    </SafeAreaView>
  );
}

export function Card({ children, accent = false, style }: PropsWithChildren<{ accent?: boolean; style?: ViewStyle }>) {
  const c = usePalette();
  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: accent ? c.tint : c.border, borderWidth: accent ? 2 : StyleSheet.hairlineWidth }, style]}>
      {children}
    </View>
  );
}

type Kind = 'title' | 'heading' | 'body' | 'small' | 'label';
export function T({ kind = 'body', quiet = false, style, ...rest }: TextProps & { kind?: Kind; quiet?: boolean }) {
  const c = usePalette();
  return <Text maxFontSizeMultiplier={2} style={[text[kind], { color: quiet ? c.textSecondary : c.text }, style]} {...rest} />;
}

export function Button({
  label,
  onPress,
  kind = 'main',
  busy = false,
  disabled = false,
  icon,
}: {
  label: string;
  onPress: () => void;
  kind?: 'main' | 'plain' | 'danger';
  busy?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
}) {
  const c = usePalette();
  const main = kind === 'main';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || busy, busy }}
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: main ? Brand.signal : 'transparent', borderColor: main ? Brand.signal : c.border, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
      ]}>
      {busy ? (
        <ActivityIndicator color={main ? Brand.onSignal : c.text} />
      ) : (
        <View style={styles.buttonRow}>
          {icon}
          <Text maxFontSizeMultiplier={1.6} style={[text.button, { color: main ? Brand.onSignal : kind === 'danger' ? c.danger : c.text }]}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scroll: { paddingHorizontal: Space.m, paddingTop: Space.m, paddingBottom: Space.xl * 2 },
  column: { width: '100%', maxWidth: MaxWidth, alignSelf: 'center', gap: Space.m },
  card: { borderRadius: 16, padding: Space.m, gap: Space.s },
  button: { minHeight: TapHeight, borderRadius: 999, borderWidth: 1, paddingHorizontal: Space.l, alignItems: 'center', justifyContent: 'center' },
  buttonRow: { flexDirection: 'row', alignItems: 'center', gap: Space.s },
});

const text = StyleSheet.create({
  title: { fontSize: 30, lineHeight: 36, fontWeight: '700', letterSpacing: -0.5 },
  heading: { fontSize: 20, lineHeight: 26, fontWeight: '600' },
  body: { fontSize: 17, lineHeight: 24 },
  small: { fontSize: 15, lineHeight: 21 },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6 },
  button: { fontSize: 17, fontWeight: '600' },
});
