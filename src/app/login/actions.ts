"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { accessFor, authClient, emailLoginLink, looksLikeEmail, safeNext } from "@/lib/auth";
import { baseUrlFrom } from "@/lib/supabase";

// Sends a magic link, but only to an allowed email. The page says the same
// thing either way, so it can't be used to find out who has an account.
export async function sendLoginLink(form: FormData) {
  const email = String(form.get("email") ?? "").trim().toLowerCase().slice(0, 200);
  const next = safeNext(String(form.get("next") ?? "/"));
  const back = (params: string) => redirect(`/login?${params}&next=${encodeURIComponent(next)}`);
  if (!looksLikeEmail(email)) back("error=email");

  const access = await accessFor(email);
  if (access.allowed) {
    const error = await emailLoginLink(email, next, baseUrlFrom(await headers()));
    if (error) back(`error=${error}`);
  }
  back("sent=1");
}

export async function logOut() {
  await (await authClient()).auth.signOut();
  redirect("/login?out=1");
}
