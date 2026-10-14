"use server";
import { redirect } from "next/navigation";
import { currentOwner } from "@/lib/auth";
import { cancelImport, confirmImport } from "@/lib/sales/pos-import";
import { mappingFromForm } from "./mapping-form";

// The column check page's buttons: import with these columns, or cancel.

async function own(restaurantId: string) {
  const owner = await currentOwner();
  if (!owner) redirect(`/login?next=${encodeURIComponent(`/sales?r=${restaurantId}`)}`);
  if (!owner.restaurantIds.includes(restaurantId)) throw new Error("Not your restaurant");
}

// Where to go afterwards: back to onboarding's sales step if the file came from there.
const doneUrl = (form: FormData, rid: string, key: "msg" | "error", text: string) =>
  form.get("back") === "onboarding" ? `/onboarding/setup?r=${rid}&sales_${key}=${encodeURIComponent(text)}` : `/sales?r=${rid}&${key}=${encodeURIComponent(text)}`;

export async function importWithMapping(form: FormData) {
  const rid = String(form.get("r") ?? "");
  const id = String(form.get("id") ?? "");
  const back = form.get("back") === "onboarding" ? "&back=onboarding" : "";
  await own(rid);
  const mapping = mappingFromForm((k) => String(form.get(k) ?? ""));
  if (!mapping) redirect(`/sales/import/${id}?r=${rid}${back}&error=${encodeURIComponent("Choose the date, item and price columns.")}`);
  const outcome = await confirmImport(rid, id, mapping, "owner");
  const text = outcome.message.replace(/^📊 /, "");
  if (outcome.status === "failed" && outcome.importId) redirect(`/sales/import/${id}?r=${rid}${back}&error=${encodeURIComponent(text)}`);
  redirect(doneUrl(form, rid, outcome.status === "imported" ? "msg" : "error", text));
}

export async function cancelUpload(form: FormData) {
  const rid = String(form.get("r") ?? "");
  await own(rid);
  await cancelImport(rid, String(form.get("id") ?? ""));
  redirect(doneUrl(form, rid, "msg", "Cancelled: nothing was imported."));
}
