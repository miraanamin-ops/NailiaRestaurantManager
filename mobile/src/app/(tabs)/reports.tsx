// Reports (phase 5): the weekly report (every Monday) and the monthly report (early
// each month), newest first. Tap one for its charts, the next 3 actions and the PDF.
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, T, usePalette } from '@/components/ui';
import { MaxWidth, Space } from '@/constants/theme';
import { getReports, LoginNeeded, type ReportItem } from '@/lib/api';
import { useSession } from '@/lib/session';

export default function Reports() {
  const c = usePalette();
  const { restaurantId, signOut } = useSession();
  const [reports, setReports] = useState<ReportItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      setReports((await getReports(restaurantId)).reports);
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

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.background }]} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.list}
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
        {error && (
          <Card>
            <T>{error}</T>
          </Card>
        )}
        {!reports && !error && <ActivityIndicator />}
        {reports && reports.length === 0 && (
          <Card>
            <T kind="heading">No reports yet</T>
            <T quiet>Your first weekly report arrives on Monday morning, and a monthly one early each month once your sales are in.</T>
          </Card>
        )}
        {reports?.map((r) => (
          <Pressable
            key={r.token}
            onPress={() => router.push({ pathname: '/report/[token]', params: { token: r.token } })}
            accessibilityRole="button"
            accessibilityLabel={`${r.kind === 'monthly' ? 'Monthly' : 'Weekly'} report, ${r.label}`}
            style={({ pressed }) => [styles.row, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.8 : 1 }]}>
            <View style={{ flex: 1 }}>
              <T kind="label" quiet>
                {r.kind === 'monthly' ? 'Monthly report' : 'Weekly report'}
              </T>
              <T style={{ fontWeight: '600' }}>{r.label}</T>
            </View>
            <T quiet>›</T>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { padding: Space.m, gap: Space.s, width: '100%', maxWidth: MaxWidth, alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: Space.m, gap: Space.s },
});
