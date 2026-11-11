// The app's frame (Expo Router's protected screens): not logged in → log in or sign
// up; logged in → where the restaurant is: "Start your free month" (pay), setup with
// Dina (setup), or the five tabs (ready). The splash screen stays up until we know
// which, and a locked app shows the unlock screen over everything.
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { LockScreen } from '@/components/lock-screen';
import { Colors } from '@/constants/theme';
import { decide } from '@/lib/api';
import { onTap } from '@/lib/notifications';
import { SessionProvider, useSession } from '@/lib/session';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const c = Colors[scheme];
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={{ ...base, colors: { ...base.colors, background: c.background, card: c.card, text: c.text, border: c.border, primary: c.tint } }}>
        <SessionProvider>
          <RootNavigator />
        </SessionProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator() {
  const { loading, signedIn, locked, me, setRestaurantId, stage } = useSession();
  useEffect(() => {
    if (!loading) SplashScreen.hideAsync();
  }, [loading]);

  // A tap on a notification: open the right screen (and restaurant). "Approve" has
  // already asked for Face ID / the passcode on the lock screen, so it's approved here.
  useEffect(() => {
    if (!signedIn) return;
    return onTap(async (tap) => {
      if (tap.restaurantId && me?.restaurants.some((r) => r.id === tap.restaurantId)) setRestaurantId(tap.restaurantId);
      let note: string | undefined;
      if (tap.action === 'approve' && tap.draftId) {
        note = await decide(tap.draftId, { action: 'approve' })
          .then((out) => out.replies[0] ?? 'Approved.')
          .catch(() => 'That approval didn’t go through. Have a look below.');
      }
      router.navigate(tap.screen === 'inbox' || note ? { pathname: '/inbox', params: note ? { note } : {} } : '/');
    });
  }, [signedIn, me, setRestaurantId]);
  if (loading) return null;
  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={signedIn && stage !== 'pay' && stage !== 'setup'}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="delete-account" options={{ presentation: 'modal' }} />
          {/* Phase 5: More's screens and a report, with a header and back button. */}
          <Stack.Screen name="customers" options={{ headerShown: true, title: 'Customers', headerBackTitle: 'More' }} />
          <Stack.Screen name="settings" options={{ headerShown: true, title: 'Settings', headerBackTitle: 'More' }} />
          <Stack.Screen name="help" options={{ headerShown: true, title: 'Help', headerBackTitle: 'More' }} />
          <Stack.Screen name="report/[token]" options={{ headerShown: true, title: 'Report', headerBackTitle: 'Reports' }} />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && stage === 'pay'}>
          <Stack.Screen name="subscribe" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && stage === 'setup'}>
          <Stack.Screen name="setup" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="sign-in" />
          <Stack.Screen name="sign-up" />
        </Stack.Protected>
      </Stack>
      {signedIn && locked && <LockScreen />}
    </>
  );
}
