// More (phases 4 and 5): customers, settings, recommending a restaurant, help, pausing
// all sending, the restaurant switcher (the builder), the subscription, logging out and
// deleting the account. Everything the website's dashboard does.
import Constants from 'expo-constants';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Linking, Platform, Pressable, Share, StyleSheet, Switch, View } from 'react-native';

import { Button, Card, Screen, T, usePalette } from '@/components/ui';
import { Brand, Space } from '@/constants/theme';
import { getReferral, getSettings, setPaused } from '@/lib/api';
import { useSession } from '@/lib/session';

export default function More() {
  const c = usePalette();
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
    <Screen>
      <T kind="title">More</T>
      <Card>
        <T kind="label" quiet>
          Logged in as
        </T>
        <T>{me?.email ?? '…'}</T>
        {me && me.restaurants.length === 1 && (
          <T kind="small" quiet>
            {me.restaurants[0].name}
            {me.restaurants[0].active ? '' : ' (not running yet)'}
          </T>
        )}
      </Card>
      {me && me.restaurants.length > 1 && (
        <Card>
          <T kind="label" quiet>
            Restaurant shown
          </T>
          {me.restaurants.map((r) => (
            <Button key={r.id} kind={r.id === restaurantId ? 'main' : 'plain'} label={`${r.name}${r.active ? '' : ' (not running)'}`} onPress={() => setRestaurantId(r.id)} />
          ))}
        </Card>
      )}

      <Card>
        <Row label="Customers" detail="Your list, QR codes, import and export" to="/customers" />
        <Row label="Settings" detail="Hours, offers, how replies sound, timing, notifications" to="/settings" />
        <Row label="Recommend a restaurant" detail="Get a free month for each one that joins" onPress={recommend} />
        <Row label="Help" detail="How everything works, and talk to a person" to="/help" last />
      </Card>

      <Card accent={paused === true}>
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <T style={{ fontWeight: '600' }}>{paused ? 'Sending is paused' : 'Sending is on'}</T>
            <T kind="small" quiet>
              {paused ? 'Nothing goes out to customers or Google until you turn it back on.' : 'Turn off to pause everything at once.'}
            </T>
          </View>
          <Switch value={paused === false} disabled={paused === null} onValueChange={(on) => togglePause(!on)} trackColor={{ true: Brand.signal }} accessibilityLabel="Sending on" />
        </View>
      </Card>
      {note && (
        <Card>
          <T>{note}</T>
        </Card>
      )}

      {billing?.viaStore && (
        <Card>
          <T kind="label" quiet>
            Your subscription
          </T>
          <T>
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
            onPress={() => Linking.openURL(Platform.OS === 'ios' ? 'https://apps.apple.com/account/subscriptions' : 'https://play.google.com/store/account/subscriptions')}
          />
        </Card>
      )}

      <Button
        label="Log out"
        kind="danger"
        onPress={() =>
          Alert.alert('Log out of DinerAI?', 'You can log back in with your email and password.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Log out', style: 'destructive', onPress: signOut },
          ])
        }
      />
      <Button label="Delete account" kind="plain" onPress={() => router.push('/delete-account')} />
      <T kind="small" quiet style={{ color: c.textSecondary }}>
        DinerAI {Constants.expoConfig?.version ?? ''}
      </T>
    </Screen>
  );
}

function Row({ label, detail, to, onPress, last }: { label: string; detail: string; to?: Href; onPress?: () => void; last?: boolean }) {
  const c = usePalette();
  return (
    <Pressable
      onPress={() => (to ? router.push(to) : onPress?.())}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={detail}
      style={({ pressed }) => [styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.border }, { opacity: pressed ? 0.7 : 1 }]}>
      <View style={{ flex: 1 }}>
        <T style={{ fontWeight: '600' }}>{label}</T>
        <T kind="small" quiet>
          {detail}
        </T>
      </View>
      <T quiet>›</T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.s, paddingVertical: Space.s + 2, minHeight: 56 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Space.m },
});
