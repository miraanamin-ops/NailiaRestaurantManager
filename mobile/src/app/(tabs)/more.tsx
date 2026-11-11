// More: the account, the subscription, and Delete account (phase 4); customers,
// settings, refer and help arrive in phase 5.
import Constants from 'expo-constants';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Alert, Linking, Platform } from 'react-native';

import { Button, Card, Screen, T } from '@/components/ui';
import { API_URL } from '@/lib/api';
import { useSession } from '@/lib/session';

export default function More() {
  const { me, signOut, restaurantId, setRestaurantId } = useSession();
  const billing = me?.restaurants.find((r) => r.id === restaurantId)?.billing;
  const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) : null);
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
            <Button
              key={r.id}
              kind={r.id === restaurantId ? 'main' : 'plain'}
              label={`${r.name}${r.active ? '' : ' (not running)'}`}
              onPress={() => setRestaurantId(r.id)}
            />
          ))}
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
      <Card>
        <T>Customers, settings, recommending a restaurant and help are coming to the app soon. Until then they’re on the website.</T>
        <Button label="Open DinerAI on the web" kind="plain" onPress={() => WebBrowser.openBrowserAsync(API_URL)} />
      </Card>
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
      <T kind="small" quiet>
        DinerAI {Constants.expoConfig?.version ?? ''}
      </T>
    </Screen>
  );
}
