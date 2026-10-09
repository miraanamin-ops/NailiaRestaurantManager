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
  if (!url) return "";
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    if (!isPublicWebAddress(u)) return "";
    const res = await fetch(u, { headers: { "User-Agent": "NailaBot/1.0 (restaurant onboarding)" }, signal: AbortSignal.timeout(8000), redirect: "follow" });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/html")) return "";
    const buf = await res.arrayBuffer();
    return textFromHtml(new TextDecoder().decode(buf.slice(0, MAX_BYTES)));
  } catch (err) {
    console.warn("Couldn't read the website", err instanceof Error ? err.message : err);
    return "";
  }
}
