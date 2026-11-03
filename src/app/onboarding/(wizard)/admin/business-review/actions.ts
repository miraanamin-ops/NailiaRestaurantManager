"use server";
import { redirect } from "next/navigation";
import { currentOwner } from "@/lib/auth";
import { check } from "@/lib/drafts";
import { startBusinessReview } from "@/lib/review/job";
import { getSupabase } from "@/lib/supabase";

// "Run business review" (/onboarding/admin/business-review). Builder only, for
// any restaurant, after typing its name. It's in the audit log (actor builder).
const UUID = /^[0-9a-f-]{36}$/i;
const PAGE = "/onboarding/admin/business-review";
const back = (params: string): never => redirect(`${PAGE}?${params}`);

export async function runReview(form: FormData) {
  const owner = await currentOwner();
  if (!owner) redirect(`/login?next=${PAGE}`);
  if (!owner.isBuilder) throw new Error("Only the builder can run a business review");
  const id = String(form.get("r") ?? "");
  if (!UUID.test(id)) back("error=" + encodeURIComponent("Pick a restaurant first"));
  const r = check(await getSupabase().from("restaurants").select("id, name").eq("id", id).maybeSingle<{ id: string; name: string }>());
  if (!r) back("error=" + encodeURIComponent("That restaurant is gone"));
  if (String(form.get("name") ?? "").trim() !== r!.name.trim()) back(`confirm=${id}&error=${encodeURIComponent("Type the restaurant's name exactly to confirm")}`);
  const outcome = await startBusinessReview(id, "builder", { force: form.get("again") === "on" });
  if (!outcome.started) back(`confirm=${id}&error=${encodeURIComponent(outcome.reason === "already" ? "It already has a review: tick 'Run again' to replace it" : "Couldn't start it")}`);
  back(`done=${encodeURIComponent(`Business review started for ${r!.name}: the message goes in about 10 minutes at most`)}`);
}
