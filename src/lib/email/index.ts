import "server-only";
import { Resend } from "resend";
import { builderEmails } from "@/lib/builder-emails";
import { isTestMode } from "@/lib/test-mode";
import type { Restaurant } from "@/lib/supabase";
import { brandFor } from "./brand";
import { campaignContent, confirmContent, feedbackContent, welcomeContent, type EmailContent, type Links } from "./content";
import { fromHeader, isEmail, routeEmail, senderAddress } from "./route";
import { renderEmail } from "./templates";

// Sending customer emails. Every one:
//   - comes from our verified domain with the restaurant's name ("Ember & Spice Grill <hello@mail.dinerai.co.uk>")
//   - has reply-to set to the restaurant's email, so replies reach the owner
//   - has an unsubscribe and a delete-my-data link in the footer, plus the
//     one-click unsubscribe headers Gmail, Outlook and Apple Mail use
//   - goes through routeEmail (./route.ts): dummy addresses are never emailed,
//     and with TEST_MODE on, nothing reaches anyone but the builder and the owner.

export type Delivery = { delivery: "email" | "simulated"; id: string | null; to: string | null; redirectedFrom: string | null; reason?: string };

export const brandOf = (r: Restaurant) => brandFor(r);

// The per-customer links in every footer. The token is the customer's own secret.
export function customerLinks(baseUrl: string, unsubscribeToken: string | null): Links {
  return unsubscribeToken
    ? { unsubscribe: `${baseUrl}/unsubscribe/${unsubscribeToken}`, deleteData: `${baseUrl}/delete/${unsubscribeToken}` }
    : { unsubscribe: null, deleteData: null };
}

function replyTo(r: Restaurant) {
  const address = r.reply_to_email || r.owner_email;
  return isEmail(address) ? address.trim() : undefined;
}

export async function sendCustomerEmail(input: {
  restaurant: Restaurant;
  to: string;
  content: EmailContent;
  oneClickUrl: string | null; // the POST address for one-click unsubscribe
  seed?: boolean; // a dummy customer from the seed data
}): Promise<Delivery> {
  const { restaurant, content } = input;
  const route = routeEmail(input.to, {
    testMode: isTestMode(),
    allowed: [...builderEmails(), restaurant.owner_email ?? "", ...(process.env.TEST_EMAIL_ALLOW ?? "").split(",")].filter(Boolean),
    builder: builderEmails()[0] ?? null,
    seed: input.seed,
  });
  if (route.kind === "simulate") return { delivery: "simulated", id: null, to: null, redirectedFrom: null, reason: route.reason };

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Missing RESEND_API_KEY");
  const { html, text } = await renderEmail(content);
  const subject = route.redirectedFrom ? `[Test → ${route.redirectedFrom}] ${content.subject}` : content.subject;
  const { data, error } = await new Resend(apiKey).emails.send({
    from: fromHeader(restaurant.name, senderAddress(process.env)),
    to: route.to,
    replyTo: replyTo(restaurant),
    subject,
    html,
    text,
    headers: input.oneClickUrl
      ? { "List-Unsubscribe": `<${input.oneClickUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
      : undefined,
    tags: [{ name: "kind", value: content.kind }],
  });
  if (error) throw new Error(`Resend: ${error.message}`);
  return { delivery: "email", id: data?.id ?? null, to: route.to, redirectedFrom: route.redirectedFrom };
}

// A plain email to the builder (alerts about the system itself, never to customers or owners).
export async function sendBuilderEmail(to: string, subject: string, text: string) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Missing RESEND_API_KEY");
  const { data, error } = await new Resend(apiKey).emails.send({
    from: fromHeader("Naila alerts", senderAddress(process.env, "alerts")),
    to,
    subject,
    text,
  });
  if (error) throw new Error(`Resend: ${error.message}`);
  return data?.id ?? null;
}

type Person = { name: string; email: string; unsubscribe_token: string | null; source?: string | null };
const oneClick = (baseUrl: string, p: Person) => (p.unsubscribe_token ? `${baseUrl}/api/unsubscribe/${p.unsubscribe_token}` : null);

export function sendConfirmEmail(i: { restaurant: Restaurant; customer: Person & { confirm_token: string }; baseUrl: string }) {
  const content = confirmContent(brandFor(i.restaurant), {
    firstName: i.customer.name,
    reward: i.restaurant.signup_reward ?? "a little welcome treat",
    confirmUrl: `${i.baseUrl}/confirm/${i.customer.confirm_token}`,
    links: customerLinks(i.baseUrl, i.customer.unsubscribe_token),
  });
  return sendCustomerEmail({ restaurant: i.restaurant, to: i.customer.email, content, oneClickUrl: null });
}

export function sendWelcomeEmail(i: { restaurant: Restaurant; customer: Person; reward: { token: string; reward: string }; baseUrl: string }) {
  const content = welcomeContent(brandFor(i.restaurant), {
    firstName: i.customer.name,
    reward: i.reward.reward,
    rewardUrl: `${i.baseUrl}/reward/${i.reward.token}`,
    links: customerLinks(i.baseUrl, i.customer.unsubscribe_token),
  });
  return sendCustomerEmail({ restaurant: i.restaurant, to: i.customer.email, content, oneClickUrl: oneClick(i.baseUrl, i.customer) });
}

export function campaignEmailContent(i: {
  restaurant: Restaurant;
  campaign: { subject: string; body: string; offer: string; is_birthday: boolean };
  validity: string;
  baseUrl: string;
  token: string;
  firstName: string;
  unsubscribeToken: string | null;
  ownerCopy: boolean;
  track?: boolean;
}) {
  return campaignContent(brandFor(i.restaurant), {
    birthday: i.campaign.is_birthday,
    subject: i.campaign.subject,
    body: i.campaign.body,
    offer: i.campaign.offer,
    validity: i.validity,
    firstName: i.firstName,
    offerUrl: `${i.baseUrl}/offer/${i.token}`,
    links: customerLinks(i.baseUrl, i.unsubscribeToken),
    ownerCopy: i.ownerCopy,
    trackingPixel: i.track === false ? null : `${i.baseUrl}/api/t/open/${i.token}`,
  });
}

export function sendCampaignEmail(i: Parameters<typeof campaignEmailContent>[0] & { to: string; seed?: boolean }) {
  const content = campaignEmailContent(i);
  const oneClickUrl = i.unsubscribeToken ? `${i.baseUrl}/api/unsubscribe/${i.unsubscribeToken}` : null;
  return sendCustomerEmail({ restaurant: i.restaurant, to: i.to, content, oneClickUrl, seed: i.seed });
}

export function sendFeedbackEmail(i: { restaurant: Restaurant; customer: Person; token: string; googleUrl: string; baseUrl: string }) {
  const content = feedbackContent(brandFor(i.restaurant), {
    firstName: i.customer.name,
    feedbackUrl: `${i.baseUrl}/feedback/${i.token}`,
    googleUrl: i.googleUrl,
    links: customerLinks(i.baseUrl, i.customer.unsubscribe_token),
  });
  return sendCustomerEmail({ restaurant: i.restaurant, to: i.customer.email, content, oneClickUrl: oneClick(i.baseUrl, i.customer), seed: i.customer.source === "seed" });
}
