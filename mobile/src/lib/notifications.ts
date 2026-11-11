// Notifications (phase 2): permission, the phone's push token sent to DinerAI,
// the buttons on notifications, the badge, and what a tap does. The server decides
// what to send (web app: src/lib/push.ts, src/lib/push-rules.ts).
//
// Buttons (categories), matching the server's PushCategory:
//   draft  "Approve" (Face ID / passcode first, opens the app) · "Open"
//   brief  "Open"
// Remote notifications need a development build (not Expo Go) since SDK 53.
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { api } from '@/lib/api';

// Shown while the app is open, too (a banner and in the list).
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
});

let categoriesReady = false;
async function setUpCategories() {
  if (categoriesReady) return;
  await Notifications.setNotificationCategoryAsync('draft', [
    { identifier: 'approve', buttonTitle: 'Approve', options: { opensAppToForeground: true, isAuthenticationRequired: true } },
    { identifier: 'open', buttonTitle: 'Open', options: { opensAppToForeground: true } },
  ]);
  await Notifications.setNotificationCategoryAsync('brief', [{ identifier: 'open', buttonTitle: 'Open', options: { opensAppToForeground: true } }]);
  if (Platform.OS === 'android') {
    // (import/namespace can't follow expo-notifications' re-exported enums; tsc checks them.)
    // eslint-disable-next-line import/namespace
    await Notifications.setNotificationChannelAsync('default', { name: 'Brief and updates', importance: Notifications.AndroidImportance.DEFAULT });
    // eslint-disable-next-line import/namespace
    await Notifications.setNotificationChannelAsync('urgent', { name: 'Urgent alerts (bad reviews)', importance: Notifications.AndroidImportance.HIGH });
  }
  categoriesReady = true;
}

export type AlertsState = 'on' | 'off' | 'ask' | 'unavailable';

// Whether notifications are on, without asking.
export async function alertsState(): Promise<AlertsState> {
  try {
    const p = await Notifications.getPermissionsAsync();
    // eslint-disable-next-line import/namespace
    if (p.granted || p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return 'on';
    return p.canAskAgain ? 'ask' : 'off';
  } catch {
    return 'unavailable';
  }
}

let lastToken: string | null = null;

// Registers this phone with DinerAI. ask=true shows the permission prompt (only
// from the "Turn on alerts" button); otherwise only if already allowed. Returns
// the state afterwards. In Expo Go there's no push token: 'unavailable'.
export async function registerForAlerts(ask: boolean): Promise<AlertsState> {
  try {
    await setUpCategories();
    let state = await alertsState();
    if (state === 'ask' && ask) {
      const p = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } });
      state = p.granted ? 'on' : p.canAskAgain ? 'ask' : 'off';
    }
    if (state !== 'on') return state;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    lastToken = token;
    await api('/api/app/devices', { method: 'POST', body: { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' } });
    return 'on';
  } catch (err) {
    console.warn('Alerts unavailable', err);
    return 'unavailable';
  }
}

// Logging out: this phone stops getting this login's notifications.
export async function unregisterAlerts() {
  if (!lastToken) return;
  await api('/api/app/devices', { method: 'DELETE', body: { token: lastToken } }).catch(() => {});
  lastToken = null;
}

export function setBadge(count: number) {
  Notifications.setBadgeCountAsync(Math.max(0, count)).catch(() => {});
}

export type Tap = { action: 'open' | 'approve'; screen: 'today' | 'inbox'; draftId?: string; restaurantId?: string };

export function tapFrom(response: Notifications.NotificationResponse): Tap {
  const data = (response.notification.request.content.data ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  return {
    action: response.actionIdentifier === 'approve' ? 'approve' : 'open',
    screen: data.screen === 'inbox' ? 'inbox' : 'today',
    draftId: str(data.draftId),
    restaurantId: str(data.restaurantId),
  };
}

// Taps on notifications, including the one that opened the app. Returns a stop function.
export function onTap(handle: (tap: Tap) => void) {
  Notifications.getLastNotificationResponseAsync()
    .then((r) => {
      if (r) {
        handle(tapFrom(r));
        Notifications.clearLastNotificationResponseAsync().catch(() => {});
      }
    })
    .catch(() => {});
  const sub = Notifications.addNotificationResponseReceivedListener((r) => handle(tapFrom(r)));
  return () => sub.remove();
}
