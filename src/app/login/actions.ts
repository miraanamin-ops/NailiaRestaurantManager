"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { accessFor, authClient, emailPasswordLink, logInWithPassword, looksLikeEmail, requireOwner, safeNext } from "@/lib/auth";
import { passwordProblem } from "@/lib/auth-rules";
import { clientIp, limitKey, MINUTE, overLimit } from "@/lib/rate-limit";
import { baseUrlFrom } from "@/lib/supabase";

// Log in with email and password. Only allowed emails get in (lib/auth.ts accessFor);
// anyone else, or a wrong password, gets the same "wrong email or password", so the
// page can't be used to find out who has an account. Rate-limited per connection
// and per email, so passwords can't be guessed at speed.
export async function logIn(form: FormData) {
  const email = String(form.get("email") ?? "").trim().toLowerCase().slice(0, 200);
  const password = String(form.get("password") ?? "");
  const next = safeNext(String(form.get("next") ?? "/"));
  const back = (error: string) => redirect(`/login?error=${error}&next=${encodeURIComponent(next)}`);
  if (!looksLikeEmail(email) || !password) back("wrong");

  const ip = clientIp(await headers());
  const limited = await overLimit([
    { key: limitKey("login-ip", ip), max: 20, windowMs: 15 * MINUTE },
    { key: limitKey("login-email", email), max: 8, windowMs: 15 * MINUTE },
  ]);
  if (limited) back("slow");

  if (!(await logInWithPassword(email, password))) back("wrong");
  if (!(await accessFor(email)).allowed) {
    await (await authClient()).auth.signOut({ scope: "local" });
    back("wrong");
  }
  redirect(next);
}

// "Forgot your password?": emails a link to set a new one, but only to an allowed
// email. The page says the same thing either way.
export async function sendPasswordLink(form: FormData) {
  const email = String(form.get("email") ?? "").trim().toLowerCase().slice(0, 200);
  const next = safeNext(String(form.get("next") ?? "/"));
  const back = (params: string) => redirect(`/login/forgot?${params}&next=${encodeURIComponent(next)}`);
  if (!looksLikeEmail(email)) back("error=email");

  const requestHeaders = await headers();
  const limited = await overLimit([
    { key: limitKey("reset-ip", clientIp(requestHeaders)), max: 10, windowMs: 60 * MINUTE },
    { key: limitKey("reset-email", email), max: 3, windowMs: 60 * MINUTE },
  ]);
  if (limited) back("error=wait");

  if ((await accessFor(email)).allowed) {
    const error = await emailPasswordLink(email, baseUrlFrom(requestHeaders));
    if (error) back(`error=${error}`);
  }
  back("sent=1");
}

// Setting a new password, while logged in (from the reset link, or the account menu).
export async function setPassword(form: FormData) {
  await requireOwner("/account/password");
  const password = String(form.get("password") ?? "");
  const again = String(form.get("again") ?? "");
  const back = (error: string) => redirect(`/account/password?error=${error}`);
  const problem = passwordProblem(password);
  if (problem) back(problem);
  if (password !== again) back("different");
  const { error } = await (await authClient()).auth.updateUser({ password });
  if (error) {
    console.warn("Couldn't change the password", error.message);
    back(/same|different from the old/i.test(error.message) ? "same" : /weak|pwned|leaked/i.test(error.message) ? "weak" : "failed");
  }
  redirect("/account/password?saved=1");
}

export async function logOut() {
  await (await authClient()).auth.signOut();
  redirect("/login?out=1");
}
