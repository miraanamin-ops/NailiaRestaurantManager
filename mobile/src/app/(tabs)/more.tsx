// More: the account for now; customers, settings, refer and help arrive in phase 5.
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import { Alert } from 'react-native';

import { Button, Card, Screen, T } from '@/components/ui';
import { API_URL } from '@/lib/api';
import { useSession } from '@/lib/session';

export default function More() {
  const { me, signOut } = useSession();
  return (
    <Screen>
      <T kind="title">More</T>
      <Card>
        <T kind="label" quiet>
          Logged in as
        </T>
        <T>{me?.email ?? '…'}</T>
        {me?.restaurants.map((r) => (
          <T key={r.id} kind="small" quiet>
            {r.name}
            {r.active ? '' : ' (not running yet)'}
          </T>
        ))}
      </Card>
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
      <T kind="small" quiet>
        DinerAI {Constants.expoConfig?.version ?? ''}
      </T>
    </Screen>
  );
}
