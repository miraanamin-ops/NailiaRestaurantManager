"use server";
import { redirect } from "next/navigation";
import { currentOwner } from "@/lib/auth";
import { markPilotZero, PilotZeroError, setGoogleDryRun } from "@/lib/pilot-zero";

// The Pilot Zero controls' buttons (/onboarding/admin/pilot-zero). Builder only;
// every change is in the audit log (lib/pilot-zero.ts).
const UUID = /^[0-9a-f-]{36}$/i;
const PAGE = "/onboarding/admin/pilot-zero";

async function run(form: FormData, done: string, act: (r: string, builderEmail: string) => Promise<unknown>) {
  const owner = await currentOwner();
  if (!owner) redirect(`/login?next=${PAGE}`);
  if (!owner.isBuilder) throw new Error("Only the builder can use the Pilot Zero controls");
  const r = String(form.get("r") ?? "");
  if (!UUID.test(r)) redirect(`${PAGE}?error=${encodeURIComponent("That restaurant id doesn't look right")}`);
  try {
    await act(r, owner.email);
  } catch (err) {
    if (err instanceof PilotZeroError) redirect(`${PAGE}?error=${encodeURIComponent(err.message)}`);
    throw err;
  }
  redirect(`${PAGE}?done=${encodeURIComponent(done)}`);
}

export const markRestaurant = async (form: FormData) => run(form, "Marked for Pilot Zero: Google writes are dry run", (r, by) => markPilotZero(r, by));

export async function switchGoogle(form: FormData) {
  const kind = form.get("kind") === "profile" ? "profile" : "replies";
  const dryRun = form.get("to") !== "live";
  const label = kind === "replies" ? "Review replies and posts" : "Hours and photo changes";
  return run(form, `${label}: ${dryRun ? "dry run" : "live"}`, (r, by) =>
    setGoogleDryRun({ restaurantId: r, kind, dryRun, confirm: String(form.get("confirm") ?? ""), builderEmail: by }),
  );
}
