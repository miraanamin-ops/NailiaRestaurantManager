// Reports (phase 5, plus the rota): three sections, chosen at the top.
//   Weekly   the Monday report, newest first
//   Monthly  the report early each month
//   Rota     this week's and next week's rota (who works when, cost, approved or waiting)
// Tap a report for its charts, the next 3 actions and the PDF.
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RotaWeek } from '@/components/rota-week';
import { Card, Icon, IconTile, T, TabHeader, usePalette, useTabBarSpace } from '@/components/ui';
import { Brand, MaxWidth, Space } from '@/constants/theme';
import { getReports, getRota, LoginNeeded, type AppRotaWeek, type ReportItem } from '@/lib/api';
import { useSession } from '@/lib/session';

type View3 = 'weekly' | 'monthly' | 'rota';
const VIEWS: { key: View3; label: string }[] = [
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'rota', label: 'Rota' },
];

export default function Reports() {
  const c = usePalette();
  const tabSpace = useTabBarSpace();
  const { me, restaurantId, signOut } = useSession();
  // "See the week's rota" on Today opens this with view=rota.
  const params = useLocalSearchParams<{ view?: string }>();
  const [picked, setPicked] = useState<View3 | null>(null);
  const asked: View3 | null = params.view === 'rota' || params.view === 'monthly' || params.view === 'weekly' ? params.view : null;
  const view: View3 = asked ?? picked ?? 'weekly';
  const [reports, setReports] = useState<ReportItem[] | null>(null);
  const [rota, setRota] = useState<{ today: string; thisWeek: AppRotaWeek; nextWeek: AppRotaWeek } | null>(null);
  const [whichWeek, setWhichWeek] = useState<'this' | 'next'>('this');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [r, w] = await Promise.all([getReports(restaurantId), getRota(restaurantId)]);
      setReports(r.reports);
      setRota(w);
    } catch (err) {
      if (err instanceof LoginNeeded) return signOut();
      setError("Can't reach DinerAI. Pull down to try again.");
    }
  }, [restaurantId, signOut]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const choose = (v: View3) => {
    setPicked(v);
    if (params.view) router.setParams({ view: undefined });
  };
  const shown = (reports ?? []).filter((r) => r.kind === view);

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.background }]} edges={['top', 'left', 'right']}>
      <TabHeader restaurant={me?.restaurants.find((r) => r.id === restaurantId)?.name ?? null} onRestaurant={(me?.restaurants.length ?? 0) > 1 ? () => router.navigate('/more') : undefined} />
      <ScrollView
        contentContainerStyle={[styles.list, { paddingBottom: tabSpace }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }>
        <T kind="title">Reports</T>
        <Segments value={view} onChange={choose} options={VIEWS} />
        {error && (
          <Card>
            <T>{error}</T>
          </Card>
        )}
        {!reports && !error && <ActivityIndicator />}

        {view === 'rota' && rota && (
          <>
            <Segments
              value={whichWeek}
              onChange={setWhichWeek}
              options={[
                { key: 'this', label: `This week` },
                { key: 'next', label: `Next week` },
              ]}
              small
            />
            <RotaWeek key={whichWeek} week={whichWeek === 'this' ? rota.thisWeek : rota.nextWeek} next={whichWeek === 'next'} today={rota.today} />
          </>
        )}

        {view !== 'rota' && reports && shown.length === 0 && (
          <Card>
            <T kind="heading">No {view} reports yet</T>
            <T quiet>{view === 'weekly' ? 'Your first weekly report arrives on Monday morning.' : 'Your monthly report arrives early each month, once your sales are in.'}</T>
          </Card>
        )}
        {view !== 'rota' &&
          shown.map((r) => (
            <Pressable
              key={r.token}
              onPress={() => router.push({ pathname: '/report/[token]', params: { token: r.token } })}
              accessibilityRole="button"
              accessibilityLabel={`${r.kind === 'monthly' ? 'Monthly' : 'Weekly'} report, ${r.label}`}
              style={({ pressed }) => [styles.row, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.8 : 1 }]}>
              <IconTile name={r.kind === 'monthly' ? 'calendar-outline' : 'bar-chart-outline'} tone="signal" />
              <View style={{ flex: 1 }}>
                <T kind="label" quiet>
                  {r.kind === 'monthly' ? 'Monthly report' : 'Weekly report'}
                </T>
                <T style={{ fontWeight: '600' }}>{r.label}</T>
              </View>
              <Icon name="chevron-forward" size={18} color={c.textSecondary} />
            </Pressable>
          ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function Segments<K extends string>({ value, onChange, options, small }: { value: K; onChange: (k: K) => void; options: { key: K; label: string }[]; small?: boolean }) {
  const c = usePalette();
  return (
    <View style={[styles.segments, { backgroundColor: c.card, borderColor: c.border }]} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={[styles.segment, small && styles.segmentSmall, on && { backgroundColor: Brand.signal }]}>
            <T kind="small" style={{ fontWeight: '600', color: on ? Brand.onSignal : c.text }} maxFontSizeMultiplier={1.5}>
              {o.label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { padding: Space.m, paddingTop: Space.xs, paddingBottom: Space.xl * 2, gap: Space.s + 2, width: '100%', maxWidth: MaxWidth, alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, padding: Space.m - 2, gap: Space.m - 4 },
  segments: { flexDirection: 'row', borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, padding: 3 },
  segment: { flex: 1, minHeight: 40, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  segmentSmall: { minHeight: 34 },
});
