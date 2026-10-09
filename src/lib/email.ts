import "server-only";
import { Resend } from "resend";
import type { Reward, SignupCustomer } from "@/lib/signups";
import type { Restaurant } from "@/lib/supabase";

// Until a domain is verified in Resend, emails must come from Resend's test
// address and can only be delivered to the email the Resend account uses.
const DEFAULT_FROM_ADDRESS = "onboarding@resend.dev";

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function unsubscribeUrl(baseUrl: string, customer: Pick<SignupCustomer, "unsubscribe_token">) {
  return `${baseUrl}/unsubscribe/${customer.unsubscribe_token}`;
}

// Every email gets an unsubscribe link in the footer plus the standard
// one-click unsubscribe headers that Gmail, Outlook and Apple Mail use.
async function sendEmail(input: {
  restaurant: Restaurant;
  to: string;
  subject: string;
  html: string;
  text: string;
  unsubscribeLink: string;
  oneClickLink: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Missing RESEND_API_KEY");
  const fromAddress = process.env.EMAIL_FROM_ADDRESS || DEFAULT_FROM_ADDRESS;
  const { data, error } = await new Resend(apiKey).emails.send({
    from: `${input.restaurant.name} <${fromAddress}>`,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    headers: {
      "List-Unsubscribe": `<${input.oneClickLink}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
  if (error) throw new Error(`Resend: ${error.message}`);
  return data?.id ?? null;
}

export async function sendWelcomeEmail(input: {
  restaurant: Restaurant;
  customer: SignupCustomer;
  reward: Reward;
  baseUrl: string;
}) {
  const { restaurant, customer, reward, baseUrl } = input;
  const rewardLink = `${baseUrl}/reward/${reward.token}`;
  const unsubLink = unsubscribeUrl(baseUrl, customer);
  const oneClick = `${baseUrl}/api/unsubscribe/${customer.unsubscribe_token}`;
  const name = escapeHtml(customer.name);
  const rest = escapeHtml(restaurant.name);
  const gift = escapeHtml(reward.reward);
  const brand = restaurant.brand_color;
  const dark = restaurant.brand_dark;

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;color:${dark}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden">
  <tr><td style="background:${dark};padding:24px;text-align:center">
    <div style="color:#ffffff;font-size:22px;font-weight:bold">${rest}</div>
    ${restaurant.tagline ? `<div style="color:#d6d3d1;font-size:13px;margin-top:4px">${escapeHtml(restaurant.tagline)}</div>` : ""}
  </td></tr>
  <tr><td style="padding:28px 24px 8px">
    <p style="font-size:18px;margin:0 0 12px">Welcome, ${name}! 🔥</p>
    <p style="font-size:15px;line-height:1.5;margin:0 0 20px">Thanks for joining us. Your welcome reward is <strong>${gift}</strong>, on the house.</p>
    <p style="font-size:15px;line-height:1.5;margin:0 0 24px">Next time you're in, tap the button below <strong>at the till</strong> and show the screen to our staff.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px"><tr><td style="background:${brand};border-radius:999px">
      <a href="${rewardLink}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none">Show at the till</a>
    </td></tr></table>
    <p style="font-size:13px;line-height:1.5;color:#78716c;margin:0 0 24px">Only tap "Redeem now" when you're at the till: the reward can be used once and lasts 10 minutes after you tap it.</p>
  </td></tr>
  <tr><td style="padding:16px 24px 24px;border-top:1px solid #e7e5e4;font-size:12px;line-height:1.5;color:#78716c">
    ${rest} · ${escapeHtml(restaurant.address ?? "")}<br>
    You're getting this because you signed up at ${rest}.<br>
    <a href="${unsubLink}" style="color:#78716c">Unsubscribe</a> from all emails from ${rest}.
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

  const text = `Welcome, ${customer.name}!

Thanks for joining ${restaurant.name}. Your welcome reward is ${reward.reward}, on the house.

Next time you're in, open this link at the till and show the screen to our staff:
${rewardLink}

Only tap "Redeem now" when you're at the till: it can be used once and lasts 10 minutes after you tap it.

--
${restaurant.name} · ${restaurant.address ?? ""}
Unsubscribe from all emails: ${unsubLink}`;

  return sendEmail({
    restaurant,
    to: customer.email,
    subject: `Welcome to ${restaurant.name}! Your reward is inside 🎁`,
    html,
    text,
    unsubscribeLink: unsubLink,
    oneClickLink: oneClick,
  });
}
