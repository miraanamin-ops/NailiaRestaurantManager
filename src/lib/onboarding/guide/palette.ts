// The owner's colours, read from their website first (owner's call, 7 Nov 2026):
// a main colour (buttons and accents) and a second colour (the header band and
// QR codes, so it must be dark enough for white text). Plain code with no
// imports, unit-tested (tests/guide-palette.test.ts).

export type Palette = { id: string; main: string; second: string; from: "website" | "suggested" };

const hex6 = (h: string) => {
  const v = h.toLowerCase();
  return v.length === 4 ? `#${[...v.slice(1)].map((c) => c + c).join("")}` : v;
};

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (n: number[]) => `#${n.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("")}`;

function hsl(hex: string) {
  const [r, g, b] = rgb(hex).map((x) => x / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const s = max === min ? 0 : l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
  let h = 0;
  if (max !== min) h = max === r ? (g - b) / (max - min) + (g < b ? 6 : 0) : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
  return { h: h * 60, s, l };
}

function luminance(hex: string) {
  const [r, g, b] = rgb(hex).map((c) => c / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const contrastWithWhite = (hex: string) => 1.05 / (luminance(hex) + 0.05);

// A darker shade of a colour, for the second colour when the website has none.
export function darken(hex: string, amount = 0.55) {
  return toHex(rgb(hex).map((c) => c * (1 - amount)));
}

// Every colour a page uses, most used first: the theme colour, then hex and rgb()
// values in its HTML and stylesheets. Near-white and near-black don't count (every
// site has them); greys don't either.
export function coloursIn(texts: string[], theme: string | null = null): string[] {
  const counts = new Map<string, number>();
  const add = (c: string, n = 1) => counts.set(c, (counts.get(c) ?? 0) + n);
  for (const t of texts) {
    for (const m of t.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) add(hex6(`#${m[1]}`));
    for (const m of t.matchAll(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/gi)) add(toHex([Number(m[1]), Number(m[2]), Number(m[3])]));
  }
  if (theme && /^#[0-9a-f]{6}$/i.test(theme)) add(theme.toLowerCase(), 1000);
  return [...counts.entries()]
    .filter(([c]) => {
      const { s, l } = hsl(c);
      return l > 0.08 && l < 0.92 && s > 0.18;
    })
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => c);
}

// Two colours that look different enough to be two choices.
function distinct(a: string, b: string) {
  const [x, y] = [rgb(a), rgb(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) > 60;
}

// The second colour: the darkest of the site's colours that white text reads on,
// else a dark shade of the main colour.
function secondFor(main: string, colours: string[]) {
  const dark = colours.filter((c) => c !== main && contrastWithWhite(c) >= 7 && distinct(c, main)).sort((a, b) => luminance(a) - luminance(b))[0];
  return dark ?? (contrastWithWhite(main) >= 7 ? "#1c1917" : darken(main));
}

// Up to three choices from the website, then our default, so there is always one.
export const DEFAULT_PALETTE: Palette = { id: "default", main: "#c2410c", second: "#1c1917", from: "suggested" };

export function paletteChoices(colours: string[]): Palette[] {
  const mains: string[] = [];
  for (const c of colours) if (mains.length < 3 && mains.every((m) => distinct(m, c))) mains.push(c);
  const fromSite = mains.map((main, i) => ({ id: `site_${i + 1}`, main, second: secondFor(main, colours), from: "website" as const }));
  return [...fromSite, ...(fromSite.length < 3 ? [DEFAULT_PALETTE] : [])];
}

// The stylesheets a page links to (first few only, on the same site or a CDN): read alongside the HTML.
export function stylesheetsIn(html: string, pageUrl: string, max = 3): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<link\b[^>]*rel\s*=\s*["'][^"']*stylesheet[^"']*["'][^>]*>/gi)) {
    const href = m[0].match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href || href.startsWith("data:")) continue;
    try {
      const url = new URL(href, pageUrl);
      if (url.protocol === "https:" || url.protocol === "http:") out.push(url.toString());
    } catch {
      // not an address
    }
    if (out.length >= max) break;
  }
  return out;
}
