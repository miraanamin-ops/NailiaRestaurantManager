import "server-only";
import { Resend } from "resend";
import type { CampaignFields as Campaign } from "@/lib/campaigns";
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
  oneClickLink: string | null;
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
    headers: input.oneClickLink
      ? { "List-Unsubscribe": `<${input.oneClickLink}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
      : undefined,
  });
  if (error) throw new Error(`Resend: ${error.message}`);
  return data?.id ?? null;
}

// A plain email to the builder (alerts about the system itself, never to customers or owners).
export async function sendBuilderEmail(to: string, subject: string, text: string) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Missing RESEND_API_KEY");
  const fromAddress = process.env.EMAIL_FROM_ADDRESS || DEFAULT_FROM_ADDRESS;
  const { data, error } = await new Resend(apiKey).emails.send({ from: `Naila alerts <${fromAddress}>`, to, subject, text });
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
    oneClickLink: oneClick,
  });
}

const paragraphs = (text: string) =>
  text
    .split(/\n{2,}/)
    .map((p) => `<p style="font-size:15px;line-height:1.55;margin:0 0 14px">${escapeHtml(p.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("");

// A campaign email to one person, with their own one-time offer link.
export async function sendCampaignEmail(input: {
  restaurant: Restaurant;
  campaign: Pick<Campaign, "subject" | "body" | "offer">;
  validity: string; // e.g. "Thu 15 Oct only"
  baseUrl: string;
  token: string;
  to: string;
  firstName: string;
  unsubscribeToken: string | null; // null for the owner's own copy
  ownerCopy: boolean;
}) {
  const { restaurant, campaign, baseUrl, token, validity } = input;
  const personal = (s: string) => s.replaceAll("{first_name}", input.firstName);
  const offerLink = `${baseUrl}/offer/${token}`;
  const unsubLink = input.unsubscribeToken ? `${baseUrl}/unsubscribe/${input.unsubscribeToken}` : null;
  const oneClick = input.unsubscribeToken ? `${baseUrl}/api/unsubscribe/${input.unsubscribeToken}` : null;
  const rest = escapeHtml(restaurant.name);
  const brand = restaurant.brand_color;
  const dark = restaurant.brand_dark;

  const footer = unsubLink
    ? `You're getting this because you signed up at ${rest} and asked for offers by email.<br><a href="${unsubLink}" style="color:#78716c">Unsubscribe</a> from all emails from ${rest}.`
    : `This is your owner copy. Customers' emails include a one-click unsubscribe link here.`;

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
    ${paragraphs(personal(campaign.body))}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;border:2px dashed ${brand};border-radius:12px">
      <tr><td style="padding:18px;text-align:center">
        <div style="font-size:20px;font-weight:bold;color:${brand}">${escapeHtml(campaign.offer)}</div>
        <div style="font-size:13px;color:#78716c;margin-top:6px">Valid ${escapeHtml(validity)}</div>
      </td></tr>
    </table>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 20px"><tr><td style="background:${brand};border-radius:999px">
      <a href="${offerLink}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none">Show at the till</a>
    </td></tr></table>
    <p style="font-size:12px;line-height:1.5;color:#78716c;margin:0 0 20px">One use per person. Tap "Redeem now" at the till on a valid day; it lasts 10 minutes.</p>
  </td></tr>
  <tr><td style="padding:16px 24px 24px;border-top:1px solid #e7e5e4;font-size:12px;line-height:1.5;color:#78716c">
    ${rest} · ${escapeHtml(restaurant.address ?? "")}<br>${footer}
  </td></tr>
</table>
</td></tr></table>
<img src="${baseUrl}/api/t/open/${token}" width="1" height="1" alt="" style="display:block;border:0">
</body></html>`;

  const text = `${personal(campaign.body)}

${campaign.offer}
Valid ${validity}

Show this at the till: ${offerLink}
One use per person. Tap "Redeem now" at the till on a valid day; it lasts 10 minutes.

--
${restaurant.name} · ${restaurant.address ?? ""}
${unsubLink ? `Unsubscribe from all emails: ${unsubLink}` : "This is your owner copy."}`;

  return sendEmail({
    restaurant,
    to: input.to,
    subject: `${input.ownerCopy ? "[Your copy] " : ""}${personal(campaign.subject)}`,
    html,
    text,
    oneClickLink: oneClick,
  });
}
