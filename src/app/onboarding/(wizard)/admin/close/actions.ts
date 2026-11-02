"use server";
import { redirect } from "next/navigation";
import { currentOwner } from "@/lib/auth";
import { cancelClosure, ClosureError, confirmClosure, requestClosure, retryClosure } from "@/lib/closure";

// The close-account buttons (/onboarding/admin/close). Builder only; every step
// is in the audit log (lib/closure.ts).
const UUID = /^[0-9a-f-]{36}$/i;
const PAGE = "/onboarding/admin/close";

async function run(form: FormData, field: "r" | "c", done: string, act: (id: string, builderEmail: string) => Promise<unknown>) {
  const owner = await currentOwner();
  if (!owner) redirect(`/login?next=${PAGE}`);
  if (!owner.isBuilder) throw new Error("Only the builder can close accounts");
  const id = String(form.get(field) ?? "");
  if (!UUID.test(id)) redirect(`${PAGE}?error=${encodeURIComponent("Pick a restaurant first")}`);
  try {
    await act(id, owner.email);
  } catch (err) {
    if (err instanceof ClosureError) redirect(`${PAGE}?error=${encodeURIComponent(err.message)}`);
    throw err;
  }
  redirect(`${PAGE}?done=${encodeURIComponent(done)}`);
}

export const requestClose = async (form: FormData) =>
  run(form, "r", "Closing requested: nothing has changed yet. Confirm it below.", (r, by) => requestClosure(r, String(form.get("name") ?? ""), by));

export const confirmClose = async (form: FormData) =>
  run(form, "c", form.get("skip") === "on" ? "Confirmed: closing now" : "Confirmed: it closes after the 24-hour cooling-off", (c, by) =>
    confirmClosure({ closureId: c, typedName: String(form.get("name") ?? ""), understood: form.get("understood") === "on", skipCoolingOff: form.get("skip") === "on", builderEmail: by }),
  );

export const cancelClose = async (form: FormData) => run(form, "c", "Closing cancelled", (c, by) => cancelClosure(c, by));
export const retryClose = async (form: FormData) => run(form, "c", "Trying again now", (c, by) => retryClosure(c, by));
