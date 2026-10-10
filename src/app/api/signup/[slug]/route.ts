import type { NextRequest } from "next/server";
import { sendConfirmEmail, sendWelcomeEmail } from "@/lib/email";
import { isEmail } from "@/lib/email/route";
import { clientIp, DAY, limitKey, MINUTE, overLimit } from "@/lib/rate-limit";
import { getRestaurantBySlug, logEvent, markConfirmSent, signUp } from "@/lib/signups";
import { baseUrlFrom } from "@/lib/supabase";
import { verifyTurnstile } from "@/lib/turnstile";

function back(req: NextRequest, slug: string, params: Record<string, string>) {
  const url = new URL(`/r/${slug}`, baseUrlFrom(req.headers));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return Response.redirect(url, 303);
}

// The sign-up form posts here. Protected by:
//   - a hidden "website" field that only bots fill in
//   - Cloudflare Turnstile (the "I'm human" check), when its keys are set
//   - rate limits: 5 sign-ups per connection per 10 minutes (30 a day), and at
//     most 3 emails a day to any one address
// Then double opt-in: the customer gets a "confirm your email" message, and
// nothing else (no reward, no marketing) until they click it.
export async function POST(req: NextRequest, ctx: RouteContext<"/api/signup/[slug]">) {
  const { slug } = await ctx.params;
  const restaurant = await getRestaurantBySlug(slug);
  if (!restaurant) return new Response("Not found", { status: 404 });
  const baseUrl = baseUrlFrom(req.headers);

  const form = await req.formData();
  const get = (k: string) => String(form.get(k) ?? "").trim();

  // Bots that fill in the hidden field get a normal-looking page but nothing is saved or sent.
  if (get("website")) return Response.redirect(new URL(`/r/${slug}/thanks?status=confirm`, baseUrl), 303);

  const firstName = get("first_name").slice(0, 50);
  const email = get("email").toLowerCase().slice(0, 200);
  const birthdayRaw = get("birthday");
  const consent = form.get("consent") === "yes";

  if (!firstName) return back(req, slug, { error: "name" });
  if (!isEmail(email)) return back(req, slug, { error: "email" });
  let birthday: string | null = null;
  if (birthdayRaw) {
    const d = new Date(`${birthdayRaw}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthdayRaw) || Number.isNaN(d.getTime()) || d > new Date() || d.getUTCFullYear() < 1900) {
      return back(req, slug, { error: "birthday" });
    }
    birthday = birthdayRaw;
  }

  const ip = clientIp(req.headers);
  const human = await verifyTurnstile(get("cf-turnstile-response"), ip);
  if (!human.ok) return back(req, slug, { error: "captcha" });
  if (
    await overLimit([
      { key: limitKey("signup-ip-10m", ip), max: 5, windowMs: 10 * MINUTE },
      { key: limitKey("signup-ip-day", ip), max: 30, windowMs: DAY },
    ])
  ) {
    return back(req, slug, { error: "slow" });
  }

  const result = await signUp(restaurant, { firstName, email, birthday, consent, userAgent: req.headers.get("user-agent") });
  const { plan, customer, reward } = result;

  // What to send, if anything: the confirm email, or (for a confirmed customer
  // whose reward is still unused) the welcome email again.
  const wantsConfirm = plan !== "repeat";
  const wantsWelcome = plan === "repeat" && reward && !reward.redeemed_at;
  let status: string = wantsConfirm ? (plan === "new" ? "confirm" : plan === "reconfirm" ? "reconfirm" : "consent") : reward?.redeemed_at ? "used" : "repeat";
  let emailFailed = false;

  if (wantsConfirm || wantsWelcome) {
    if (await overLimit([{ key: limitKey("email-to", email), max: 3, windowMs: DAY }])) {
      status = "limit";
    } else {
      try {
        if (wantsConfirm) {
          const sent = await sendConfirmEmail({ restaurant, customer: { ...customer, confirm_token: customer.confirm_token! }, baseUrl });
          await markConfirmSent(customer);
          if (sent.delivery === "simulated") await logEvent(restaurant.id, customer.id, "email_failed", `Not emailed: ${sent.reason}`);
        } else if (reward) {
          const sent = await sendWelcomeEmail({ restaurant, customer, reward, baseUrl });
          await logEvent(restaurant.id, customer.id, "welcome_email_sent", sent.id ?? sent.reason);
        }
      } catch (err) {
        console.error("Sign-up email failed", err);
        emailFailed = true;
        await logEvent(restaurant.id, customer.id, "email_failed", err instanceof Error ? err.message : String(err));
      }
    }
  }

  const url = new URL(`/r/${slug}/thanks`, baseUrl);
  url.searchParams.set("status", status);
  if (emailFailed) url.searchParams.set("email", "failed");
  return Response.redirect(url, 303);
}
