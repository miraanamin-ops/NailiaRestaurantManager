// Today: the owner's day at a glance (a calm morning briefing). Yesterday's takings
// against the same day last week, what's waiting (urgent first) with one button to clear
// it, who's on today from the rota, and what DinerAI did for them since yesterday.
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar, Button, Card, Icon, IconTile, Pill, T, TabHeader, usePalette } from '@/components/ui';
import { MaxWidth, Space } from '@/constants/theme';
import { getToday, LoginNeeded, type Today as TodayData } from '@/lib/api';
import { titleIcon } from '@/lib/kinds';
import { alertsState, registerForAlerts, type AlertsState } from '@/lib/notifications';
import { useSession } from '@/lib/session';

function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function Today() {
  const c = usePalette();
  const { me, restaurantId, reloadMe, signOut } = useSession();
  const [data, setData] = useState<TodayData | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [alerts, setAlerts] = useState<AlertsState | null>(null);
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

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
  const restaurant = me?.restaurants.find((r) => r.id === restaurantId)?.name ?? data?.restaurant.name ?? null;
  const many = (me?.restaurants.length ?? 0) > 1;
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.background }]} edges={['top', 'left', 'right']}>
      <TabHeader restaurant={restaurant} onRestaurant={many ? () => router.navigate('/more') : undefined} />
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />} contentContainerStyle={styles.list}>
        <View style={styles.hello}>
          <View style={styles.helloTop}>
            <Pill label={data?.restaurant.paused ? 'Sending paused' : 'DinerAI is on'} tone={data?.restaurant.paused ? 'ember' : 'signal'} dot />
            <T kind="mono" quiet>
              {today}
            </T>
          </View>
          <T kind="title">
            {greeting()}
            {me?.firstName ? `, ${me.firstName}` : ''}
          </T>
        </View>

        {error && (
          <Card tone="amber">
            <T>Can’t reach DinerAI. Pull down to try again.</T>
          </Card>
        )}

        {alerts === 'ask' && (
          <Card>
            <View style={styles.row}>
              <IconTile name="notifications-outline" tone="signal" />
              <View style={{ flex: 1 }}>
                <T style={{ fontWeight: '600' }}>Turn on alerts</T>
                <T kind="small" quiet>
                  Your morning brief, and urgent things like a bad review, with Approve right on the notification.
                </T>
              </View>
            </View>
            <Button label="Turn on alerts" kind="plain" small onPress={async () => setAlerts(await registerForAlerts(true))} />
          </Card>
        )}
        {alerts === 'off' && (
          <Card>
            <T kind="small" quiet>
              Alerts are off for DinerAI. To get your brief and urgent alerts, turn them on in your phone’s Settings → DinerAI → Notifications.
            </T>
          </Card>
        )}

        {data && (
          <Card>
            <View style={styles.between}>
              <T kind="label" quiet>
                Yesterday’s takings
              </T>
              {data.takings?.change ? <Pill label={data.takings.change} tone={data.takings.change.startsWith('-') ? 'ember' : 'signal'} icon={data.takings.change.startsWith('-') ? 'trending-down' : 'trending-up'} /> : null}
            </View>
            {data.takings ? (
              <T kind="metric" accessibilityLabel={`Yesterday's takings ${data.takings.amount}`}>
                {data.takings.amount}
              </T>
            ) : (
              <>
                <T kind="metric" quiet>
                  £ –
                </T>
                <T kind="small" quiet>
                  No takings in for yesterday yet. Send a photo of your till report in Chat, or type what you took.
                </T>
                <Button label="Send it in Chat" kind="plain" small icon="camera-outline" onPress={() => router.navigate('/chat')} />
              </>
            )}
          </Card>
        )}

        {data && (
          <Card accent={data.waiting.count > 0}>
            <View style={styles.between}>
              <T kind="heading">Waiting for you</T>
              {data.waiting.count > 0 && <Pill label={`${data.waiting.count} to approve`} tone={data.waiting.next.some((n) => n.urgent) ? 'ember' : 'signal'} />}
            </View>
            {data.waiting.count > 0 ? (
              <>
                <T kind="small" quiet>
                  {data.waiting.line}
                </T>
                {data.waiting.next.map((n) => (
                  <Pressable
                    key={n.id}
                    onPress={() => router.navigate('/inbox')}
                    accessibilityRole="button"
                    accessibilityLabel={`${n.urgent ? 'Urgent: ' : ''}${n.title}`}
                    style={[styles.item, { borderColor: n.urgent ? c.ember : c.border, backgroundColor: n.urgent ? c.emberSoft : c.panel }]}>
                    <IconTile name={titleIcon(n.title)} tone={n.urgent ? 'ember' : 'neutral'} />
                    <T style={{ flex: 1 }} numberOfLines={2}>
                      {n.title}
                    </T>
                    {n.urgent && <Pill label="Urgent" tone="ember" />}
                  </Pressable>
                ))}
                <Button label={`Review now (${data.waiting.count})`} icon="arrow-forward" onPress={() => router.navigate('/inbox')} />
              </>
            ) : (
              <View style={styles.row}>
                <Icon name="checkmark-circle" color={c.tint} />
                <T>Nothing waiting. All done for now.</T>
              </View>
            )}
          </Card>
        )}

        {data?.rota && (
          <Card>
            <View style={styles.between}>
              <View style={{ flex: 1 }}>
                <T kind="heading">Who’s on today</T>
                {data.rota.suggested && (
                  <T kind="small" quiet>
                    Suggested, not approved yet
                  </T>
                )}
              </View>
              <Button label="Week" kind="plain" small icon="arrow-forward" onPress={() => router.navigate({ pathname: '/reports', params: { view: 'rota' } })} />
            </View>
            {data.rota.closed ? (
              <T quiet>You’re closed today.</T>
            ) : data.rota.shifts.length ? (
              data.rota.shifts.map((s, i) => (
                <View key={i} style={[styles.item, { borderColor: s.name ? c.border : c.ember, backgroundColor: s.name ? c.panel : c.emberSoft }]}>
                  <Avatar name={s.name} tone={s.name ? 'neutral' : 'ember'} />
                  <View style={{ flex: 1 }}>
                    <T style={[{ fontWeight: '600' }, !s.name && { color: c.ember }]}>{s.name ?? 'Nobody yet'}</T>
                    <T kind="mono" quiet>
                      {s.role} · {s.time}
                    </T>
                  </View>
                  {!s.name && <Pill label="Unfilled" tone="ember" />}
                </View>
              ))
            ) : (
              <T quiet>Nobody on the rota today.</T>
            )}
          </Card>
        )}

        {data && done.length > 0 && (
          <Card>
            <View style={styles.between}>
              <T kind="label" quiet>
                Done for you
              </T>
              <T kind="mono" quiet>
                {done.length} since yesterday
              </T>
            </View>
            {done.map((d) => (
              <View key={d} style={styles.row}>
                <Icon name="checkmark-circle-outline" size={18} color={c.tint} />
                <T kind="small" style={{ flex: 1 }}>
                  {d.charAt(0).toUpperCase() + d.slice(1)}
                </T>
              </View>
            ))}
          </Card>
        )}

        {!data && !error && (
          <Card>
            <T quiet>Loading your day…</T>
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { gap: Space.m, padding: Space.m, paddingTop: Space.xs, paddingBottom: Space.xl * 2, width: '100%', maxWidth: MaxWidth, alignSelf: 'center' },
  hello: { gap: Space.s, marginBottom: Space.xs },
  helloTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.s },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.s },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.s + 2 },
  item: { flexDirection: 'row', alignItems: 'center', gap: Space.m - 4, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: Space.s + 4 },
});
