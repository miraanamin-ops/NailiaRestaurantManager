import { billingStanding, type BillingFields } from "./access";

// What the sign-up form (/start) does for an email it may have seen before, as
// plain code (tests/invites.test.ts). Billing and invite codes are never attached
// to a restaurant that is already running.
//
//   login      the email already has a running restaurant, or one that has paid
//              (or has a pilot code) but not finished setting up: just email a login link
//   continue   carry on with an unfinished, unpaid sign-up (pressing the button twice,
//              or coming back after cancelling Checkout)
//   new        make a new restaurant

export type SignupRow = BillingFields & { id: string; name: string; active: boolean; created_at: string };

export type SignupPlan = { kind: "login"; next: string } | { kind: "continue"; restaurantId: string } | { kind: "new" };

const DAY = 86_400_000;

export function planSignup(rows: SignupRow[], restaurantName: string, now = Date.now()): SignupPlan {
  if (rows.some((r) => r.active)) return { kind: "login", next: "/" };
  const paid = rows.filter((r) => billingStanding(r).ok).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (paid) return { kind: "login", next: `/onboarding?r=${paid.id}` };

  // Unfinished, unpaid sign-ups from the last day: the same name carries on; after
  // 5 of them, everything goes to the newest (one email can't make lots of restaurants).
  const recent = rows.filter((r) => now - Date.parse(r.created_at) < DAY).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const same = recent.find((r) => r.name.trim().toLowerCase() === restaurantName.trim().toLowerCase());
  if (same) return { kind: "continue", restaurantId: same.id };
  if (recent.length >= 5) return { kind: "continue", restaurantId: recent[0].id };
  return { kind: "new" };
}
