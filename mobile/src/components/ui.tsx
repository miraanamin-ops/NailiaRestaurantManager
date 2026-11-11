// The app's building blocks, so every screen looks the same (the visual pass, from the
// Stitch designs): screens with safe-area spacing and a centred column on tablets, cards,
// text styles (Geist, and Geist Mono for numbers and labels), buttons, pills, initials,
// section titles, the logo and the header. Colours follow the phone's light or dark setting.
import * as Haptics from 'expo-haptics';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, type ComponentProps, type PropsWithChildren, type ReactNode } from 'react';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, useColorScheme, View, type StyleProp, type TextProps, type TextStyle, type ViewStyle } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Brand, Colors, Fonts, MaxWidth, Radius, Space, TapHeight, type Palette } from '@/constants/theme';

export function usePalette(): Palette {
  return Colors[useColorScheme() === 'dark' ? 'dark' : 'light'];
}

// The room a scrolling tab screen leaves at the bottom so nothing ends under the floating
// tab bar (on iPhone it floats over the content; Android's sits below it).
export function useTabBarSpace() {
  const insets = useSafeAreaInsets();
  return Platform.OS === 'ios' ? insets.bottom + 84 : Space.xl;
}

// A screen. kind:
//   tab     one of the five tabs: room above the floating tab bar at the bottom
//   pushed  opened from a tab with a native header and back button (Customers, a report):
//           it starts below that header (iOS adjusts for it), never underneath it
//   plain   no tab bar and no header (login, sign-up): extra room at the top
export function Screen({ children, scroll = true, header, kind = 'plain' }: PropsWithChildren<{ scroll?: boolean; header?: ReactNode; kind?: 'tab' | 'pushed' | 'plain' }>) {
  const c = usePalette();
  const tabSpace = useTabBarSpace();
  const inner = <View style={styles.column}>{children}</View>;
  const bottom = { paddingBottom: kind === 'tab' ? tabSpace : Space.xl * 2 };
  const top = kind === 'plain' ? { paddingTop: Space.l } : kind === 'pushed' ? { paddingTop: Space.m } : null;
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.background }]} edges={kind === 'pushed' ? ['left', 'right'] : ['top', 'left', 'right']}>
      {header}
      {scroll ? (
        <ScrollView contentContainerStyle={[styles.scroll, top, bottom]} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior={kind === 'pushed' ? 'automatic' : 'never'}>
          {inner}
        </ScrollView>
      ) : (
        <View style={[styles.fill, styles.scroll, top, bottom]}>{inner}</View>
      )}
    </SafeAreaView>
  );
}

export function Card({ children, accent = false, tone, style }: PropsWithChildren<{ accent?: boolean; tone?: 'ember' | 'amber' | 'signal'; style?: StyleProp<ViewStyle> }>) {
  const c = usePalette();
  const edge = tone === 'ember' ? c.ember : tone === 'amber' ? c.amber : accent || tone === 'signal' ? c.tint : null;
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: tone === 'ember' ? c.emberSoft : c.card, borderColor: edge ?? c.border, borderWidth: edge ? 1 : StyleSheet.hairlineWidth },
        style,
      ]}>
      {children}
    </View>
  );
}

