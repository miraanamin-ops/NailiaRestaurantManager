"use server";
import { redirect } from "next/navigation";
import { currentOwner } from "@/lib/auth";
import { retryDeadJob } from "@/lib/queue/retry";
import { setForecastUnvalidated } from "@/lib/forecast";

// Retry on a dead job (the job queue section of /log). Builder only.
export async function retryJob(form: FormData) {
  const owner = await currentOwner();
  if (!owner) redirect("/login?next=/log");
  if (!owner.isBuilder) throw new Error("Only the builder can retry jobs");
  const id = String(form.get("id") ?? "");
  const r = String(form.get("r") ?? "");
  const ok = /^[0-9a-f-]{36}$/i.test(id) && (await retryDeadJob(id, owner.email));
  redirect(`/log?r=${encodeURIComponent(r)}&retried=${ok ? "1" : "0"}#queue`);
}

// The demo-only forecast override (the forecast section of /log). Builder only;
// setForecastUnvalidated refuses it unless TEST_TOOLS is on and the restaurant is a demo.
export async function toggleForecastOverride(form: FormData) {
  const owner = await currentOwner();
  if (!owner) redirect("/login?next=/log");
  if (!owner.isBuilder) throw new Error("Only the builder can change this");
  const r = String(form.get("r") ?? "");
  const on = form.get("on") === "1";
  const result = /^[0-9a-f-]{36}$/i.test(r) && owner.restaurantIds.includes(r) ? await setForecastUnvalidated(r, on) : { ok: false, message: "Not your restaurant." };
  redirect(`/log?r=${encodeURIComponent(r)}&forecast=${result.ok ? "1" : "0"}#forecast`);
}
