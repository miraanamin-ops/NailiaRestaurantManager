"use server";
import { redirect } from "next/navigation";
import { currentOwner } from "@/lib/auth";
import { DemoPhoneError, sendAsDemoOwner } from "@/lib/demo-phone";

// The demo phone's Send button (/onboarding/admin/phone). Builder only.
const UUID = /^[0-9a-f-]{36}$/i;

export async function sendAsDemo(form: FormData) {
  const owner = await currentOwner();
  if (!owner) redirect("/login?next=/onboarding/admin/phone");
  if (!owner.isBuilder) throw new Error("Only the builder can use the demo phone");
  const r = String(form.get("r") ?? "");
  if (!UUID.test(r)) redirect(`/onboarding/admin/phone?error=${encodeURIComponent("That restaurant id doesn't look right")}`);
  try {
    await sendAsDemoOwner(r, String(form.get("body") ?? ""), owner.email);
  } catch (err) {
    if (err instanceof DemoPhoneError) redirect(`/onboarding/admin/phone?r=${r}&error=${encodeURIComponent(err.message)}`);
    throw err;
  }
  redirect(`/onboarding/admin/phone?r=${r}&sent=${Date.now()}`);
}
