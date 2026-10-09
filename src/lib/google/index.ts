import "server-only";
import { dummyGoogle } from "./dummy";
import { liveGoogle } from "./live";
import type { GoogleConnector } from "./types";

export type { GoogleConnector, GooglePost, GoogleReview, PostTopic } from "./types";

// The only way the app talks to Google. Switching to the real API later is
// one setting: GOOGLE_MODE=live (once live.ts is built).
export function google(): GoogleConnector {
  return process.env.GOOGLE_MODE === "live" ? liveGoogle : dummyGoogle;
}
