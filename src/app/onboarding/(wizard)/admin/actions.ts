"use server";
import { redirect } from "next/navigation";
import { currentOwner } from "@/lib/auth";
import { deleteTestSite, jumpTestSite, linkBuilderNumber, markAcceptedByBuilder, resetTestSite, startTestSite, TestSiteError } from "@/lib/onboarding/dina/test-sites";

// The test controls' buttons (/onboarding/admin). Builder only; every action is in
// the audit log (lib/onboarding/dina/test-sites.ts). A problem comes back on the page.

const UUID = /^[0-9a-f-]{36}$/i;
const back = (params: string): never => redirect(`/onboarding/admin?${params}`);

async function builder() {
  const owner = await currentOwner();
  if (!owner) redirect("/login?next=/onboarding/admin");
  if (!owner.isBuilder) throw new Error("Only the builder can use the setup test controls");
}

async function run(form: FormData, done: string, act: (r: string) => Promise<unknown>) {
  await builder();
  const r = String(form.get("r") ?? "");
  if (!UUID.test(r)) back("error=" + encodeURIComponent("That restaurant id doesn't look right"));
  try {
    await act(r);
  } catch (err) {
    if (err instanceof TestSiteError) back("error=" + encodeURIComponent(err.message));
    throw err;
  }
  back(`done=${encodeURIComponent(done)}`);
}

export async function startTest() {
  await builder();
  const id = await startTestSite();
  redirect(`/onboarding/chat?r=${id}`);
}

export const resetTest = async (form: FormData) => run(form, "Reset to step 1", resetTestSite);
export const deleteTest = async (form: FormData) => run(form, "Deleted", deleteTestSite);
export const linkMyNumber = async (form: FormData) => run(form, "Your WhatsApp is linked to it", linkBuilderNumber);
export const markGoogleAccepted = async (form: FormData) => run(form, "Google marked accepted; Dina has told the owner", markAcceptedByBuilder);
export const jumpTest = async (form: FormData) => run(form, "Moved to that step", (r) => jumpTestSite(r, String(form.get("step") ?? "")));
