// Who is logged in, and the Face ID / fingerprint lock. The login itself lives in
// secure storage (lib/api.ts); this only knows whether there is one, who it is
// (/api/app/me), and whether the app is locked.
//
// The lock: when the app opens with a saved login, or comes back after more than
// 5 minutes in the background, it asks for Face ID / fingerprint (or the phone's
// passcode). Phones without either are never locked. "Use my password instead"
// logs out.
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { createContext, use, useCallback, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';

import { api, clearTokens, dropPendingSocial, hasTokens, logIn, LoginNeeded, type Me, type Stage } from '@/lib/api';
import { registerForAlerts, unregisterAlerts } from '@/lib/notifications';

const LOCK_AFTER_MS = 5 * 60 * 1000;

type Session = {
  loading: boolean;
  signedIn: boolean;
  me: Me | null;
  locked: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  unlock: () => Promise<boolean>;
  reloadMe: () => Promise<void>;
  // The restaurant the screens show: the owner's own, or (the builder) the one picked in More.
  restaurantId: string | null;
  // Where that restaurant is: pay (start the free month), setup (Dina) or ready (the tabs).
  stage: Stage | null;
  // After sign-up or Sign in with Apple / Google has saved the login: carry on as logged in.
  startSession: (restaurantId?: string) => Promise<void>;
  setRestaurantId: (id: string) => void;
};

const SessionContext = createContext<Session | null>(null);

export function useSession() {
  const s = use(SessionContext);
  if (!s) throw new Error('useSession must be used inside SessionProvider');
  return s;
}

async function canLock() {
  return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
}

export function SessionProvider({ children }: PropsWithChildren) {
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [locked, setLocked] = useState(false);
  const backgroundAt = useRef<number | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    SecureStore.getItemAsync('dinerai.restaurant').then(setPicked).catch(() => {});
  }, []);
  const setRestaurantId = useCallback((id: string) => {
    setPicked(id);
    SecureStore.setItemAsync('dinerai.restaurant', id).catch(() => {});
  }, []);
  // A remembered pick only counts if this login can still see it.
  const restaurantId = me ? (me.restaurants.find((r) => r.id === picked)?.id ?? me.restaurants[0]?.id ?? null) : null;

  const stage = me ? (me.restaurants.find((r) => r.id === restaurantId)?.stage ?? null) : null;

  const signOut = useCallback(async () => {
    dropPendingSocial();
    await unregisterAlerts();
    await clearTokens();
    setMe(null);
    setLocked(false);
    setSignedIn(false);
  }, []);

  const reloadMe = useCallback(async () => {
    try {
      setMe(await api<Me>('/api/app/me'));
    } catch (err) {
      if (err instanceof LoginNeeded) await signOut();
      // Anything else (no signal): keep what we have; screens show their own retry.
    }
  }, [signOut]);

  // Opening the app: a saved login means signed in (and locked, where the phone can lock).
  useEffect(() => {
    (async () => {
      const saved = await hasTokens().catch(() => false);
      if (saved) {
        setSignedIn(true);
        setLocked(await canLock().catch(() => false));
        reloadMe();
        // "Still here": keeps this phone's notifications pointed at this login (no prompt).
        registerForAlerts(false);
      }
      setLoading(false);
    })();
  }, [reloadMe]);

  // Back after more than 5 minutes away: lock again.
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (state) => {
      if (state === 'background') backgroundAt.current = Date.now();
      if (state === 'active' && backgroundAt.current && Date.now() - backgroundAt.current > LOCK_AFTER_MS && signedIn) {
        if (await canLock().catch(() => false)) setLocked(true);
      }
      if (state === 'active') backgroundAt.current = null;
    });
    return () => sub.remove();
  }, [signedIn]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      await logIn(email.trim().toLowerCase(), password);
      setSignedIn(true);
      setLocked(false);
      await reloadMe();
      registerForAlerts(false);
    },
    [reloadMe],
  );

  const startSession = useCallback(
    async (restaurantId?: string) => {
      if (restaurantId) setRestaurantId(restaurantId);
      setSignedIn(true);
      setLocked(false);
      await reloadMe();
    },
    [reloadMe, setRestaurantId],
  );

  const unlock = useCallback(async () => {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock DinerAI', cancelLabel: 'Cancel' });
    if (result.success) setLocked(false);
    return result.success;
  }, []);

  return <SessionContext value={{ loading, signedIn, me, locked, signIn, signOut, unlock, reloadMe, restaurantId, setRestaurantId, stage, startSession }}>{children}</SessionContext>;
}
