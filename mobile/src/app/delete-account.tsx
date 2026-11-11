// Delete account (phase 4, Apple's rule): the website's close-account flow. Typing
// the restaurant's name confirms it; sending stops straight away; after 24 hours (to
// change your mind) everything is exported and emailed to you, then deleted, login
// included. An App Store / Google Play subscription has to be cancelled in the phone's
// settings: the screen says so.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, StyleSheet, TextInput, View } from 'react-native';

import { Button, Card, IconTile, Screen, T, usePalette } from '@/components/ui';
import { Space, TapHeight } from '@/constants/theme';
import { cancelDelete, deleteAccount, getClosing } from '@/lib/api';
import { useSession } from '@/lib/session';

const STORE_SUBSCRIPTIONS = Platform.OS === 'ios' ? 'https://apps.apple.com/account/subscriptions' : 'https://play.google.com/store/account/subscriptions';
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }) : 'soon');

export default function DeleteAccount() {
  const c = usePalette();
  const { me, restaurantId, signOut } = useSession();
  const restaurant = me?.restaurants.find((r) => r.id === restaurantId);
  const [closing, setClosing] = useState<{ closesAt: string | null } | null | undefined>(undefined);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [storeNote, setStoreNote] = useState<string | null>(null);

  useEffect(() => {
    if (!restaurantId) return;
    getClosing(restaurantId)
      .catch(() => ({ closing: null }))
      .then((out) => setClosing(out.closing));
  }, [restaurantId]);

  async function remove() {
    if (!restaurantId) return;
    setBusy(true);
    setNote(null);
    try {
      const out = await deleteAccount(restaurantId, typed);
      if ('refused' in out) return setNote(out.refused);
      setStoreNote(out.storeNote);
      // A test restaurant closes at once: the login goes with it.
      if (out.now) return signOut();
      setClosing({ closesAt: out.closesAt });
    } catch {
      setNote('That didn’t go through. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function keep() {
    if (!restaurantId) return;
    setBusy(true);
    try {
      const out = await cancelDelete(restaurantId);
      if ('refused' in out) setNote(out.refused);
      else {
        setNote('Your account is staying. Sending is back on.');
        setClosing(null);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={{ gap: Space.s, marginTop: Space.s }}>
        <IconTile name="trash-outline" tone="ember" />
        <T kind="title">Delete account</T>
      </View>
      {closing === undefined ? (
        <ActivityIndicator />
      ) : closing ? (
        <Card accent>
          <T kind="heading">Your account is being deleted</T>
          <T>Sending has stopped. Everything for {restaurant?.name ?? 'your restaurant'} will be deleted on {when(closing.closesAt)}, after we email you a copy of your data.</T>
          <Button label="Keep my account" onPress={keep} busy={busy} />
        </Card>
      ) : (
        <>
          <Card>
            <T>This deletes {restaurant?.name ?? 'your restaurant'} from DinerAI: your customers, drafts, sales, settings and your login.</T>
            <T>Sending stops straight away. You have 24 hours to change your mind, then we email you a copy of your data and delete everything.</T>
            <T kind="small" quiet>
              Type the restaurant’s name to confirm: {restaurant?.name}
            </T>
            <TextInput
              value={typed}
              onChangeText={setTyped}
              autoCapitalize="words"
              accessibilityLabel="The restaurant's name"
              style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.background }]}
            />
            <Button label="Delete my account" kind="danger" onPress={remove} busy={busy} disabled={!typed.trim()} />
          </Card>
          <T kind="small" quiet>
            Paying through the App Store or Google Play? Deleting your account doesn’t cancel that subscription: cancel it in your phone’s settings too.
          </T>
        </>
      )}
      {storeNote && (
        <Card accent>
          <T>{storeNote}</T>
          <Button label="Open my subscriptions" kind="plain" onPress={() => Linking.openURL(STORE_SUBSCRIPTIONS)} />
        </Card>
      )}
      {note && (
        <Card>
          <T>{note}</T>
        </Card>
      )}
      <Button label="Back" kind="plain" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: TapHeight, borderWidth: 1, borderRadius: 12, paddingHorizontal: Space.m, fontSize: 17 },
});
