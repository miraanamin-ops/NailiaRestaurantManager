// What UNDO can do about one logged action. Plain code with no imports, so
// every case is unit-tested (tests/undo.test.ts); lib/undo.ts carries it out.

export type UndoEntry = { action: string; data: Record<string, unknown> | null };
export type UndoDraft = { kind: string; status: string; review_id: string | null };

export type UndoPlan =
  | { type: "reopen" } // approved but not sent (queued or blocked): back to pending
  | { type: "withdraw_reply" } // a review reply posted on (dummy) Google: take it down
  | { type: "withdraw_post" } // a Google post published on (dummy) Google: take it down
  | { type: "withdraw_simulated" } // "sent" but only simulated: nothing reached anyone
  | { type: "restore_skip" }
  | { type: "restore_edit" }
  | { type: "restore_setting"; field: string; value: unknown }
  | { type: "staff"; number: string; active: boolean } // ADD STAFF / REMOVE STAFF, reversed
  | { type: "cannot"; reason: string };

// Restaurant details (hours, menu, voice, phone, address, website) come from onboarding,
// "change Friday hours to 11pm" messages and the settings page.
const SETTINGS = [
  "paused",
  "discount_cap_percent",
  "fake_now",
  "signup_reward",
  "owner_email",
  "opening_hours",
  "menu",
  "brand_voice",
  "phone",
  "address",
  "website",
  "logo_url",
  "brand_color",
  "brand_dark",
  "tagline",
  "reply_to_email",
  "feedback_emails",
];

export function undoPlan(entry: UndoEntry, draft: UndoDraft | null, googleMode: "dummy" | "live"): UndoPlan {
  if (entry.action === "setting") {
    const field = String(entry.data?.field ?? "");
    if (!SETTINGS.includes(field)) return { type: "cannot", reason: "That setting can't be changed back automatically." };
    return { type: "restore_setting", field, value: entry.data?.before ?? null };
  }
  if (entry.action === "staff_added" || entry.action === "staff_removed") {
    const number = typeof entry.data?.number === "string" ? entry.data.number : null;
    if (!number) return { type: "cannot", reason: "The number wasn't saved." };
    return { type: "staff", number, active: entry.action === "staff_removed" };
  }
  if (!draft) return { type: "cannot", reason: "That draft no longer exists." };

  if (entry.action === "approved") {
    if (draft.status === "queued" || draft.status === "blocked" || draft.status === "approved") return { type: "reopen" };
    if (draft.status === "withdrawn") return { type: "cannot", reason: "It's already been taken back." };
    if (draft.status !== "sent") return { type: "cannot", reason: `It's no longer approved (it's ${draft.status}).` };
    if (draft.kind === "email_campaign") {
      return { type: "cannot", reason: "The emails have already been sent, and emails can't be unsent." };
    }
    if (draft.kind === "review_reply" && draft.review_id) {
      return googleMode === "dummy"
        ? { type: "withdraw_reply" }
        : { type: "cannot", reason: "The reply is live on Google. Delete it in your Google Business Profile." };
    }
    if (draft.kind === "google_post") {
      return googleMode === "dummy"
        ? { type: "withdraw_post" }
        : { type: "cannot", reason: "The post is live on Google. Delete it in your Google Business Profile." };
    }
    return { type: "withdraw_simulated" };
  }

  if (entry.action === "skipped") {
    return draft.status === "skipped" ? { type: "restore_skip" } : { type: "cannot", reason: `It's no longer skipped (it's ${draft.status}).` };
  }

  if (entry.action === "edited") {
    if (typeof entry.data?.before_content !== "string") return { type: "cannot", reason: "The earlier version wasn't saved." };
    return draft.status === "pending"
      ? { type: "restore_edit" }
      : { type: "cannot", reason: `It's already ${draft.status}, so the earlier version can't be put back.` };
  }
  return { type: "cannot", reason: "That kind of action can't be undone." };
}
