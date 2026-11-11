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
export async function api<T>(path: string, init: { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown } = {}): Promise<T> {
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
  rota?: TodayRota; // who's on today, from this week's rota
};
export type DecideBody = { action: 'approve' | 'skip' } | { action: 'edit'; instructions: string } | { action: 'reason'; reason: string };
export type DecideResult = { ok: true; replies: string[]; card: InboxCard | null };

const q = (r: string | null) => (r ? `?r=${encodeURIComponent(r)}` : '');
export const getToday = (r: string | null) => api<Today>(`/api/app/today${q(r)}`);
export const getInbox = (r: string | null) => api<{ restaurantId: string; cards: InboxCard[] }>(`/api/app/inbox${q(r)}`);
export const decide = (draftId: string, body: DecideBody) => api<DecideResult>(`/api/app/drafts/${draftId}`, { method: 'POST', body });
export const undoLast = (r: string | null) => api<{ message: string }>(`/api/app/undo${q(r)}`, { method: 'POST' });

// The /api/app/me answer.
// stage: pay (start the free month), setup (Dina) or ready (the tabs); billing for More.
export type Stage = 'pay' | 'setup' | 'ready';
export type AppBilling = { standing: string; viaStore: boolean; platform: string | null; renewsOrEnds: string | null; cancelled: boolean };
export type Me = { email: string; firstName: string | null; isBuilder: boolean; restaurants: { id: string; name: string; active: boolean; stage: Stage; billing: AppBilling }[] };

// ---------- Chat (phase 3) ----------
// The same conversation as WhatsApp, on the bot's own engine (/api/app/chat).

export type ChatButton = { id: string; title: string };
export type ChatEntry = {
  id: string;
  from: 'owner' | 'dinerai';
  text: string;
  at: string;
  channel: 'app' | 'whatsapp';
  buttons: ChatButton[]; // quick replies (only on DinerAI's latest messages)
  draftId: string | null;
  card: InboxCard | null; // the draft this message shows, while it's still waiting
  imageUrl: string | null; // a picture DinerAI sent, or the owner's photo
  file: { name: string; photo: boolean } | null; // what the owner sent
};
export type ChatState = { restaurantId: string; messages: ChatEntry[]; hasMore: boolean; duplicate?: boolean; refused?: string };
export type ChatFile = { path: string; name: string; contentType: string };

export const getChat = (r: string | null, before?: string) =>
  api<ChatState>(`/api/app/chat${q(r)}${before ? `${r ? '&' : '?'}before=${encodeURIComponent(before)}` : ''}`);
export const sendChat = (r: string | null, body: { text?: string; payload?: string; clientId: string; file?: ChatFile }) =>
  api<ChatState>(`/api/app/chat${q(r)}`, { method: 'POST', body });
export const focusChat = (r: string | null, draftId: string) => api<ChatState>(`/api/app/chat/focus${q(r)}`, { method: 'POST', body: { draftId } });

// An id for one message, so a resend after a lost connection is answered once.
export const newClientId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

// A photo or file for the chat: the server checks it and hands back a one-time link,
// the phone puts the file straight into DinerAI's private storage, and the chat
// message then carries it. Returns the file, or the reason it was refused.
export async function uploadChatFile(r: string | null, f: { uri: string; name: string; mimeType: string | null; size: number }): Promise<ChatFile | { refused: string }> {
  const { File } = await import('expo-file-system');
  const link = await api<{ path: string; uploadUrl: string; contentType: string; name: string } | { refused: string }>(`/api/app/chat/upload${q(r)}`, {
    method: 'POST',
    body: { name: f.name, contentType: f.mimeType, size: f.size },
  });
  if ('refused' in link) return link;
  const res = await new File(f.uri).upload(link.uploadUrl, { httpMethod: 'PUT', mimeType: link.contentType, headers: { 'x-upsert': 'false' } });
  if (res.status < 200 || res.status >= 300) throw new ApiError(res.status, 'upload_failed');
  return { path: link.path, name: link.name, contentType: link.contentType };
}

// ---------- Sign-up, setup and paying (phase 4) ----------

// A login from Sign in with Apple / Google for someone who hasn't signed up yet: kept
// in memory only (never saved) until the sign-up form is sent.
let pendingSocial: Tokens | null = null;
export const hasPendingSocial = () => Boolean(pendingSocial);
export const dropPendingSocial = () => {
  pendingSocial = null;
};

