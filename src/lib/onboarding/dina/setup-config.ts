import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { managerConnection } from "@/lib/google/connections";
import { oauthConfigured } from "@/lib/google/oauth";
import { parseTones, type ToneConfig } from "./tones";

// What the Google and tone steps need from outside the conversation: the tone
// config file, DinerAI's Google manager email, and whether "Connect Google"
// (Path A, OAuth) is offered.

let tones: ToneConfig | null = null;

// agents/tones.config.json, read once per server instance (bundled: next.config.ts).
export function toneConfig(): ToneConfig {
  if (process.env.NODE_ENV === "development") tones = null;
  tones ??= parseTones(JSON.parse(readFileSync(join(process.cwd(), "agents", "tones.config.json"), "utf8")));
  return tones;
}

// The email owners invite as a Manager (Path B): the setting, else our manager account's.
export async function managerEmail(): Promise<string | null> {
  const set = process.env.GOOGLE_MANAGER_EMAIL?.trim();
  if (set) return set;
  return (await managerConnection().catch(() => null))?.google_email ?? null;
}

// Path A behind its own switch (ONBOARDING_GOOGLE_CONNECT=true) and only once
// Google sign-in is set up: until then owners add us as a manager (Path B).
export const googleConnectOn = () => process.env.ONBOARDING_GOOGLE_CONNECT?.trim().toLowerCase() === "true" && oauthConfigured();

// The Google settings page signs them in and picks the location, then sends them back to the chat.
export const googleConnectHref = (restaurantId: string) => (googleConnectOn() ? `/settings/google?r=${restaurantId}&back=onboarding` : null);

export async function setupExtras(restaurantId: string) {
  return { managerEmail: await managerEmail(), googleConnectHref: googleConnectHref(restaurantId), tones: toneConfig() };
}
