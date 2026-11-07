"use server";
import { redirect } from "next/navigation";
import { requireOwner, safeNext } from "@/lib/auth";
import { decideFromWeb } from "@/lib/web-decisions";

// The Approve and Skip buttons on the owner's web pages (lib/web-decisions.ts does
// the checking). Goes back to the page the owner was on, with what happened.
async function decide(form: FormData, action: "approve" | "skip") {
  const back = safeNext(String(form.get("back") ?? "/"));
  const owner = await requireOwner(back);
  const r = String(form.get("r") ?? "");
  const draftId = String(form.get("draft") ?? "");
  const result = await decideFromWeb(owner, r, draftId, action, String(form.get("reason") ?? ""));
  const url = new URL(back, "http://x");
  url.searchParams.set("r", r);
  url.searchParams.set(result.ok ? "done" : "oops", result.message);
  redirect(`${url.pathname}${url.search}`);
}

export async function approveFromWeb(form: FormData) {
  await decide(form, "approve");
}

export async function skipFromWeb(form: FormData) {
  await decide(form, "skip");
}