// A box inside a card (a quote, a breakdown of figures).
export function Panel({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const c = usePalette();
  return <View style={[styles.panel, { backgroundColor: c.panel, borderColor: c.border }, style]}>{children}</View>;
}

type Kind = 'title' | 'heading' | 'body' | 'small' | 'label' | 'metric' | 'mono' | 'caption';
const FAMILY: Record<Kind, string> = {
  title: Fonts.semibold,
  heading: Fonts.semibold,
  body: Fonts.regular,
  small: Fonts.regular,
  label: Fonts.mono,
  metric: Fonts.monoBold,
  mono: Fonts.mono,
  caption: Fonts.regular,
};
const MONO = new Set<Kind>(['label', 'metric', 'mono']);

// Which Geist file a weight means (Android can't fake a weight with a custom font, so a
// fontWeight in a style is turned into a family here).
function familyFor(kind: Kind, weight: string | null) {
  if (!weight) return FAMILY[kind];
  const w = weight === 'bold' ? 700 : Number(weight) || 400;
  if (MONO.has(kind)) return w >= 600 ? Fonts.monoBold : Fonts.mono;
  return w >= 700 ? Fonts.bold : w >= 600 ? Fonts.semibold : w >= 500 ? Fonts.medium : Fonts.regular;
}

export function T({ kind = 'body', quiet = false, style, ...rest }: TextProps & { kind?: Kind; quiet?: boolean }) {
  const c = usePalette();
  const flat = { ...((StyleSheet.flatten(style) ?? {}) as TextStyle) };
  const family = familyFor(kind, flat.fontWeight ? String(flat.fontWeight) : null);
  delete flat.fontWeight;
  return <Text maxFontSizeMultiplier={kind === 'metric' || kind === 'title' ? 1.6 : 2} style={[text[kind], { color: quiet ? c.textSecondary : c.text, fontFamily: family }, flat]} {...rest} />;
}

export type IconName = ComponentProps<typeof Ionicons>['name'];
export function Icon({ name, size = 20, color, style }: { name: IconName; size?: number; color?: string; style?: StyleProp<TextStyle> }) {
  const c = usePalette();
  return <Ionicons name={name} size={size} color={color ?? c.text} style={style} accessibilityElementsHidden importantForAccessibility="no" />;
}

export function Button({
  label,
  onPress,
  kind = 'main',
  busy = false,
  disabled = false,
  icon,
  small = false,
}: {
  label: string;
  onPress: () => void;
  kind?: 'main' | 'plain' | 'danger' | 'quiet';
  busy?: boolean;
  disabled?: boolean;
  icon?: IconName;
  small?: boolean;
}) {
  const c = usePalette();
  const main = kind === 'main';
  const ink = main ? Brand.onSignal : kind === 'danger' ? c.danger : c.text;
  const bg = main ? Brand.signal : kind === 'plain' ? c.card : 'transparent';
  const border = main ? Brand.signal : kind === 'quiet' ? 'transparent' : kind === 'danger' ? c.danger : c.border;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || busy, busy }}
      onPress={onPress}
      // A light tap you can feel as the button goes down, and it gives a little.
      onPressIn={() => Haptics.selectionAsync().catch(() => {})}
      disabled={disabled || busy}
      style={({ pressed }) => [styles.button, small && styles.buttonSmall, { backgroundColor: bg, borderColor: border, opacity: disabled ? 0.45 : pressed ? 0.88 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
      {busy ? (
        <ActivityIndicator color={ink} />
      ) : (
        <View style={styles.buttonRow}>
          {icon ? <Icon name={icon} size={small ? 16 : 18} color={ink} /> : null}
          <Text maxFontSizeMultiplier={1.6} style={[text.button, small && text.buttonSmall, { color: ink, fontFamily: main ? Fonts.monoBold : Fonts.semibold }]}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

// A small status label: "3 to approve", "Confirmed", "Urgent".
export function Pill({ label, tone = 'neutral', icon, dot }: { label: string; tone?: 'neutral' | 'signal' | 'ember' | 'amber' | 'solid'; icon?: IconName; dot?: boolean }) {
  const c = usePalette();
  const fg = tone === 'signal' ? c.tint : tone === 'ember' ? c.ember : tone === 'amber' ? c.amber : tone === 'solid' ? Brand.onSignal : c.textSecondary;
  const bg = tone === 'signal' ? c.signalSoft : tone === 'ember' ? c.emberSoft : tone === 'amber' ? c.amberSoft : tone === 'solid' ? Brand.signal : c.panel;
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      {dot && <View style={[styles.dot, { backgroundColor: fg }]} />}
      {icon && <Icon name={icon} size={12} color={fg} />}
      <Text maxFontSizeMultiplier={1.5} style={[text.pill, { color: fg, fontFamily: Fonts.mono }]}>
        {label}
      </Text>
    </View>
  );
}

// A person's initials in a circle ("AM" for Ali M.); an empty-chair icon for an open shift.
export function Avatar({ name, tone = 'neutral', size = 40 }: { name: string | null; tone?: 'neutral' | 'ember'; size?: number }) {
  const c = usePalette();
  const initials = (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: tone === 'ember' ? c.emberSoft : c.panel, borderColor: c.border }]}>
      {initials ? (
        <Text style={{ fontFamily: Fonts.monoBold, fontSize: size * 0.34, color: c.text }} maxFontSizeMultiplier={1.2}>
          {initials}
        </Text>
      ) : (
        <Icon name="person-remove-outline" size={size * 0.45} color={c.ember} />
      )}
    </View>
  );
}

// A section's title with a coloured dot: "Urgent", "Needs a look", "Simple".
export function SectionTitle({ title, tone, aside }: { title: string; tone?: 'signal' | 'ember' | 'amber'; aside?: ReactNode }) {
  const c = usePalette();
  return (
    <View style={styles.sectionTitle}>
      {tone && <View style={[styles.dot, styles.dotBig, { backgroundColor: tone === 'signal' ? c.tint : tone === 'ember' ? c.ember : c.amber }]} />}
      <T kind="heading" style={{ flex: 1 }}>
        {title}
      </T>
      {aside}
    </View>
  );
}

// The DinerAI wordmark: a chartreuse dot and the name.
export function Logo({ size = 22 }: { size?: number }) {
  const c = usePalette();
  return (
    <View style={styles.logo} accessibilityRole="header" accessibilityLabel="DinerAI">
      <View style={{ width: size * 0.42, height: size * 0.42, borderRadius: size, backgroundColor: c.tint }} />
      <Text style={{ fontFamily: Fonts.bold, fontSize: size, letterSpacing: -0.6, color: c.text }} maxFontSizeMultiplier={1.3}>
        DinerAI
      </Text>
    </View>
  );
}

// A tab's top line: the logo, the restaurant (a tap opens More, where the builder switches), and an action.
export function TabHeader({ restaurant, onRestaurant, right }: { restaurant?: string | null; onRestaurant?: () => void; right?: ReactNode }) {
  const c = usePalette();
  return (
    <View style={styles.header}>
      <Logo size={20} />
      {restaurant ? (
        <Pressable
          onPress={onRestaurant}
          disabled={!onRestaurant}
          accessibilityRole="button"
          accessibilityLabel={`Restaurant: ${restaurant}`}
          style={[styles.chip, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text numberOfLines={1} style={{ fontFamily: Fonts.medium, fontSize: 14, color: c.text, flexShrink: 1 }} maxFontSizeMultiplier={1.3}>
            {restaurant}
          </Text>
          {onRestaurant && <Icon name="chevron-down" size={14} color={c.textSecondary} />}
        </Pressable>
      ) : (
        <View style={{ flex: 1 }} />
      )}
      {right}
    </View>
  );
}

// A row in a list: a leading icon or avatar, a title and a line under it, and something on the right.
export function ListRow({ title, sub, lead, right, onPress, last }: { title: string; sub?: string | null; lead?: ReactNode; right?: ReactNode; onPress?: () => void; last?: boolean }) {
  const c = usePalette();
  const body = (
    <View style={[styles.listRow, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.border }]}>
      {lead}
      <View style={{ flex: 1, gap: 2 }}>
        <T style={{ fontWeight: '600' }}>{title}</T>
        {sub ? (
          <T kind="small" quiet>
            {sub}
          </T>
        ) : null}
      </View>
      {right ?? (onPress ? <Icon name="chevron-forward" size={18} color={c.textSecondary} /> : null)}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title} accessibilityHint={sub ?? undefined} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
      {body}
    </Pressable>
  );
}

// An icon in a soft rounded square, leading a row ("mail-outline" for an email offer).
export function IconTile({ name, tone = 'neutral' }: { name: IconName; tone?: 'neutral' | 'signal' | 'ember' | 'amber' }) {
  const c = usePalette();
  const fg = tone === 'signal' ? c.tint : tone === 'ember' ? c.ember : tone === 'amber' ? c.amber : c.text;
  const bg = tone === 'signal' ? c.signalSoft : tone === 'ember' ? c.emberSoft : tone === 'amber' ? c.amberSoft : c.panel;
  return (
    <View style={[styles.iconTile, { backgroundColor: bg }]}>
      <Icon name={name} size={20} color={fg} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scroll: { paddingHorizontal: Space.m, paddingTop: Space.s, paddingBottom: Space.xl * 2 },
  column: { width: '100%', maxWidth: MaxWidth, alignSelf: 'center', gap: Space.m },
  card: { borderRadius: Radius.card, padding: Space.m + 2, gap: Space.s + 2 },
  panel: { borderRadius: Radius.inner, borderWidth: StyleSheet.hairlineWidth, padding: Space.m - 2, gap: Space.s },
  button: { minHeight: TapHeight, borderRadius: Radius.pill, borderWidth: 1, paddingHorizontal: Space.l, alignItems: 'center', justifyContent: 'center' },
  buttonSmall: { minHeight: 40, paddingHorizontal: Space.m },
  buttonRow: { flexDirection: 'row', alignItems: 'center', gap: Space.s },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  dotBig: { width: 8, height: 8, borderRadius: 4 },
  avatar: { alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', gap: Space.s, marginTop: Space.s },
  logo: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Space.s + 2, paddingHorizontal: Space.m, paddingVertical: Space.s + 2, width: '100%', maxWidth: MaxWidth, alignSelf: 'center' },
  chip: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: StyleSheet.hairlineWidth, borderRadius: Radius.pill, paddingHorizontal: 14, minHeight: 40 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: Space.m - 4, paddingVertical: Space.s + 4, minHeight: 56 },
  iconTile: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});