export type SocialResult = { known: true } | { known: false; email: string; name: string | null };
export async function socialLogin(provider: 'apple' | 'google', idToken: string, extra: { nonce?: string; name?: string | null } = {}): Promise<SocialResult> {
  const out = await post<{ known: boolean; tokens: Tokens; email?: string; name?: string | null }>('/api/app/login/social', { provider, idToken, ...extra });
  if (out.known) {
    pendingSocial = null;
    await saveTokens(out.tokens);
    return { known: true };
  }
  pendingSocial = out.tokens;
  return { known: false, email: out.email ?? '', name: out.name ?? null };
}

export type SignUpBody = { ownerName: string; restaurantName: string; email: string; password?: string; whatsapp: string; terms: boolean; invite?: string; referral?: string };
// Signs up and logs in. A sign-up after Apple / Google sends that login, with no password.
export async function signUp(body: SignUpBody): Promise<{ restaurantId: string; next: 'setup' | 'pay' }> {
  const social = pendingSocial;
  const res = await fetch(`${API_URL}/api/app/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(social ? { Authorization: `Bearer ${social.access_token}` } : {}) },
    body: JSON.stringify(social ? { ...body, password: undefined } : body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string; restaurantId?: string; next?: 'setup' | 'pay'; tokens?: Tokens };
  if (!res.ok) throw new ApiError(res.status, json.error ?? 'failed');
  await saveTokens(social ?? json.tokens!);
  pendingSocial = null;
  return { restaurantId: json.restaurantId!, next: json.next! };
}

// Setup with Dina: the website's chat, the same messages and cards (types from the web app).
export type SetupOption = { id: string; label: string; short?: string };
export type QuestionOption = { id: string; label: string; short?: string; body?: string; swatches?: string[] };
export type GridData = { columns: { id: string; label: string; short: string }[]; rows: { id: string; label: string; section: string; marked: string[]; suggested: boolean; unsure: boolean }[] };
export type QuestionData = {
  q: string;
  options: QuestionOption[];
  multi: boolean;
  confirm: boolean;
  skip: boolean;
  layout: 'buttons' | 'cards' | 'swatches';
  quote?: { author: string; rating: number; text: string; real: boolean };
  image?: string | null;
  input?: { optionId: string; placeholder: string } | null;
  upload?: { accept: 'photo' | 'document' | 'spreadsheet' | 'any'; multiple: boolean; label: string } | null;
  selected?: string[];
  grid?: GridData | null;
  link?: { label: string; href: string } | null;
};
export type ConfirmationData = { title: string; fields: { key: string; label: string; value: string | null; multiline?: boolean; colour?: string }[]; image?: string | null };
export type SummaryData = {
  done: number;
  total: number;
  items: { key: string; title: string; status: string; detail: string }[];
  locked: { key: string; title: string; unlock: string }[];
  next: string[];
  dashboardHref?: string | null;
  agents?: { key: string; name: string; ready: boolean; needs: string[] }[];
};
export type RecapData = { chapter: string; title: string; rows: { q: string; label: string; value: string; status: string; swatches?: string[] }[]; next: string | null };
export type SetupComponent =
  | { type: 'quick_replies'; options: SetupOption[] }
  | { type: 'choice_cards'; cards: { id: string; title: string; body: string }[]; quote?: QuestionData['quote'] }
  | { type: 'steps'; title: string; steps: { n: number; text: string; copy?: string; link?: { label: string; href: string } }[]; note: string; actions: SetupOption[] }
  | { type: 'forward'; intro: string; text: string }
  | { type: 'link'; label: string; href: string; hint: string | null; continueLabel?: string | null }
  | { type: 'dish_check'; dish: string; section: string; suggested: string[]; position: number; total: number; actions: SetupOption[] }
  | { type: 'upload'; accept: 'photo' | 'document' | 'spreadsheet' | 'any'; multiple: boolean; label: string }
  | { type: 'confirmation'; card: ConfirmationData }
  | { type: 'summary'; summary: SummaryData }
  | { type: 'question'; card: QuestionData }
  | { type: 'recap'; recap: RecapData };
export type SetupMessage = { id: string; role: 'dina' | 'owner'; text: string; component?: SetupComponent | null; answered?: boolean };
export type SetupProgress = {
  position: number;
  total: number;
  chapters?: { key: string; title: string; status: string; left: string[] }[];
  chapter?: { n: number; total: number; title: string; key: string } | null;
};
export type SetupState = { restaurantId: string; restaurantName: string; messages: SetupMessage[]; chosen: Record<string, string>; progress: SetupProgress; skippable: boolean; needsStart: boolean };
export type SetupAction =
  | { kind: 'start' }
  | { kind: 'message'; text: string }
  | { kind: 'answer'; messageId: string; choiceId: string; label: string }
  | { kind: 'pick'; messageId: string; choiceIds: string[]; text?: string; label: string; grid?: Record<string, string[] | 'unsure'> }
  | { kind: 'confirm'; messageId: string; changes: Record<string, string> }
  | { kind: 'skip' }
  | { kind: 'jump'; step: string }
  | { kind: 'files'; paths: string[] };
export type SetupTurn = { messages: SetupMessage[]; progress: SetupProgress | null; skippable: boolean; error: string | null };

export const getSetup = (r: string) => api<SetupState>(`/api/app/setup${q(r)}`);
export async function setupAction(r: string, action: SetupAction) {
  const { randomUUID } = await import('expo-crypto');
  return api<SetupTurn>('/api/app/setup', { method: 'POST', body: { r, action: action.kind === 'start' ? action : { ...action, clientId: randomUUID() } } });
}
// Files for Dina (menu photos, a PDF, a till export): straight into private storage, then their paths.
export async function setupUpload(r: string, files: { uri: string; name: string; type: string; size: number }[]): Promise<string[] | { refused: string }> {
  const { File } = await import('expo-file-system');
  const out = await api<{ targets: { path: string; url: string }[] } | { refused: string }>('/api/app/setup/upload', {
    method: 'POST',
    body: { r, files: files.map((f) => ({ name: f.name, size: Math.max(1, f.size), type: f.type })) },
  });
  if ('refused' in out) return out;
  for (const [i, t] of out.targets.entries()) {
    const res = await new File(files[i].uri).upload(t.url, { httpMethod: 'PUT', mimeType: files[i].type, headers: { 'x-upsert': 'false' } });
    if (res.status < 200 || res.status >= 300) throw new ApiError(res.status, 'upload_failed');
  }
  return out.targets.map((t) => t.path);
}

// FOUNDER on Android (Google Play has no discount codes): checked here first.
export const founderCode = (r: string, code: string) => api<{ ok: true; offer: string } | { ok: false; reason: string }>('/api/app/billing/founder', { method: 'POST', body: { r, code } });

// Delete account (Apple's rule): the website's close-account flow.
export const getClosing = (r: string) => api<{ closing: { closesAt: string | null; status: string } | null }>(`/api/app/account/delete${q(r)}`);
export const deleteAccount = (r: string, typedName: string) =>
  api<{ closesAt: string; now: boolean; storeNote: string | null } | { refused: string }>('/api/app/account/delete', { method: 'POST', body: { r, typedName } });
export const cancelDelete = (r: string) => api<{ cancelled: boolean } | { refused: string }>(`/api/app/account/delete${q(r)}`, { method: 'DELETE' });

// ---------- Reports and More (phase 5) ----------

export type ReportItem = { token: string; kind: 'weekly' | 'monthly'; label: string; createdAt: string };
export const getReports = (r: string | null) => api<{ restaurantId: string; reports: ReportItem[] }>(`/api/app/reports${q(r)}`);

// A report's saved snapshot, as the website draws it (types in the web app's lib/report/).
export type Compare = { now: number; before: number };
export type Daily = { days: string[]; values: number[] };
export type ReportStat = { label: string; value: Compare; format: 'rating' | 'count' | 'money' };
export type ReportAction = { title: string; why: string; message: string };
export type WeeklySection = { id: string; [k: string]: unknown };
export type WeeklyData = { version: 1; restaurant: { name: string; brandColor: string }; period: { start: string; end: string; label: string; prevLabel: string }; sections: WeeklySection[]; simulated?: string | null };
export type MonthlyData = {
  kind: 'monthly';
  restaurant: { name: string; brandColor: string };
  figures: {
    label: string;
    net: number;
    traded: number;
    days: number;
    orders: number | null;
    avgOrder: number | null;
    daily: { day: string; net: number | null }[];
    vsLastMonth: { label: string; net: number; likeForLike: number | null } | null;
    vsLastYear: { label: string; net: number; likeForLike: number | null } | null;
    weekdays: { weekday: string; avg: number | null }[];
    dishes: { top: { item: string; amount: number }[]; rising: { item: string; change: number }[]; falling: { item: string; change: number }[] } | null;
    labour: { cost: number; pct: number; target: number | null } | null;
    reviews: { count: number; average: number | null } | null;
    missing: string[];
  };
  words: { headline: string; summary?: string; highlights?: { title: string; detail: string }[]; actions: ReportAction[] };
  benchmark?: { radiusMiles: number; restaurants: number; rows: { label: string; you: string; nearby: string; position: string }[] } | null;
  simulated?: string | null;
};
export type Report = { token: string; kind: 'weekly' | 'monthly'; data: WeeklyData | MonthlyData; pdfUrl: string; webUrl: string | null };
export const getReport = (r: string | null, token: string) => api<Report>(`/api/app/reports/${encodeURIComponent(token)}${q(r)}`);

export type Customers = {
  total: number;
  subscribed: number;
  matching: number;
  page: number;
  pageSize: number;
  customers: { id: string; name: string | null; email: string | null; joined: string; status: string }[];
  signupUrl: string;
  qrSvg: string;
  qrPackUrl: string;
};
export const getCustomers = (r: string | null, search: string, page = 0) =>
  api<Customers>(`/api/app/customers${q(r)}${r ? '&' : '?'}q=${encodeURIComponent(search)}&page=${page}`);
export const exportCustomers = (r: string | null) => api<{ url: string }>(`/api/app/customers/export${q(r)}`, { method: 'POST' });

export type AlertKind = 'brief' | 'urgent' | 'updates' | 'reports' | 'nudge';
export type Settings = {
  hours: { day: string; value: string }[];
  signupReward: string;
  discountCap: number;
  sendWindow: { start: string; end: string };
  quietHours: { start: string; end: string };
  briefHour: number;
  voice: { signOffName: string; greeting: string; wordsToAvoid: string; emoji: { reviewReplies: number; posts: number; campaigns: number } };
  paused: boolean;
  alerts: Record<AlertKind, boolean>;
};
export type SettingsChange = Partial<{
  hours: { day: string; value: string }[];
  signupReward: string;
  discountCap: number;
  sendWindow: { start: string; end: string };
  quietHours: { start: string; end: string };
  briefHour: number;
  voice: Partial<{ signOffName: string; greeting: string; wordsToAvoid: string; emoji: Partial<Settings['voice']['emoji']> }>;
  alerts: Partial<Record<AlertKind, boolean>>;
}>;
export const getSettings = (r: string | null) => api<Settings>(`/api/app/settings${q(r)}`);
export const saveSettings = (r: string | null, change: SettingsChange) => api<Settings | { problem: string }>(`/api/app/settings${q(r)}`, { method: 'POST', body: change });
export const setPaused = (r: string | null, paused: boolean) => api<{ paused: boolean; released: number }>(`/api/app/pause${q(r)}`, { method: 'POST', body: { paused } });
export const getReferral = (r: string | null) => api<{ code: string; link: string }>(`/api/app/refer${q(r)}`);
export const getHelp = () => api<{ markdown: string; supportEmail: string }>('/api/app/help');

// ---------- The rota (Reports > Rota, and Today) ----------

export type AppShift = { name: string | null; role: string; time: string; hours: number };
export type AppRotaDay = { date: string; label: string; closed: boolean; shifts: AppShift[]; hours: number; costPence: number; labourPct: number | null };
export type AppRotaWeek = {
  weekStart: string;
  label: string;
  status: 'approved' | 'waiting' | 'none';
  draftId: string | null;
  days: AppRotaDay[];
  totals: { hours: number; costPence: number; labourPct: number | null; target: number | null; overTarget: boolean } | null;
  flags: string[];
  openShifts: number;
  shareUrl: string | null;
};
export type TodayRota = { date: string; closed: boolean; suggested: boolean; shifts: AppShift[] } | null;
export const getRota = (r: string | null) => api<{ today: string; thisWeek: AppRotaWeek; nextWeek: AppRotaWeek }>(`/api/app/rota${q(r)}`);
