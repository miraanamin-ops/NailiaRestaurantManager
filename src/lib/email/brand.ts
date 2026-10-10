// A restaurant's look and tone for emails, from what onboarding and the settings
// page saved (logo, colours, voice). Plain code with no imports (unit-tested).

export type BrandInput = {
  name: string;
  tagline: string | null;
  address: string | null;
  logo_url: string | null;
  brand_color: string | null;
  brand_dark: string | null;
  brand_voice: string | null;
  owner_name: string | null;
};

export type Tone = "warm" | "polished" | "playful";

export type Brand = {
  name: string;
  tagline: string | null;
  address: string | null;
  logoUrl: string | null;
  color: string; // buttons and accents
  onColor: string; // text on buttons: white or near-black, whichever reads better
  dark: string; // the header band
  onDark: string;
  tone: Tone;
  signOff: string; // e.g. "See you soon,\nAmina and the Ember & Spice team"
};

const DEFAULT_COLOR = "#c2410c";
const DEFAULT_DARK = "#1c1917";

export function validHex(s: string | null | undefined) {
  const v = (s ?? "").trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${[...v.slice(1)].map((c) => c + c).join("")}`.toLowerCase();
  return null;
}

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

// White text unless dark text reads clearly better (e.g. a yellow brand colour).
export function textOn(bg: string) {
  return contrast(bg, "#ffffff") >= 3 || contrast(bg, "#ffffff") >= contrast(bg, "#1c1917") ? "#ffffff" : "#1c1917";
}

// The tone of the fixed wording (confirm, welcome, feedback emails), from the brand voice.
export function toneFor(voice: string | null): Tone {
  const v = (voice ?? "").toLowerCase();
  if (/\b(playful|cheeky|fun|banter|witty|quirky|bold|loud)\b/.test(v)) return "playful";
  if (/\b(elegant|refined|polished|premium|sophisticated|formal|understated|luxur|fine dining|classic)\w*/.test(v)) return "polished";
  return "warm";
}

export function brandFor(r: BrandInput): Brand {
  const color = validHex(r.brand_color) ?? DEFAULT_COLOR;
  const dark = validHex(r.brand_dark) ?? DEFAULT_DARK;
  const tone = toneFor(r.brand_voice);
  const first = (r.owner_name ?? "").trim().split(/\s+/)[0];
  const team = `the ${r.name} team`;
  const who = first ? `${first} and ${team}` : team[0].toUpperCase() + team.slice(1);
  const signOff = tone === "polished" ? `With warm regards,\n${who}` : tone === "playful" ? `Catch you soon!\n${who}` : `See you soon,\n${who}`;
  return {
    name: r.name,
    tagline: r.tagline,
    address: r.address,
    logoUrl: r.logo_url && /^https:\/\//.test(r.logo_url) ? r.logo_url : null,
    color,
    onColor: textOn(color),
    dark,
    onDark: textOn(dark),
    tone,
    signOff,
  };
}

// The fixed lines in each tone. No AI: these reach customers without an approval step.
export const COPY: Record<Tone, {
  confirmHeading: (first: string) => string;
  confirmBody: (restaurant: string, reward: string) => string;
  welcomeHeading: (first: string) => string;
  welcomeBody: (reward: string) => string;
  feedbackHeading: (first: string) => string;
  feedbackBody: (restaurant: string) => string;
}> = {
  warm: {
    confirmHeading: (f) => `Nearly there, ${f}!`,
    confirmBody: (r, w) => `Thanks for signing up at ${r}. Tap the button below to confirm your email, and we'll send ${w} straight over.`,
    welcomeHeading: (f) => `Welcome, ${f}!`,
    welcomeBody: (w) => `Thanks for joining us. Your welcome reward is ${w}, on the house.`,
    feedbackHeading: (f) => `How was your visit, ${f}?`,
    feedbackBody: (r) => `Thanks for coming to ${r} today. We'd love to know how it went: it only takes a moment.`,
  },
  polished: {
    confirmHeading: (f) => `Please confirm your email, ${f}`,
    confirmBody: (r, w) => `Thank you for joining ${r}. Please confirm your email address below and we'll send ${w} to you.`,
    welcomeHeading: (f) => `Welcome, ${f}`,
    welcomeBody: (w) => `Thank you for joining us. Your welcome reward is ${w}, with our compliments.`,
    feedbackHeading: (f) => `Thank you for visiting, ${f}`,
    feedbackBody: (r) => `We hope you enjoyed your time at ${r}. We would be grateful to hear how your visit was.`,
  },
  playful: {
    confirmHeading: (f) => `One tap to go, ${f}!`,
    confirmBody: (r, w) => `You're almost on the ${r} list. Confirm your email and ${w} is all yours.`,
    welcomeHeading: (f) => `You're in, ${f}!`,
    welcomeBody: (w) => `Welcome to the gang. Your reward is ${w}, and it's on us.`,
    feedbackHeading: (f) => `So, how did we do, ${f}?`,
    feedbackBody: (r) => `Thanks for popping into ${r}. Tell us how it went: good, bad or somewhere in between.`,
  },
};
