// Opening a page from the app (phase 2 of the Inbox and emails plan, 15 Nov 2026).
// Our own pages open in the app's own browser already logged in (a one-time link from
// /api/app/web-link), so the owner never pastes a link or logs in again. Anything else
// (and our page when no such link can be made) opens as it is.
import * as WebBrowser from 'expo-web-browser';

import { api, API_URL } from '@/lib/api';

const ours = (url: string) => url.startsWith('/') || url.startsWith(`${API_URL}/`);
const pathOf = (url: string) => (url.startsWith('/') ? url : url.slice(API_URL.length));

// Public pages need no login (sign-up, terms, the QR pack, signed links).
const PUBLIC = /^\/(login|start|terms|privacy|dpa|r\/|rota\/|templates\/|export\/download|api\/)/;

export async function openPage(url: string) {
  const full = url.startsWith('/') ? `${API_URL}${url}` : url;
  const path = ours(url) ? pathOf(url) : null;
  if (path && !PUBLIC.test(path)) {
    try {
      const out = await api<{ url: string | null }>('/api/app/web-link', { method: 'POST', body: { path } });
      if (out.url) return void (await WebBrowser.openBrowserAsync(out.url));
    } catch {
      // Fall through: the page itself (it asks for a login).
    }
  }
  await WebBrowser.openBrowserAsync(full);
}

// Splits text into plain parts and links, for a chat message whose links can be tapped.
export function withLinks(text: string): { text: string; url?: string }[] {
  const parts: { text: string; url?: string }[] = [];
  const re = /https?:\/\/[^\s)<>]+[^\s)<>.,;:!?'"]/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) parts.push({ text: text.slice(last, m.index) });
    parts.push({ text: m[0], url: m[0] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}
