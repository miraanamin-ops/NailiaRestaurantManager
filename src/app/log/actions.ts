"use server";
import { redirect } from "next/navigation";
import { currentOwner } from "@/lib/auth";
import { retryDeadJob } from "@/lib/queue/retry";

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
