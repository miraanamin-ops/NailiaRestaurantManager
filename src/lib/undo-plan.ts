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
  | { type: "rota_unpublish" } // an approved rota: back to a draft, its link switched off
  | { type: "rota_edit"; adjustments: unknown[] } // a rota edit: the edits as they were, re-filled
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
  // Profile v1 (settings page)
  "sign_off_name",
  "greeting",
  "complaint_contact",
  "halal_statement",
  "allergen_statement",
  "recovery_offers",
  "words_to_avoid",
  "emoji_allowed",
];

export const GOOGLE_KINDS = ["review_reply", "google_post", "hours_update", "menu_update"];

// googleMode: the restaurant's Google (lib/google/index.ts googleModeFor).
export function undoPlan(entry: UndoEntry, draft: UndoDraft | null, googleMode: "dummy" | "simulated" | "live"): UndoPlan {
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

  // A rota: approving published it (nothing was sent), an edit re-filled it.
  if (draft.kind === "rota") {
    if (entry.action === "approved") {
      return draft.status === "approved" ? { type: "rota_unpublish" } : { type: "cannot", reason: `It's no longer approved (it's ${draft.status}).` };
    }
    if (entry.action === "edited") {
      if (!Array.isArray(entry.data?.before_adjustments)) return { type: "cannot", reason: "The earlier version wasn't saved." };
      return draft.status === "pending"
        ? { type: "rota_edit", adjustments: entry.data.before_adjustments }
        : { type: "cannot", reason: `It's already ${draft.status}, so the earlier version can't be put back.` };
    }
  }

  if (entry.action === "approved") {
    if (draft.status === "queued" || draft.status === "blocked" || draft.status === "approved") return { type: "reopen" };
    if (draft.status === "withdrawn") return { type: "cannot", reason: "It's already been taken back." };
    if (draft.status !== "sent") return { type: "cannot", reason: `It's no longer approved (it's ${draft.status}).` };
    if (draft.kind === "email_campaign") {
      return { type: "cannot", reason: "The emails have already been sent, and emails can't be unsent." };
    }
    // Simulated Google posted nothing, so there's nothing to take down.
    if (googleMode === "simulated" && GOOGLE_KINDS.includes(draft.kind)) return { type: "withdraw_simulated" };
    // Dummy and live: replies and posts can be deleted (live: through the API).
    if (draft.kind === "review_reply" && draft.review_id) return { type: "withdraw_reply" };
    if (draft.kind === "google_post") return { type: "withdraw_post" };
    if (draft.kind === "hours_update" && googleMode === "live") {
      return { type: "cannot", reason: 'Your hours are already changed on Google, and Google can\'t be put back automatically. Text the old hours (e.g. "change Friday hours to 11pm") and I\'ll update Google again.' };
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
