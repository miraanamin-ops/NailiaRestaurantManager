// Talking to DinerAI's servers (the web app's /api/app/* routes). The app never
// talks to the database directly: it logs in through /api/app/login, keeps the
// tokens in the phone's secure storage (Keychain / Keystore), and swaps the
// refresh token for a fresh session through /api/app/refresh when it runs out.
import * as SecureStore from 'expo-secure-store';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://app.dinerai.co.uk').replace(/\/$/, '');

// Two keys, each well under the ~2 KB some iOS versions allow per item.
const ACCESS = 'dinerai.access';
const REFRESH = 'dinerai.refresh';
const EXPIRES = 'dinerai.expires';

export type Tokens = { access_token: string; refresh_token: string; expires_at?: number };

export class LoginNeeded extends Error {}
export class ApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

export async function saveTokens(t: Tokens) {
  await SecureStore.setItemAsync(ACCESS, t.access_token);
  await SecureStore.setItemAsync(REFRESH, t.refresh_token);
  await SecureStore.setItemAsync(EXPIRES, String(t.expires_at ?? 0));
}

export async function clearTokens() {
  await Promise.all([ACCESS, REFRESH, EXPIRES].map((k) => SecureStore.deleteItemAsync(k).catch(() => {})));
}

export async function hasTokens() {
  return Boolean(await SecureStore.getItemAsync(REFRESH));
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, json.error ?? 'failed');
  return json as T;
}

export async function logIn(email: string, password: string) {
  await saveTokens(await post<Tokens>('/api/app/login', { email, password }));
}

// One refresh at a time, however many calls notice the token ran out together.
let refreshing: Promise<string> | null = null;
async function refreshed(): Promise<string> {
  refreshing ??= (async () => {
    const refresh_token = await SecureStore.getItemAsync(REFRESH);
    if (!refresh_token) throw new LoginNeeded();
    try {
      const t = await post<Tokens>('/api/app/refresh', { refresh_token });
      await saveTokens(t);
      return t.access_token;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await clearTokens();
        throw new LoginNeeded();
      }
      throw err;
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function accessToken() {
  const [token, expires] = await Promise.all([SecureStore.getItemAsync(ACCESS), SecureStore.getItemAsync(EXPIRES)]);
  // Refresh a minute early rather than have a call fail.
  if (!token || (Number(expires) && Number(expires) * 1000 < Date.now() + 60_000)) return refreshed();
  return token;
}

// A logged-in call. Throws LoginNeeded when the login has ended (the app then shows the login screen).
export async function api<T>(path: string, init: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T> {
  const call = async (token: string) =>
    fetch(`${API_URL}${path}`, {
      method: init.method ?? 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  let res = await call(await accessToken());
  if (res.status === 401) res = await call(await refreshed());
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status === 401) {
    await clearTokens();
    throw new LoginNeeded();
  }
  if (!res.ok) throw new ApiError(res.status, json.error ?? 'failed');
  return json as T;
}

// ---------- Today and Inbox (phase 1) ----------

export type CardCheck = { name: string; label: string; status: 'pass' | 'fixed' | 'flagged' | 'failed' | 'held' | 'blocked'; notes: string[] };
export type InboxCard = {
  id: string;
  kind: string;
  kindLabel: string;
  title: string;
  body: string;
  audience: string | null;
  review: { author: string; rating: number; text: string | null } | null;
  previewImageUrl: string | null;
  checks: CardCheck[];
  flagged: boolean;
  urgent: boolean;
  actions: ('approve' | 'edit' | 'skip')[] | 'answer';
  approveHint: string;
  waitingSince: string;
};
export type Today = {
  restaurant: { id: string; name: string; paused: boolean };
  takings: { amount: string; change: string | null } | null;
  waiting: { count: number; line: string; next: { id: string; title: string; urgent: boolean }[] };
  done: string[];
};
export type DecideBody = { action: 'approve' | 'skip' } | { action: 'edit'; instructions: string } | { action: 'reason'; reason: string };
export type DecideResult = { ok: true; replies: string[]; card: InboxCard | null };

const q = (r: string | null) => (r ? `?r=${encodeURIComponent(r)}` : '');
export const getToday = (r: string | null) => api<Today>(`/api/app/today${q(r)}`);
export const getInbox = (r: string | null) => api<{ restaurantId: string; cards: InboxCard[] }>(`/api/app/inbox${q(r)}`);
export const decide = (draftId: string, body: DecideBody) => api<DecideResult>(`/api/app/drafts/${draftId}`, { method: 'POST', body });
export const undoLast = (r: string | null) => api<{ message: string }>(`/api/app/undo${q(r)}`, { method: 'POST' });

// The /api/app/me answer.
export type Me = { email: string; firstName: string | null; isBuilder: boolean; restaurants: { id: string; name: string; active: boolean }[] };
