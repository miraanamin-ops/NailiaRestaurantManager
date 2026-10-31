import "server-only";
import { logAction } from "@/lib/audit";
import { sendOwnerEmail } from "@/lib/email";
import { google, googleModeFor } from "@/lib/google";
import { appUrl, getSupabase } from "@/lib/supabase";
import { stepState } from "../flow";
import { completeStep, getSession, loadFlow, noteStep, patchStepData, skipStep, waitOnStep, type Channel } from "../sessions";
import { getRestaurant } from "../store";
import { acceptedText, averageRating, googleNudgeDue, NUDGE_TEXT, stepsEmail, type Device } from "./google-content";
import type { GoogleNotes } from "./reply";
import { sayFromCode } from "./say";
import { managerEmail } from "./setup-config";

// Step 2, adding DinerAI on Google. Dina asks the three questions and shows the
// steps; code does everything that changes something:
//   her google_notes  -> the answers saved; "no profile" skips the step (a setup
//                        gap); "not an owner on it" waits on whoever is
//   "Done, I've invited you" -> waiting on Google; in dummy mode Google's
//                        acceptance is simulated at once
//   "Email me these steps" -> the steps by email
//   accepted (the builder, Connect Google, or simulated) -> done, with the
//                        number of reviews and the rating, and Google's 7-day wait
//   24 hours on, one nudge (WhatsApp in its window, otherwise email)

type Notes = NonNullable<import("zod").infer<typeof GoogleNotes>>;

export async function applyGoogleNotes(restaurantId: string, notes: Notes, channel: Channel) {
  const { state } = await loadFlow(restaurantId);
  const before = (stepState(state, "google").data.answers ?? {}) as Notes;
  const answers = { ...before, ...notes };
  await noteStep(restaurantId, "google", { answers, ...(notes.device ? { steps_shown_at: new Date().toISOString() } : {}) }, { channel });
  if (notes.has_profile === "no") await skipStep(restaurantId, "google", { channel });
  else if (notes.is_owner === "no" || notes.is_owner === "not_sure") await waitOnStep(restaurantId, "google", "profile_owner", { answers }, { channel });
}

// "Done, I've invited you". Returns what Dina is told.
export async function googleInvited(restaurantId: string, channel: Channel) {
  await waitOnStep(restaurantId, "google", "google", { invited_at: new Date().toISOString() }, { channel });
  if ((await googleModeFor(restaurantId)) === "dummy") {
    const text = await markGoogleAccepted(restaurantId, { by: "simulated", quiet: true });
    return `The owner tapped "Done, I've invited you". In test mode Google's acceptance is simulated, so DinerAI is in now. Tell them in these words (you may add one short line after): "${text}"`;
  }
  return 'The owner tapped "Done, I\'ve invited you". The Google step now waits on our side to accept the invite (usually within a day). Say you\'ll let them know when you\'re in, then carry on with the next step.';
}

// "Email me these steps". Returns what Dina is told.
export async function emailGoogleSteps(restaurantId: string, opts: { nudge?: boolean } = {}) {
  const r = await getRestaurant(restaurantId);
  const { state } = await loadFlow(restaurantId);
  const device = ((stepState(state, "google").data.answers as Notes | undefined)?.device ?? "laptop") as Device;
  const email = await managerEmail();
  if (!email) return "The owner asked for the steps by email, but our manager email isn't set up yet, so nothing was sent. Say sorry and that the steps above are all they need.";
  const sent = await sendOwnerEmail(r, stepsEmail({ restaurantName: r.name, device, managerEmail: email, appUrl: appUrl(), nudge: opts.nudge }));
  await patchStepData(restaurantId, "google", { steps_emailed_at: new Date().toISOString() });
  return sent.delivery === "email"
    ? "Code has emailed the owner these steps. Say so in a few words."
    : "The owner asked for the steps by email, but there's no email address we can send to. Say so in a few words and that the steps above are all they need.";
}

// We're a manager on their profile. quiet: the turn that caused it tells the owner
// (the simulated acceptance); otherwise code says it in the conversation.
export async function markGoogleAccepted(restaurantId: string, opts: { by: "builder" | "connected" | "simulated"; quiet?: boolean }) {
  const reviews = await google()
    .listReviews(restaurantId)
    .catch(() => []);
  const summary = { count: reviews.length, average: averageRating(reviews.map((r) => r.rating)) };
  const text = acceptedText(summary);
  await completeStep(restaurantId, "google", "done", { accepted_at: new Date().toISOString(), accepted_by: opts.by, reviews: summary });
  await logAction({ restaurantId, actor: opts.by === "builder" ? "builder" : "owner", action: "google", detail: `Google profile access ${opts.by === "simulated" ? "accepted (simulated, test mode)" : "accepted"} during setup` });
  if (!opts.quiet) await sayFromCode(restaurantId, text);
  return text;
}

// After "Connect Google" (Path A) links a location: done, if they're setting up with Dina.
export async function afterGoogleConnected(restaurantId: string) {
  const session = await getSession(restaurantId);
  if (!session || session.completed_at) return;
  const { state } = await loadFlow(restaurantId);
  if (stepState(state, "google").status === "done") return;
  await markGoogleAccepted(restaurantId, { by: "connected" });
}

// ---------- The 24-hour nudge (the setup_nudges job, hourly) ----------

type StepRow = { restaurant_id: string; status: string; waiting_on: string | null; data: Record<string, unknown> | null };

export async function runGoogleNudges(now = new Date()) {
  const supabase = getSupabase();
  // Every restaurant: only setups in progress have an in-progress Google step.
  const { data, error } = await supabase.from("onboarding_steps").select("restaurant_id, status, waiting_on, data").eq("step_key", "google").eq("status", "in_progress").returns<StepRow[]>();
  if (error) throw new Error(error.message);
  const results: { restaurant: string; sent?: "whatsapp" | "email" | "none"; error?: string }[] = [];
  for (const row of data ?? []) {
    const due = googleNudgeDue({ status: row.status, waitingOn: row.waiting_on, data: row.data ?? {} }, now);
    if (!due) continue;
    try {
      const r = await getRestaurant(row.restaurant_id);
      const session = await getSession(row.restaurant_id);
      if (r.active || !session || session.completed_at) continue;
      // Marked first: a failure below never means a second nudge.
      await patchStepData(row.restaurant_id, "google", { nudged_at: now.toISOString(), nudge_reason: due });
      // In the chat either way; on WhatsApp inside its window, otherwise by email with the steps.
      const { whatsapp } = await sayFromCode(row.restaurant_id, NUDGE_TEXT, now);
      const sent = whatsapp ? "whatsapp" : (await emailGoogleSteps(row.restaurant_id, { nudge: true })).startsWith("Code has emailed") ? "email" : "none";
      results.push({ restaurant: row.restaurant_id, sent });
    } catch (err) {
      results.push({ restaurant: row.restaurant_id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}
