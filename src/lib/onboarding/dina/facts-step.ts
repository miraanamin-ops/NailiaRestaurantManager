import "server-only";
import { saveProfileFields } from "@/lib/profile-edits";
import { stepState } from "../flow";
import type { Hours } from "../profile-data";
import { completeStep, loadFlow, noteStep, type Channel } from "../sessions";
import { getRestaurant } from "../store";
import { FAQ_IDS, FAQ_SKIPPED, faqsLeft, hoursFromNotes, offerProblems } from "./facts-content";

// Steps 4 and 6: what's saved, checked in code. Dina asks; these save.
//   4. save_make_it_right (her tool): the offers (none over the discount cap) and
//      who handles complaints, into the profile (recovery offers, complaint contact)
//   6. her hours_notes -> a draft for the hours card; "Looks right" saves the
//      hours; her faq_notes -> the answers, saved as they come (halal also as the
//      halal statement, in the owner's words). Done once the hours are confirmed
//      and all seven questions are answered (or passed on).

const DEFAULT_CAP = 15;

export async function saveMakeItRight(restaurantId: string, input: { offers: string[]; handler: string; contact?: string | null }, channel: Channel) {
  const r = await getRestaurant(restaurantId);
  const cap = r.discount_cap_percent ?? DEFAULT_CAP;
  const problems = offerProblems(input.offers, cap);
  if (problems.length) return { ok: false as const, text: `Not saved: ${problems.join(" ")} Ask the owner for something within the cap (or to raise the cap later in settings).` };
  const contact = [input.handler.trim(), input.contact?.trim()].filter(Boolean).join(", ");
  await saveProfileFields(r, { recovery_offers: input.offers.map((o) => o.trim()), complaint_contact: contact }, "Making it right, with Dina at setup");
  const { session } = await completeStep(restaurantId, "make_it_right", "done", { offers: input.offers, handler: input.handler, contact: input.contact ?? null }, { channel });
  return { ok: true as const, text: `Saved: ${input.offers.length} offer${input.offers.length === 1 ? "" : "s"}, complaints go to ${contact}. Making it right is done. The next step is ${session.current_step ?? "none"}.` };
}

type HoursFaqsData = { hours_draft?: Hours; hours_confirmed?: boolean; answers?: Record<string, string> };
const hfData = async (restaurantId: string) => stepState((await loadFlow(restaurantId)).state, "hours_faqs").data as HoursFaqsData;

// Her hours_notes: tidied and kept as a draft for the hours card (problems back to her via the log).
export async function applyHoursNotes(restaurantId: string, notes: Record<string, string>, channel: Channel) {
  const { hours, problems } = hoursFromNotes(notes);
  if (problems.length) console.warn("Some hours weren't clear", problems);
  if (!Object.keys(hours).length) return;
  const data = await hfData(restaurantId);
  const r = await getRestaurant(restaurantId);
  await noteStep(restaurantId, "hours_faqs", { hours_draft: { ...(data.hours_draft ?? (r.opening_hours as Hours) ?? {}), ...hours } }, { channel });
}

// "Looks right" on the hours card. Returns what Dina is told.
export async function confirmHours(restaurantId: string, channel: Channel) {
  const data = await hfData(restaurantId);
  const r = await getRestaurant(restaurantId);
  const hours = data.hours_draft ?? (r.opening_hours as Hours) ?? {};
  if (!Object.keys(hours).length) return "There are no hours to save yet. Ask for them, day by day.";
  await saveProfileFields(r, { opening_hours: hours }, "Hours confirmed with Dina at setup");
  await noteStep(restaurantId, "hours_faqs", { hours_confirmed: true }, { channel });
  return `${await maybeFinish(restaurantId, channel, { ...data, hours_confirmed: true })} Code saved their opening hours.`;
}

// Her faq_notes: each answer in the owner's words. Halal is also the halal statement.
export async function applyFaqNotes(restaurantId: string, notes: Record<string, string>, channel: Channel) {
  const fresh = Object.fromEntries(Object.entries(notes).filter(([k, v]) => (FAQ_IDS as string[]).includes(k) && v?.trim()).map(([k, v]) => [k, v.trim().slice(0, 300)]));
  if (!Object.keys(fresh).length) return;
  const r = await getRestaurant(restaurantId);
  const faqs = { ...(r.faqs ?? {}), ...fresh };
  const halal = fresh.halal && fresh.halal !== FAQ_SKIPPED ? fresh.halal : undefined;
  await saveProfileFields(r, { faqs, ...(halal ? { halal_statement: halal } : {}) }, "Common questions, with Dina at setup");
  const data = await hfData(restaurantId);
  await noteStep(restaurantId, "hours_faqs", { answers: { ...(data.answers ?? {}), ...fresh } }, { channel });
  await maybeFinish(restaurantId, channel, { ...data, answers: { ...(data.answers ?? {}), ...fresh } });
}

async function maybeFinish(restaurantId: string, channel: Channel, data: HoursFaqsData) {
  const left = faqsLeft(data.answers);
  if (!data.hours_confirmed) return "";
  if (left.length) return `Next, the common questions: ${left.length} left (${left.map((t) => t.label).join(", ")}).`;
  await completeStep(restaurantId, "hours_faqs", "done", { hours_confirmed: true, answers: data.answers }, { channel });
  return "Hours and FAQs are done.";
}
