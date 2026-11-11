// Small charts for the reports (phase 5), drawn with plain views: no chart library to
// load, they follow dark mode and big text, and VoiceOver reads each bar's value.
import { StyleSheet, View } from 'react-native';

import { T, usePalette } from '@/components/ui';
import { Brand, Space } from '@/constants/theme';

export const money = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;

// One bar per value; the highest is the signal colour. Labels under the bars
// (every other one if there are many).
export function BarChart({ values, labels, format = (n) => String(Math.round(n)), height = 120, title }: { values: (number | null)[]; labels: string[]; format?: (n: number) => string; height?: number; title: string }) {
  const c = usePalette();
  const max = Math.max(1, ...values.map((v) => v ?? 0));
  const top = values.indexOf(Math.max(...values.map((v) => v ?? -Infinity)));
  const every = values.length > 14 ? Math.ceil(values.length / 7) : 1;
  return (
    <View accessible accessibilityLabel={`${title}: ${values.map((v, i) => `${labels[i]} ${v === null ? 'no figures' : format(v)}`).join(', ')}`}>
      <View style={[styles.bars, { height }]}>
        {values.map((v, i) => (
          <View key={i} style={styles.col}>
            <View style={[styles.bar, { height: v ? Math.max(2, (v / max) * height) : 2, backgroundColor: v === null ? c.border : i === top ? Brand.signal : c.textSecondary, opacity: i === top || v === null ? 1 : 0.55 }]} />
          </View>
        ))}
      </View>
      <View style={styles.labels}>
        {labels.map((l, i) => (
          <T key={i} kind="small" quiet style={styles.label} numberOfLines={1} maxFontSizeMultiplier={1.2}>
            {i % every === 0 ? l : ''}
          </T>
        ))}
      </View>
    </View>
  );
}

// A figure with its change against the period before ("+12% vs last week").
export function Change({ now, before, format, against }: { now: number; before: number; format: (n: number) => string; against: string }) {
  const c = usePalette();
  const diff = now - before;
  const pct = before ? Math.round((diff / before) * 100) : null;
  const up = diff > 0;
  return (
    <T kind="small" style={{ color: diff === 0 ? c.textSecondary : up ? c.tint : Brand.ember }}>
      {diff === 0 ? `Same as ${against}` : `${up ? '▲' : '▼'} ${pct !== null ? `${Math.abs(pct)}%` : format(Math.abs(diff))} vs ${against}`}
    </T>
  );
}

const styles = StyleSheet.create({
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  col: { flex: 1, justifyContent: 'flex-end' },
  bar: { borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  labels: { flexDirection: 'row', gap: 3, marginTop: Space.xs },
  label: { flex: 1, textAlign: 'center', fontSize: 11 },
});
