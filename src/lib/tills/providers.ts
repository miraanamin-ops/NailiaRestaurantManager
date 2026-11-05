// The four tills we connect to directly, how each one connects, and whether
// this deployment has its keys. Pure (reads only the env passed in), unit-tested.
import type { TillProvider } from "./types";

type Env = Record<string, string | undefined>;

export type ConnectMethod =
  | "oauth" // the owner taps Connect and signs in to their till (Square, Lightspeed)
  | "api_key" // the owner pastes an API key and secret from their back office (Epos Now)
  | "partner"; // the owner switches us on inside their till; DinerAI links it (Toast)

export type ProviderInfo = {
  id: TillProvider;
  name: string;
  method: ConnectMethod;
  // Settings this deployment needs before live connections work.
  env: string[];
  // What the owner does, in one line, on the settings page.
  howTo: string;
};

export const PROVIDERS: Record<TillProvider, ProviderInfo> = {
  square: {
    id: "square",
    name: "Square",
    method: "oauth",
    env: ["SQUARE_APPLICATION_ID", "SQUARE_APPLICATION_SECRET"],
    howTo: "Tap Connect Square, sign in to Square and allow DinerAI to read your orders and items.",
  },
  lightspeed: {
    id: "lightspeed",
    name: "Lightspeed (Restaurant K-Series)",
    method: "oauth",
    env: ["LIGHTSPEED_CLIENT_ID", "LIGHTSPEED_CLIENT_SECRET"],
    howTo: "Tap Connect Lightspeed, sign in to Lightspeed and allow DinerAI to read your sales.",
  },
  eposnow: {
    id: "eposnow",
    name: "Epos Now",
    method: "api_key",
    env: [],
    howTo: "In your Epos Now Back Office go to Apps > API Management (or Setup > API), add a device called DinerAI, then paste its API key and secret here.",
  },
  toast: {
    id: "toast",
    name: "Toast",
    method: "partner",
    env: ["TOAST_CLIENT_ID", "TOAST_CLIENT_SECRET"],
    howTo: "In Toast Web go to Integrations > Integration management, find DinerAI and connect it. We'll then link your restaurant (usually the same day).",
  },
};

export const PROVIDER_ORDER: TillProvider[] = ["square", "eposnow", "lightspeed", "toast"];

export function isProvider(v: unknown): v is TillProvider {
  return typeof v === "string" && v in PROVIDERS;
}

// Settings this deployment still needs for live connections to a provider (empty = ready).
export function missingSettings(provider: TillProvider, env: Env): string[] {
  const missing = PROVIDERS[provider].env.filter((k) => !env[k]?.trim());
  // Stored logins are encrypted: our own key, or Google's.
  if (!env.TILL_TOKEN_KEY?.trim() && !env.GOOGLE_TOKEN_KEY?.trim()) missing.push("TILL_TOKEN_KEY");
  return missing;
}

export const liveReady = (provider: TillProvider, env: Env) => missingSettings(provider, env).length === 0;

// Square's sandbox (pretend shop) unless SQUARE_ENVIRONMENT=production.
export function squareBase(env: Env) {
  const prod = env.SQUARE_ENVIRONMENT?.trim().toLowerCase() === "production";
  return {
    sandbox: !prod,
    api: prod ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com",
  };
}

// Lightspeed's trial (demo) servers unless LIGHTSPEED_ENVIRONMENT=production.
// The auth host for trial can be overridden with LIGHTSPEED_AUTH_HOST if
// Lightspeed gives us a different one with our staging client.
export function lightspeedBase(env: Env) {
  const prod = env.LIGHTSPEED_ENVIRONMENT?.trim().toLowerCase() === "production";
  const auth = env.LIGHTSPEED_AUTH_HOST?.trim() || (prod ? "https://auth.lsk-prod.app" : "https://auth.lsk-demo.app");
  return {
    trial: !prod,
    api: prod ? "https://api.lsk.lightspeed.app" : "https://api.trial.lsk.lightspeed.app",
    authorize: `${auth}/realms/k-series/protocol/openid-connect/auth`,
    token: `${auth}/realms/k-series/protocol/openid-connect/token`,
  };
}

export const eposNowBase = (env: Env) => env.EPOSNOW_API_HOST?.trim() || "https://api.eposnowhq.com";
// Toast gives partners their API host with their credentials (it can differ by region).
export const toastBase = (env: Env) => env.TOAST_API_HOST?.trim() || "https://ws-api.toasttab.com";

// Scopes we ask for: reading only, nothing that can change the till.
export const SQUARE_SCOPES = ["MERCHANT_PROFILE_READ", "ORDERS_READ", "ITEMS_READ"];
export const LIGHTSPEED_SCOPES = ["financial-api", "offline_access"];
