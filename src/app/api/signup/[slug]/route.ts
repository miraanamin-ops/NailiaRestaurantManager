import type { NextRequest } from "next/server";
import { sendWelcomeEmail } from "@/lib/email";
import { getRestaurantBySlug, logEvent, signUp } from "@/lib/signups";
import { baseUrlFrom } from "@/lib/supabase";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function back(req: NextRequest, slug: string, params: Record<string, string>) {
  const url = new URL(`/r/${slug}`, baseUrlFrom(req.headers));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return Response.redirect(url, 303);
}

// The sign-up form posts here (works without JavaScript).
export async function POST(req: NextRequest, ctx: RouteContext<"/api/signup/[slug]">) {
  const { slug } = await ctx.params;
  const restaurant = await getRestaurantBySlug(slug);
  if (!restaurant) return new Response("Not found", { status: 404 });

  const form = await req.formData();
  const get = (k: string) => String(form.get(k) ?? "").trim();

  // Hidden field that people never see. Bots that fill it in get a normal
  // "thanks" page but nothing is saved or sent.
  if (get("website")) return Response.redirect(new URL(`/r/${slug}/thanks?status=new`, baseUrlFrom(req.headers)), 303);

  const firstName = get("first_name").slice(0, 50);
  const email = get("email").toLowerCase().slice(0, 200);
  const birthdayRaw = get("birthday");
  const consent = form.get("consent") === "yes";

  if (!firstName) return back(req, slug, { error: "name" });
  if (!EMAIL_RE.test(email)) return back(req, slug, { error: "email" });
  let birthday: string | null = null;
  if (birthdayRaw) {
    const d = new Date(`${birthdayRaw}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthdayRaw) || Number.isNaN(d.getTime()) || d > new Date() || d.getUTCFullYear() < 1900) {
      return back(req, slug, { error: "birthday" });
    }
    birthday = birthdayRaw;
  }

  const result = await signUp(restaurant, { firstName, email, birthday, consent, userAgent: req.headers.get("user-agent") });

  // New sign-ups, and repeat sign-ups whose reward hasn't been used yet, get the welcome email.
  let emailed = false;
  if (result.reward && !result.reward.redeemed_at) {
    try {
      const id = await sendWelcomeEmail({
        restaurant,
        customer: result.customer,
        reward: result.reward,
        baseUrl: baseUrlFrom(req.headers),
      });
      await logEvent(restaurant.id, result.customer.id, "welcome_email_sent", id ?? undefined);
      emailed = true;
    } catch (err) {
      console.error("Welcome email failed", err);
      await logEvent(restaurant.id, result.customer.id, "email_failed", err instanceof Error ? err.message : String(err));
    }
  }

  const status = result.status === "new" ? "new" : result.reward?.redeemed_at ? "used" : "repeat";
  const url = new URL(`/r/${slug}/thanks`, baseUrlFrom(req.headers));
  url.searchParams.set("status", status);
  if (!emailed && status !== "used") url.searchParams.set("email", "failed");
  return Response.redirect(url, 303);
}
