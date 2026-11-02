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

// ---------- The simulation (lib/simulation.ts) ----------

async function sim(form: FormData, done: string, act: (r: string, builderEmail: string) => Promise<unknown>) {
  const { SimulationError } = await import("@/lib/simulation");
  return run(form, done, async (r, by) => {
    try {
      return await act(r, by);
    } catch (err) {
      if (err instanceof SimulationError) throw new PilotZeroError(err.message);
      throw err;
    }
  });
}

export async function simSetDay(form: FormData) {
  const { setSimulatedDay } = await import("@/lib/simulation");
  const day = String(form.get("day") ?? "");
  return sim(form, `Simulating ${day}: real scheduled jobs skip this restaurant until you stop`, (r, by) => setSimulatedDay(r, day, by));
}
export async function simNextDay(form: FormData) {
  const { nextSimulatedDay } = await import("@/lib/simulation");
  return sim(form, "Moved to the next simulated day", (r, by) => nextSimulatedDay(r, by));
}
export async function simStop(form: FormData) {
  const { stopSimulation } = await import("@/lib/simulation");
  return sim(form, "Simulation stopped: back to real time", (r, by) => stopSimulation(r, by));
}
export async function simTillReport(form: FormData) {
  const { injectZReport } = await import("@/lib/simulation");
  const quiet = form.get("quiet") === "1";
  const net = Number(String(form.get("net") ?? "").replace(/[£,\s]/g, "")) || null;
  return sim(form, quiet ? "Quiet day added" : "Till report added", (r, by) => injectZReport(r, { quiet, net }, by));
}
export async function simReview(form: FormData) {
  const { injectReview } = await import("@/lib/simulation");
  const rating = Number(form.get("rating") ?? 5);
  return sim(form, `${rating}-star review added`, (r, by) => injectReview(r, rating, by));
}
export async function simRunDay(form: FormData) {
  const { queueRunDay } = await import("@/lib/simulation");
  return sim(form, "Run day started: refresh in a minute to see each step", (r, by) => queueRunDay(r, by));
}
export async function simClear(form: FormData) {
  const { clearSimulatedData } = await import("@/lib/simulation");
  return sim(form, "Simulated data cleared", (r, by) => clearSimulatedData(r, by));
}

// ---------- Imported sales (lib/pilot-zero-sales.ts) ----------

export async function removeSales(form: FormData) {
  const { removeImportedSales } = await import("@/lib/pilot-zero-sales");
  const importId = String(form.get("import") ?? "");
  const target = importId ? { importId } : { from: String(form.get("from") ?? ""), to: String(form.get("to") ?? "") };
  return run(form, "Imported sales removed", (r, by) => removeImportedSales({ restaurantId: r, target, confirm: String(form.get("confirm") ?? ""), builderEmail: by }));
}
