// More: the owner's hub for everything that isn't a daily task. Customers, settings,
// recommending a restaurant, help, pausing all sending, the restaurant switcher (the
// builder), the subscription, logging out and deleting the account.
import Constants from 'expo-constants';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Linking, Platform, ScrollView, Share, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar, Button, Card, Icon, IconTile, ListRow, Pill, T, TabHeader, usePalette, useTabBarSpace } from '@/components/ui';
import { Brand, MaxWidth, Space } from '@/constants/theme';
import { getReferral, getSettings, setPaused } from '@/lib/api';
import { useSession } from '@/lib/session';

export default function More() {
  const c = usePalette();
  const tabSpace = useTabBarSpace();
  const { me, signOut, restaurantId, setRestaurantId } = useSession();
  const restaurant = me?.restaurants.find((r) => r.id === restaurantId);
  const billing = restaurant?.billing;
  const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) : null);
  const [paused, setPausedState] = useState<boolean | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getSettings(restaurantId)
        .then((s) => setPausedState(s.paused))
        .catch(() => {});
    }, [restaurantId]),
  );

  function togglePause(next: boolean) {
    const go = async () => {
      setPausedState(next);
      try {
        const out = await setPaused(restaurantId, next);
        setNote(out.paused ? 'Paused. Nothing goes out until you turn sending back on; approved drafts are held.' : out.released ? `Sending is back on. ${out.released} held ${out.released === 1 ? 'message' : 'messages'} went out.` : 'Sending is back on.');
      } catch {
        setPausedState(!next);
        setNote('That didn’t go through. Please try again.');
      }
    };
    if (!next) return go();
    Alert.alert('Pause all sending?', 'No emails, Google replies or posts go out until you turn it back on. Nothing is lost.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Pause', style: 'destructive', onPress: go },
    ]);
  }

  async function recommend() {
    try {
      const { code, link } = await getReferral(restaurantId);
      // No website link on iPhone (Apple's rule against pointing to payment elsewhere): the code is enough.
      const message =
        Platform.OS === 'ios'
          ? `I use DinerAI to run my restaurant's reviews, Google and offers. Get the DinerAI app and use my code ${code} when you sign up.`
          : `I use DinerAI to run my restaurant's reviews, Google and offers. Sign up with my code ${code}: ${link}`;
      await Share.share({ message });
    } catch {
      setNote('Couldn’t get your code just now. Please try again.');
    }
  }

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.background }]} edges={['top', 'left', 'right']}>
      <TabHeader restaurant={restaurant?.name ?? null} />
      <ScrollView contentContainerStyle={[styles.list, { paddingBottom: tabSpace }]}>
        <T kind="title">More</T>

        <Card>
          <View style={styles.row}>
            <Avatar name={me?.firstName ?? me?.email ?? null} size={46} />
            <View style={{ flex: 1 }}>
              <T style={{ fontWeight: '600' }} numberOfLines={1}>
                {restaurant?.name ?? '…'}
              </T>
              <T kind="small" quiet numberOfLines={1}>
                {me?.email ?? ''}
              </T>
            </View>
            {restaurant && !restaurant.active && <Pill label="Not running yet" tone="amber" />}
          </View>
        </Card>

        {me && me.restaurants.length > 1 && (
          <Card>
            <T kind="label" quiet>
              Restaurant shown
            </T>
            {me.restaurants.map((r, i) => (
              <ListRow
                key={r.id}
                title={r.name}
                sub={r.active ? null : 'Not running'}
                last={i === me.restaurants.length - 1}
                onPress={() => setRestaurantId(r.id)}
                right={r.id === restaurantId ? <Icon name="checkmark-circle" color={c.tint} /> : <View />}
              />
            ))}
          </Card>
        )}

        <Card>
          <ListRow title="Customers" sub="Your list, QR codes, import and export" lead={<IconTile name="people-outline" />} onPress={() => router.push('/customers')} />
          <ListRow title="Settings" sub="Hours, offers, how replies sound, timing, alerts" lead={<IconTile name="options-outline" />} onPress={() => router.push('/settings')} />
          <ListRow title="Recommend a restaurant" sub="A free month for each one that joins" lead={<IconTile name="gift-outline" tone="signal" />} onPress={recommend} />
          <ListRow title="Help" sub="How everything works, and talk to a person" lead={<IconTile name="help-buoy-outline" />} onPress={() => router.push('/help')} last />
        </Card>

        <Card tone={paused ? 'ember' : undefined}>
          <View style={styles.row}>
            <IconTile name={paused ? 'pause-circle-outline' : 'paper-plane-outline'} tone={paused ? 'ember' : 'signal'} />
            <View style={{ flex: 1 }}>
              <T style={{ fontWeight: '600' }}>{paused ? 'Sending is paused' : 'Sending is on'}</T>
              <T kind="small" quiet>
                {paused ? 'Nothing goes to customers or Google until you turn it back on.' : 'Switch off to pause everything at once.'}
              </T>
            </View>
            <Switch value={paused === false} disabled={paused === null} onValueChange={(on) => togglePause(!on)} trackColor={{ true: Brand.signal }} accessibilityLabel="Sending on" />
          </View>
        </Card>
        {note && (
          <Card>
            <T kind="small">{note}</T>
          </Card>
        )}

        {billing?.viaStore && (
          <Card>
            <T kind="label" quiet>
              Your subscription
            </T>
            <T style={{ fontWeight: '600' }}>
              {billing.standing === 'trialing'
                ? `Free month${day(billing.renewsOrEnds) ? ` until ${day(billing.renewsOrEnds)}` : ''}`
                : billing.cancelled
                  ? `Cancelled: runs until ${day(billing.renewsOrEnds) ?? 'the end of the month'}`
                  : billing.standing === 'past_due'
                    ? 'A payment didn’t go through: please check your payment details'
                    : `Renews ${day(billing.renewsOrEnds) ?? 'monthly'}`}
            </T>
            <Button
              label={`Manage in ${billing.platform === 'play_store' ? 'Google Play' : 'the App Store'}`}
              kind="plain"
              small
              icon="open-outline"
              onPress={() => Linking.openURL(Platform.OS === 'ios' ? 'https://apps.apple.com/account/subscriptions' : 'https://play.google.com/store/account/subscriptions')}
            />
          </Card>
        )}

        <Button
          label="Log out"
          kind="plain"
          icon="log-out-outline"
          onPress={() =>
            Alert.alert('Log out of DinerAI?', 'You can log back in with your email and password.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Log out', style: 'destructive', onPress: signOut },
            ])
          }
        />
        <Button label="Delete account" kind="quiet" onPress={() => router.push('/delete-account')} />
        <T kind="mono" quiet style={{ textAlign: 'center' }}>
          DinerAI {Constants.expoConfig?.version ?? ''}
        </T>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { gap: Space.m, padding: Space.m, paddingTop: Space.xs, paddingBottom: Space.xl * 2, width: '100%', maxWidth: MaxWidth, alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.m - 4 },
});
