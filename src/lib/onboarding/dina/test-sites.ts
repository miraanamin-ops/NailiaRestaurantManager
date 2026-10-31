import "server-only";
import { randomInt } from "node:crypto";
import { logAction } from "@/lib/audit";
import { check } from "@/lib/drafts";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { ourWhatsAppNumber } from "../channel";
import { FLOW_STEPS, gapsFor, progress, stepState, STEP_DEFS, type FlowStepKey } from "../flow";
import { enterStep, loadFlow, startOnboarding } from "../sessions";
import { createRestaurantFromSignup, getRestaurant, updateRestaurantFields } from "../store";
import { markGoogleAccepted } from "./google-step";

// The builder's test controls for setup with Dina (/onboarding/admin): make a
// test restaurant (is_test, always a demo: it can never reach anyone real on any
// channel), reset it to step 1, jump to any step, delete it, link the builder's
// own WhatsApp to it, and mark Google accepted (for any restaurant setting up).
// Every action is in the audit log.

export class TestSiteError extends Error {}

async function testSite(restaurantId: string) {
  const r = await getRestaurant(restaurantId);
  if (!r.is_test) throw new TestSiteError(`${r.name} isn't a test restaurant: only test restaurants can be reset, deleted or linked here`);
  return r;
}

const log = (restaurantId: string, detail: string) => logAction({ restaurantId, actor: "builder", action: "setting", detail });

// A fresh test restaurant, as if someone had signed up: dummy details, exempt from
// billing (so finishing switches it on), setup started on the web.
export async function startTestSite() {
  const n = randomInt(1000, 10000);
  const r = await createRestaurantFromSignup({ ownerName: "Test Owner", email: `test-${n}@dinerai.test`, restaurantName: `Test Kitchen ${n}`, whatsapp: null });
  await updateRestaurantFields(r.id, { is_test: true, is_demo: true, billing_exempt: true } as Partial<Restaurant>);
  await startOnboarding(r.id, { channel: "web" });
  await log(r.id, "Test restaurant made for setup with Dina");
  return r.id;
}

// Back to step 1: the conversation, the steps and the gaps go, and everything the
// steps saved is cleared. The WhatsApp link stays (so the phone can test again).
export async function resetTestSite(restaurantId: string) {
  await testSite(restaurantId);
  const supabase = getSupabase();
  for (const table of ["onboarding_messages", "onboarding_steps", "setup_gaps"]) check(await supabase.from(table).delete().eq("restaurant_id", restaurantId));
  const now = new Date().toISOString();
  check(await supabase.from("onboarding_sessions").update({ current_step: "hello", completed_at: null, started_at: now, updated_at: now }).eq("restaurant_id", restaurantId));
  check(await supabase.from("onboarding").update({ completed_at: null, wa_waiting: null }).eq("restaurant_id", restaurantId));
  await updateRestaurantFields(restaurantId, {
    active: false,
    address: null,
    cuisine: null,
    menu: [],
    opening_hours: {},
    faqs: {},
    recovery_offers: null,
    complaint_contact: null,
    halal_statement: null,
    brand_voice: null,
    profile_examples: null,
  } as Partial<Restaurant>);
  await log(restaurantId, "Test restaurant reset to step 1");
}

export async function jumpTestSite(restaurantId: string, step: string) {
  await testSite(restaurantId);
  if (!(FLOW_STEPS as readonly string[]).includes(step) || !STEP_DEFS[step as FlowStepKey].available) throw new TestSiteError(`"${step}" isn't a step in setup`);
  await enterStep(restaurantId, step as FlowStepKey, { channel: "web" });
  await log(restaurantId, `Test restaurant moved to ${STEP_DEFS[step as FlowStepKey].title}`);
}

