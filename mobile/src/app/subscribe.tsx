// "Start your free month" (phase 4): the App Store / Google Play subscription. First
// month free, then the store's monthly price (shown, as Apple and Google require; the
// website's prices and payment are never shown or linked here). On iPhone that's all (no
// offer code: the owner's call, 12 Nov); on Android FOUNDER is checked by our server,
// then Google's founder offer is bought. Once the store tells our server (a few seconds), the restaurant
// moves on to setup with Dina by itself.
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, TextInput, View } from 'react-native';

import { Button, Card, Screen, T, usePalette } from '@/components/ui';
import { Brand, Space, TapHeight } from '@/constants/theme';
import { API_URL, founderCode } from '@/lib/api';
import { buy, monthlyPlan, purchasesReady, restore, type Plan } from '@/lib/purchases';
import { useSession } from '@/lib/session';

const WAIT_MS = 45_000;

export default function Subscribe() {
  const c = usePalette();
  const { restaurantId, me, reloadMe, signOut } = useSession();
  const name = me?.restaurants.find((r) => r.id === restaurantId)?.name ?? 'your restaurant';
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(() => purchasesReady() && Boolean(restaurantId));
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [showCode, setShowCode] = useState(false);
  const stopWaiting = useRef(false);

  useEffect(() => {
    if (!restaurantId || !purchasesReady()) return;
    monthlyPlan(restaurantId)
      .then(setPlan)
      .catch(() => setNote('The App Store couldn’t be reached. Check your signal and try again.'))
      .finally(() => setLoading(false));
  }, [restaurantId]);
  useEffect(
    () => () => {
      stopWaiting.current = true;
    },
    [],
  );

  // Paid: wait for the store's message to reach our server (the screen changes by itself).
  const waitForServer = useCallback(async () => {
    setWaiting(true);
    const until = Date.now() + WAIT_MS;
    while (!stopWaiting.current && Date.now() < until) {
      await reloadMe();
      await new Promise((r) => setTimeout(r, 2500));
    }
    if (!stopWaiting.current) {
      setWaiting(false);
      setNote('Your free month has started, and we’re still waiting to hear from the store. Tap “Check again” in a moment.');
    }
  }, [reloadMe]);

  async function start(useFounder = false) {
    if (!restaurantId || !plan) return;
    setBusy(true);
    setNote(null);
    try {
      if (await buy(restaurantId, plan, useFounder)) await waitForServer();
    } catch {
      setNote('That didn’t go through, and you haven’t been charged. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  // Android only: our server checks FOUNDER, then Google's founder offer is bought.
  async function useCode() {
    if (!restaurantId) return;
    setBusy(true);
    try {
      const out = await founderCode(restaurantId, code);
      if (!out.ok) return setNote(out.reason);
      if (!plan?.founder) return setNote('The founder offer isn’t available on this phone yet. Carry on without it, or ask us at hello@dinerai.co.uk.');
      setBusy(false);
      await start(true);
    } catch {
      setNote('Couldn’t check that code. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function restoreIt() {
    if (!restaurantId) return;
    setBusy(true);
    try {
      if (await restore(restaurantId)) await waitForServer();
      else setNote('No DinerAI subscription found on this Apple or Google account.');
    } catch {
      setNote('Couldn’t restore just now. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const page = (path: string) => () => WebBrowser.openBrowserAsync(`${API_URL}${path}`);
  return (
    <Screen>
      <T kind="title">Start your free month</T>
      <T quiet>DinerAI for {name}: reviews answered, Google kept fresh, offers that bring people back, and a forecast every morning. You approve everything.</T>

      <Card>
        {['Your first month is free', 'Set up with Dina in about 15 minutes', 'Cancel any time in your phone’s settings'].map((line) => (
          <View key={line} style={styles.row}>
            <T style={{ color: Brand.signal }}>✓</T>
            <T style={{ flex: 1 }}>{line}</T>
          </View>
        ))}
      </Card>

      {loading ? (
        <ActivityIndicator />
      ) : !purchasesReady() ? (
        <Card accent>
          <T>Paying in the app isn’t switched on in this version yet. If you have an invite code, log out and sign up again with it.</T>
        </Card>
      ) : waiting ? (
        <Card>
          <ActivityIndicator />
          <T style={styles.center}>Starting your free month…</T>
        </Card>
      ) : plan ? (
        <>
          <Button label="Start my free month" onPress={() => start()} busy={busy} />
          <T kind="small" quiet style={styles.center}>
            Free for one month, then {plan.price} a month, renewing automatically until you cancel. Cancel at least 24 hours before the month ends in your {Platform.OS === 'ios' ? 'Apple ID' : 'Google Play'} subscriptions.
          </T>
        </>
      ) : (
        <Card>
          <T>The subscription isn’t available just now. Please try again in a moment.</T>
        </Card>
      )}

      {note && (
        <Card accent>
          <T>{note}</T>
          {note.includes('Check again') && <Button label="Check again" kind="plain" onPress={() => reloadMe()} />}
        </Card>
      )}

      {purchasesReady() && !waiting && (
        <>
          {/* FOUNDER is Android only: on iPhone it's the free month, then the monthly price (the owner's call, 12 Nov). */}
          {Platform.OS === 'android' &&
            (showCode ? (
              <Card>
                <T kind="small" quiet>
                  Your code
                </T>
                <TextInput
                  value={code}
                  onChangeText={setCode}
                  autoCapitalize="characters"
                  placeholder="FOUNDER"
                  placeholderTextColor={c.textSecondary}
                  style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.card }]}
                  accessibilityLabel="Offer code"
                />
                <Button label="Use this code" onPress={useCode} busy={busy} disabled={!code.trim()} />
              </Card>
            ) : (
              <Button label="I have an offer code" kind="plain" onPress={() => setShowCode(true)} />
            ))}
          <Button label="Restore a purchase" kind="plain" onPress={restoreIt} disabled={busy} />
        </>
      )}

      <View style={styles.links}>
        <Button label="Terms of use" kind="plain" onPress={page('/terms')} />
        <Button label="Privacy" kind="plain" onPress={page('/privacy')} />
      </View>
      <Button label="Log out" kind="plain" onPress={signOut} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Space.s, alignItems: 'flex-start' },
  center: { textAlign: 'center' },
  input: { minHeight: TapHeight, borderWidth: 1, borderRadius: 12, paddingHorizontal: Space.m, fontSize: 17 },
  links: { flexDirection: 'row', justifyContent: 'center', gap: Space.s },
});
