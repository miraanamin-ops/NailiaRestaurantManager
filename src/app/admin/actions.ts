"use server";
import { redirect } from "next/navigation";
import { cancelClosure, ClosureError, confirmClosure, requestClosure } from "@/lib/closure";
import { requireFounder } from "@/lib/founder/access";
import { DEFAULT_SETTINGS } from "@/lib/founder/data";
import { retryDeadJob } from "@/lib/queue/retry";
import { getSupabase } from "@/lib/supabase";

// The founder dashboard's buttons. Every one checks the founder login first, and
// everything that changes a client goes through the same code as the builder's
// controls (so it's in the audit log).

const UUID = /^[0-9a-f-]{36}$/i;
const clientPage = (id: string, msg: Record<string, string>) => `/admin/clients/${id}?${new URLSearchParams(msg)}`;
const field = (form: FormData, k: string) => String(form.get(k) ?? "").trim();

export async function retryJob(form: FormData) {
  const me = await requireFounder();
  const r = field(form, "r"), job = field(form, "job");
  if (!UUID.test(r) || !UUID.test(job)) redirect("/admin/clients");
  // Only a dead job of this client.
  const { data } = await getSupabase().from("jobs").select("id").eq("id", job).eq("restaurant_id", r).eq("status", "dead").maybeSingle();
  const ok = data ? await retryDeadJob(job, `${me.email} (founder dashboard)`) : false;
  redirect(clientPage(r, ok ? { done: "Job sent back to the queue." } : { error: "That job isn't waiting to be retried any more." }));
}

// Deleting an account: the same two steps and 24-hour cooling-off as the builder's
// close-account page (lib/closure.ts): export emailed, Google and Stripe stopped,
// then everything deleted.
export async function requestDelete(form: FormData) {
  const me = await requireFounder();
  const r = field(form, "r");
  if (!UUID.test(r)) redirect("/admin/clients");
  try {
    await requestClosure(r, field(form, "name"), `${me.email} (founder dashboard)`);
  } catch (err) {
    if (err instanceof ClosureError) redirect(clientPage(r, { error: err.message }));
    throw err;
  }
  redirect(clientPage(r, { done: "Deletion requested: nothing has changed yet. Confirm it below." }) + "#delete");
}

export async function confirmDelete(form: FormData) {
  const me = await requireFounder();
  const r = field(form, "r"), c = field(form, "c");
  if (!UUID.test(r) || !UUID.test(c)) redirect("/admin/clients");
  const { data } = await getSupabase().from("account_closures").select("id").eq("id", c).eq("restaurant_id", r).maybeSingle();
  if (!data) redirect(clientPage(r, { error: "That deletion request wasn't found." }));
  try {
    await confirmClosure({ closureId: c, typedName: field(form, "name"), understood: form.get("understood") === "on", skipCoolingOff: form.get("skip") === "on", builderEmail: `${me.email} (founder dashboard)` });
  } catch (err) {
    if (err instanceof ClosureError) redirect(clientPage(r, { error: err.message }) + "#delete");
    throw err;
  }
  redirect(clientPage(r, { done: form.get("skip") === "on" ? "Confirmed: deleting now." : "Confirmed: sending is paused and the account is deleted after the 24-hour cooling-off. You can cancel until then." }) + "#delete");
}

export async function cancelDelete(form: FormData) {
  const me = await requireFounder();
  const r = field(form, "r"), c = field(form, "c");
  if (!UUID.test(r) || !UUID.test(c)) redirect("/admin/clients");
  const { data } = await getSupabase().from("account_closures").select("id").eq("id", c).eq("restaurant_id", r).maybeSingle();
  if (!data) redirect(clientPage(r, { error: "That deletion request wasn't found." }));
  try {
    await cancelClosure(c, `${me.email} (founder dashboard)`);
  } catch (err) {
    if (err instanceof ClosureError) redirect(clientPage(r, { error: err.message }));
    throw err;
  }
  redirect(clientPage(r, { done: "Deletion cancelled. Nothing was deleted." }));
}

// ---------- Costs page ----------

const pence = (s: string) => {
  const n = Number(s.replace(/[£,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};

export async function addCost(form: FormData) {
  await requireFounder();
  const name = field(form, "name").slice(0, 80);
  const monthly = pence(field(form, "monthly"));
  const starts = field(form, "starts") || new Date().toISOString().slice(0, 10);
  if (!name || monthly === null || !/^\d{4}-\d{2}-\d{2}$/.test(starts)) redirect("/admin/costs?error=Give it a name, a monthly amount in pounds and a start date.");
  const { error } = await getSupabase().from("founder_costs").insert({ name, monthly_pence: monthly, starts_on: starts, note: field(form, "note").slice(0, 200) || null });
  if (error) redirect(`/admin/costs?error=${encodeURIComponent(error.message)}`);
  redirect("/admin/costs?done=Cost added.");
}

export async function endCost(form: FormData) {
  await requireFounder();
  const id = field(form, "id");
  if (!UUID.test(id)) redirect("/admin/costs");
  const ends = field(form, "ends") || new Date().toISOString().slice(0, 10);
  await getSupabase().from("founder_costs").update({ ends_on: ends }).eq("id", id);
  redirect("/admin/costs?done=Cost stopped.");
}

export async function deleteCost(form: FormData) {
  await requireFounder();
  const id = field(form, "id");
  if (UUID.test(id)) await getSupabase().from("founder_costs").delete().eq("id", id);
  redirect("/admin/costs?done=Cost removed.");
}

export async function saveSettings(form: FormData) {
  await requireFounder();
  const rows = (Object.keys(DEFAULT_SETTINGS) as (keyof typeof DEFAULT_SETTINGS)[]).flatMap((key) => {
    const v = Number(field(form, key));
    return Number.isFinite(v) && v >= 0 ? [{ key, value: v, updated_at: new Date().toISOString() }] : [];
  });
  const { error } = await getSupabase().from("founder_settings").upsert(rows, { onConflict: "key" });
  if (error) redirect(`/admin/costs?error=${encodeURIComponent(error.message)}`);
  redirect("/admin/costs?done=Prices saved.");
}
