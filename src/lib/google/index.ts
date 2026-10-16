import "server-only";
import { googleSwitch } from "@/lib/switches";
import { dummyGoogle } from "./dummy";
import { liveGoogle } from "./live";
import type { GoogleConnector } from "./types";

export type { GoogleConnector, GooglePost, GoogleReview, PostTopic } from "./types";

// The only way the app talks to Google, by GOOGLE_MODE (lib/switches.ts):
// dummy (default) uses our own database; simulated reads live Google, and the
// send gate (lib/send.ts) posts nothing; live reads and writes (once live.ts is built).
export function google(): GoogleConnector {
  return googleSwitch(process.env).mode === "dummy" ? dummyGoogle : liveGoogle;
}
