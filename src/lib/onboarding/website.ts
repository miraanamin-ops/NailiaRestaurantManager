import "server-only";

// Reads the words on a restaurant's website (for its brand voice). Only the
// public page text: no scripts, styles or markup, at most a few thousand characters.
const MAX_BYTES = 500_000;
const MAX_CHARS = 5000;

export function textFromHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CHARS);
}

// Only ordinary public websites: never this server, a local network or a cloud metadata address.
export function isPublicWebAddress(u: URL) {
  if (!/^https?:$/.test(u.protocol)) return false;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".")) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
  }
  if (h.startsWith("[") || h.includes(":")) return false; // no raw IPv6 addresses
  return true;
}

export async function readWebsite(url: string | null): Promise<string> {
  return (await readWebsitePage(url)).text;
}

// The page's words (for the voice) and its markup (for the logo and colour).
export async function readWebsitePage(url: string | null): Promise<{ text: string; html: string; url: string | null }> {
  const empty = { text: "", html: "", url: null };
  if (!url) return empty;
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    if (!isPublicWebAddress(u)) return empty;
    const res = await fetch(u, { headers: { "User-Agent": "NailaBot/1.0 (restaurant onboarding)" }, signal: AbortSignal.timeout(8000), redirect: "follow" });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/html")) return empty;
    const buf = await res.arrayBuffer();
    const html = new TextDecoder().decode(buf.slice(0, MAX_BYTES));
    return { text: textFromHtml(html), html, url: res.url || u.toString() };
  } catch (err) {
    console.warn("Couldn't read the website", err instanceof Error ? err.message : err);
    return empty;
  }
}

// The site's own colour (<meta name="theme-color">) and logo (an apple-touch-icon
// or a large icon), for the restaurant's emails. Plain code (unit-tested).
export function brandFromHtml(html: string, pageUrl: string) {
  const attr = (tag: string, name: string) => tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1] ?? null;
  const tags = html.match(/<(meta|link)\b[^>]*>/gi) ?? [];
  const theme = tags.find((t) => /^<meta/i.test(t) && /name\s*=\s*["']theme-color["']/i.test(t));
  const color = theme ? attr(theme, "content")?.trim().toLowerCase() ?? null : null;
  const icons = tags
    .filter((t) => /^<link/i.test(t) && /rel\s*=\s*["'][^"']*(apple-touch-icon|icon)[^"']*["']/i.test(t))
    .map((t) => ({ href: attr(t, "href"), apple: /apple-touch-icon/i.test(t), size: Number(attr(t, "sizes")?.match(/(\d+)x/)?.[1] ?? 0), svg: /\.svg(\?|$)/i.test(attr(t, "href") ?? "") || /svg/i.test(attr(t, "type") ?? "") }))
    .filter((i) => i.href && !i.svg && !i.href.startsWith("data:") && (i.apple || i.size >= 96));
  icons.sort((a, b) => Number(b.apple) - Number(a.apple) || b.size - a.size);
  let logo: string | null = null;
  try {
    logo = icons[0]?.href ? new URL(icons[0].href, pageUrl).toString() : null;
  } catch {
    logo = null;
  }
  return { color: color && /^#[0-9a-f]{6}$/.test(color) ? color : null, logo };
}