export async function deleteTestSite(restaurantId: string) {
  const r = await testSite(restaurantId);
  // Its setup files too (everything else goes with the restaurant row).
  const storage = getSupabase().storage.from("onboarding-uploads");
  for (const folder of ["setup", "incoming", ...FLOW_STEPS]) {
    const { data } = await storage.list(`${restaurantId}/${folder}`);
    if (data?.length) await storage.remove(data.map((f) => `${restaurantId}/${folder}/${f.name}`));
  }
  check(await getSupabase().from("restaurants").delete().eq("id", restaurantId).eq("is_test", true));
  await logAction({ restaurantId: null, actor: "builder", action: "setting", detail: `Test restaurant ${r.name} deleted` });
}

// The builder's own WhatsApp (BUILDER_WHATSAPP) as this test restaurant's owner
// number. Taken off another test restaurant if it's there; never off a real one.
export async function linkBuilderNumber(restaurantId: string) {
  await testSite(restaurantId);
  const raw = process.env.BUILDER_WHATSAPP?.trim();
  if (!raw) throw new TestSiteError("BUILDER_WHATSAPP isn't set, so there's no number to link");
  const number = raw.startsWith("whatsapp:") ? raw : `whatsapp:${raw}`;
  const supabase = getSupabase();
  const { data: holder } = await supabase.from("restaurants").select("id, name, is_test").eq("owner_whatsapp", number).maybeSingle<{ id: string; name: string; is_test: boolean }>();
  if (holder && holder.id !== restaurantId) {
    if (!holder.is_test) throw new TestSiteError(`Your number is the owner number of ${holder.name}, a restaurant that isn't a test one. Unlink it there first (Supabase, restaurants.owner_whatsapp).`);
    check(await supabase.from("restaurants").update({ owner_whatsapp: null }).eq("id", holder.id).eq("is_test", true));
  }
  check(await supabase.from("restaurants").update({ owner_whatsapp: number, whatsapp_from: ourWhatsAppNumber() }).eq("id", restaurantId).eq("is_test", true));
  await log(restaurantId, "Builder's WhatsApp linked to this test restaurant");
}

// Any restaurant setting up (real ones too): the button for "Google accepted our invite".
export async function markAcceptedByBuilder(restaurantId: string) {
  const text = await markGoogleAccepted(restaurantId, { by: "builder" });
  return text;
}

// What the page shows for each restaurant setting up with Dina (and each test one).
export async function setupsForAdmin() {
  const supabase = getSupabase();
  const { data: sessions, error } = await supabase
    .from("onboarding_sessions")
    .select("restaurant_id, current_step, channel_last_used, started_at, completed_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(100)
    .returns<{ restaurant_id: string; current_step: FlowStepKey | null; channel_last_used: string | null; started_at: string; completed_at: string | null; updated_at: string }[]>();
  if (error) throw new Error(error.message);
  const out = [];
  for (const s of sessions ?? []) {
    const { data: r } = await supabase
      .from("restaurants")
      .select("id, name, slug, is_test, active, owner_whatsapp")
      .eq("id", s.restaurant_id)
      .maybeSingle<{ id: string; name: string; slug: string; is_test: boolean; active: boolean; owner_whatsapp: string | null }>();
    if (!r) continue;
    const { state } = await loadFlow(s.restaurant_id);
    const p = progress(state);
    const google = stepState(state, "google");
    out.push({
      ...r,
      session: s,
      progress: `${p.done} of ${p.total} done`,
      step: s.current_step ? STEP_DEFS[s.current_step].title : s.completed_at ? "Finished" : "All dealt with",
      google: google.status === "done" ? "Accepted" : google.waitingOn === "google" ? "Invited: waiting" : google.waitingOn ? "Waiting on the profile's owner" : google.status.replace("_", " "),
      googleWaiting: google.status === "in_progress" && google.waitingOn === "google",
      gaps: gapsFor(state).map((g) => STEP_DEFS[g.step_key].title),
      stalled: !s.completed_at && Date.now() - Date.parse(s.updated_at) > 48 * 3_600_000,
    });
  }
  return out;
}
