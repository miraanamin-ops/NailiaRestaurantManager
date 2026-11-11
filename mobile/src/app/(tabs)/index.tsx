// Today (phase 1): the owner's day at a glance. Yesterday's takings against the
// same day last week, what's waiting (urgent first) with one button to clear
// it, and what DinerAI did for them since yesterday.
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { Button, Card, Screen, T } from '@/components/ui';
import { Brand, Space } from '@/constants/theme';
import { getToday, LoginNeeded, type Today as TodayData } from '@/lib/api';
import { alertsState, registerForAlerts, type AlertsState } from '@/lib/notifications';
import { useSession } from '@/lib/session';

function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function Today() {
  const { me, restaurantId, reloadMe, signOut } = useSession();
  const [data, setData] = useState<TodayData | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [alerts, setAlerts] = useState<AlertsState | null>(null);
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  const load = useCallback(async () => {
    if (!restaurantId) return;
    try {
      setError(false);
      setData(await getToday(restaurantId));
      setAlerts(await alertsState());
    } catch (err) {
      if (err instanceof LoginNeeded) return signOut();
      setError(true);
    }
  }, [restaurantId, signOut]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function refresh() {
    setRefreshing(true);
    await Promise.all([reloadMe(), load()]);
    setRefreshing(false);
  }

  const done = data?.done ?? [];
  return (
    <Screen scroll={false}>
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />} contentContainerStyle={styles.list}>
        <View>
          <T kind="title">
            {greeting()}
            {me?.firstName ? `, ${me.firstName}` : ''}
          </T>
          <T quiet>
            {today}
            {data ? ` · ${data.restaurant.name}` : ''}
          </T>
        </View>

        {error && (
          <Card>
            <T>Can’t reach DinerAI. Pull down to try again.</T>
          </Card>
        )}

        {alerts === 'ask' && (
          <Card accent>
            <T kind="heading">Turn on alerts</T>
            <T quiet>Get your morning brief and urgent alerts (like a bad review) as notifications, with Approve right on them.</T>
            <Button label="Turn on alerts" onPress={async () => setAlerts(await registerForAlerts(true))} />
          </Card>
        )}
        {alerts === 'off' && (
          <Card>
            <T quiet>Alerts are off for DinerAI. To get your brief and urgent alerts, turn them on in your phone’s Settings → DinerAI → Notifications.</T>
          </Card>
        )}

        {data?.restaurant.paused && (
          <Card>
            <T style={{ color: Brand.ember }}>Sending is paused. Nothing goes to customers or Google until you resume.</T>
          </Card>
        )}

        {data && (
          <Card>
            <T kind="label" quiet>
              Yesterday’s takings
            </T>
            {data.takings ? (
              <>
                <T kind="title">{data.takings.amount}</T>
                {data.takings.change && <T quiet>{data.takings.change}</T>}
              </>
            ) : (
              <T quiet>No takings recorded for yesterday yet. Send your till report in Chat (coming soon) or on WhatsApp.</T>
            )}
          </Card>
        )}

        {data && (
          <Card accent={data.waiting.count > 0}>
            <T kind="label" quiet>
              Waiting for you
            </T>
            {data.waiting.count > 0 ? (
              <>
                <T kind="heading">{data.waiting.count} to approve</T>
                <T quiet>{data.waiting.line}</T>
                {data.waiting.next.map((n) => (
                  <T key={n.id} kind="small" style={n.urgent ? { color: Brand.ember } : undefined}>
                    {n.urgent ? '● ' : '· '}
                    {n.title}
                  </T>
                ))}
                <Button label="Review now" onPress={() => router.navigate('/inbox')} />
              </>
            ) : (
              <T>Nothing waiting. All done for now ✓</T>
            )}
          </Card>
        )}

        {data && done.length > 0 && (
          <Card>
            <T kind="label" quiet>
              Done for you since yesterday
            </T>
            {done.map((d) => (
              <T key={d} kind="small">
                ✓ {d.charAt(0).toUpperCase() + d.slice(1)}
              </T>
            ))}
          </Card>
        )}

        {!data && !error && (
          <Card>
            <T quiet>Loading your day…</T>
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: Space.m, paddingBottom: Space.xl },
});