const text = StyleSheet.create({
  title: { fontSize: 32, lineHeight: 38, letterSpacing: -0.8 },
  heading: { fontSize: 20, lineHeight: 26, letterSpacing: -0.3 },
  body: { fontSize: 17, lineHeight: 24, letterSpacing: -0.1 },
  small: { fontSize: 15, lineHeight: 21 },
  caption: { fontSize: 13, lineHeight: 18 },
  label: { fontSize: 11, lineHeight: 15, textTransform: 'uppercase', letterSpacing: 1.3 },
  metric: { fontSize: 44, lineHeight: 50, letterSpacing: -1.5 },
  mono: { fontSize: 14, lineHeight: 19 },
  button: { fontSize: 17 },
  buttonSmall: { fontSize: 15 },
  pill: { fontSize: 12, lineHeight: 16 },
});

// Grey blocks that gently pulse where content is about to appear (instead of a spinner).
export function Skeleton({ lines = 3, height = 96 }: { lines?: number; height?: number }) {
  const c = usePalette();
  const pulse = useSharedValue(0.5);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 750 }), -1, true);
  }, [pulse]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return (
    <View style={{ gap: Space.m }} accessibilityLabel="Loading" accessible>
      {Array.from({ length: lines }, (_, i) => (
        <Animated.View key={i} style={[{ height: i === 0 ? height * 0.6 : height, borderRadius: Radius.card, backgroundColor: c.card, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border }, style]} />
      ))}
    </View>
  );
}
