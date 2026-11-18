import "server-only";
import { Resend } from "resend";
import { builderEmails } from "@/lib/builder-emails";
import { redirectEmails } from "@/lib/gate-rules";
import { emailRedirectSwitch } from "@/lib/switches";
import type { Restaurant } from "@/lib/supabase";
import { brandFor } from "./brand";
import { campaignContent, confirmContent, feedbackContent, welcomeContent, importWelcomeContent, type EmailContent, type Links } from "./content";
import { fromHeader, isEmail, routeEmail, senderAddress } from "./route";
import { renderEmail } from "./templates";
import { bigDay, bigNumber, dateTile, designOf, occasionOf, offerDish, prices, type CampaignLike } from "./designs";
import type { DesignFacts } from "./content";
import { backoffMs, BATCH_SIZE, chunk, isRetryable, MAX_ATTEMPTS } from "./batch-rules";

// Sending customer emails. Every one:
//   - comes from our verified domain with the restaurant's name ("Ember & Spice Grill <hello@mail.dinerai.co.uk>")
//   - has reply-to set to the restaurant's email, so replies reach the owner
//   - has an unsubscribe and a delete-my-data link in the footer, plus the
//     one-click unsubscribe headers Gmail, Outlook and Apple Mail use
//   - goes through routeEmail (./route.ts): dummy addresses are never emailed,
//     and with EMAIL_REDIRECT on, nothing reaches anyone but the builder and the owner.

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

type CustomerEmailInput = {
  restaurant: Restaurant;
  to: string;
  content: EmailContent;
  oneClickUrl: string | null; // the POST address for one-click unsubscribe
  seed?: boolean; // a dummy customer from the seed data
};

type Prepared =
  | { kind: "simulate"; delivery: Delivery }
  | { kind: "send"; payload: Parameters<Resend["emails"]["send"]>[0] & { html: string }; to: string; redirectedFrom: string | null };

// Works out who really gets one email (routeEmail) and builds what Resend is sent.
async function prepareCustomerEmail(input: CustomerEmailInput): Promise<Prepared> {
  const { restaurant, content } = input;
  const route = routeEmail(input.to, {
    redirect: redirectEmails(emailRedirectSwitch(process.env).on, restaurant),
    allowed: [...builderEmails(), restaurant.owner_email ?? "", ...(process.env.TEST_EMAIL_ALLOW ?? "").split(",")].filter(Boolean),
    builder: builderEmails()[0] ?? null,
    seed: input.seed,
  });
  if (route.kind === "simulate") return { kind: "simulate", delivery: { delivery: "simulated", id: null, to: null, redirectedFrom: null, reason: route.reason } };
  const { html, text } = await renderEmail(content);
  const subject = route.redirectedFrom ? `[Test → ${route.redirectedFrom}] ${content.subject}` : content.subject;
  return {
    kind: "send",
    to: route.to,
    redirectedFrom: route.redirectedFrom,
    payload: {
      from: fromHeader(restaurant.name, senderAddress(process.env)),
      to: route.to,
      replyTo: replyTo(restaurant),
      subject,
      html,
      text,
      headers: input.oneClickUrl ? { "List-Unsubscribe": `<${input.oneClickUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : undefined,
      tags: [{ name: "kind", value: content.kind }],
    },
  };
}

function resendClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Missing RESEND_API_KEY");
  return new Resend(apiKey);
}

// Runs one Resend call, trying again (up to MAX_ATTEMPTS) when the failure is worth it.
async function withRetries<T>(call: () => Promise<{ data: T | null; error: { message: string; name?: string | null; statusCode?: number | null } | null }>) {
  for (let attempt = 1; ; attempt++) {
    let res: Awaited<ReturnType<typeof call>>;
    try {
      res = await call();
    } catch (err) {
      res = { data: null, error: { message: err instanceof Error ? err.message : String(err), statusCode: null } };
    }
    if (!res.error) return res.data;
    if (attempt >= MAX_ATTEMPTS || !isRetryable(res.error)) throw new Error(`Resend: ${res.error.message}`);
    await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)));
  }
}

export async function sendCustomerEmail(input: CustomerEmailInput): Promise<Delivery> {
  const prepared = await prepareCustomerEmail(input);
  if (prepared.kind === "simulate") return prepared.delivery;
  const resend = resendClient();
  const data = await withRetries(() => resend.emails.send(prepared.payload));
  return { delivery: "email", id: data?.id ?? null, to: prepared.to, redirectedFrom: prepared.redirectedFrom };
}

// Many customer emails in Resend batches of up to 100 (security review E1). Each batch
// has an idempotency key (keyPrefix + its number) so a retry never sends twice.
// Returns one result per input, in order: a Delivery, or the Error that batch ended with.
export async function sendCustomerEmails(inputs: CustomerEmailInput[], keyPrefix: string): Promise<(Delivery | Error)[]> {
  const results: (Delivery | Error)[] = new Array(inputs.length);
  const toSend: { index: number; prepared: Extract<Prepared, { kind: "send" }> }[] = [];
  for (const [index, input] of inputs.entries()) {
    try {
      const prepared = await prepareCustomerEmail(input);
      if (prepared.kind === "simulate") results[index] = prepared.delivery;
      else toSend.push({ index, prepared });
    } catch (err) {
      results[index] = err instanceof Error ? err : new Error(String(err));
    }
  }
  if (!toSend.length) return results;
  const resend = resendClient();
  for (const [n, group] of chunk(toSend, BATCH_SIZE).entries()) {
    try {
      const data = await withRetries(() => resend.batch.send(group.map((g) => g.prepared.payload), { idempotencyKey: `${keyPrefix}:${n}` }));
      const ids = (data as { data?: { id: string }[] } | null)?.data ?? [];
      group.forEach((g, i) => {
        results[g.index] = { delivery: "email", id: ids[i]?.id ?? null, to: g.prepared.to, redirectedFrom: g.prepared.redirectedFrom };
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      for (const g of group) results[g.index] = error;
    }
  }
  return results;
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

// An imported contact's welcome (064): why they're on the list, the reward, one-click unsubscribe.
export function sendImportWelcomeEmail(i: { restaurant: Restaurant; customer: Person; reason: string; reward: { token: string; reward: string } | null; baseUrl: string }) {
  const content = importWelcomeContent(brandFor(i.restaurant), {
    firstName: i.customer.name,
    reason: i.reason,
    reward: i.reward?.reward ?? null,
    rewardUrl: i.reward ? `${i.baseUrl}/reward/${i.reward.token}` : null,
    links: customerLinks(i.baseUrl, i.customer.unsubscribe_token),
  });
  return sendCustomerEmail({ restaurant: i.restaurant, to: i.customer.email, content, oneClickUrl: oneClick(i.baseUrl, i.customer) });
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

// The design facts for a campaign (lib/email/designs.ts): its saved look, the dish, the
// big number, the day or occasion, all from the campaign and the restaurant's own menu.
export function campaignDesignFacts(restaurant: Restaurant, campaign: CampaignLike, validity: string, firstName: string): DesignFacts {
  const design = designOf(campaign);
  const dish = offerDish(campaign, restaurant.menu);
  const conditions = campaign.offer_details?.conditions?.trim() || null;
  return {
    family: design.family,
    look: design.look,
    photoUrl: design.photo_url && /^https:\/\//.test(design.photo_url) ? design.photo_url : null,
    dish,
    big: bigNumber(campaign),
    prices: prices(campaign, dish),
    day: bigDay(campaign),
    occasion: design.family === "occasion" ? (occasionOf(`${campaign.name}\n${campaign.subject}`) ?? occasionOf(campaign.body)) : null,
    date: dateTile(campaign.valid_from ?? null),
    validity,
    conditions,
    firstName,
    ownerFirst: (restaurant.owner_name ?? "").trim().split(/\s+/)[0] || null,
  };
}

export function campaignEmailContent(i: {
  restaurant: Restaurant;
  campaign: { subject: string; body: string; offer: string; is_birthday: boolean } & Partial<CampaignLike>;
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
    // A campaign row (with its id and dates) gets its design; anything less, the plain layout.
    design: i.campaign.id && i.campaign.valid_from
      ? campaignDesignFacts(i.restaurant, i.campaign as CampaignLike, i.validity, i.firstName)
      : null,
  });
}

export function sendCampaignEmail(i: Parameters<typeof campaignEmailContent>[0] & { to: string; seed?: boolean }) {
  const content = campaignEmailContent(i);
  const oneClickUrl = i.unsubscribeToken ? `${i.baseUrl}/api/unsubscribe/${i.unsubscribeToken}` : null;
  return sendCustomerEmail({ restaurant: i.restaurant, to: i.to, content, oneClickUrl, seed: i.seed });
}

// The inputs for one campaign email, for sendCustomerEmails (a whole campaign at once).
export function campaignEmailInput(i: Parameters<typeof campaignEmailContent>[0] & { to: string; seed?: boolean }): CustomerEmailInput {
  const content = campaignEmailContent(i);
  const oneClickUrl = i.unsubscribeToken ? `${i.baseUrl}/api/unsubscribe/${i.unsubscribeToken}` : null;
  return { restaurant: i.restaurant, to: i.to, content, oneClickUrl, seed: i.seed };
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

// An email from Dina to the restaurant's owner (e.g. the steps to add DinerAI on
// Google). With EMAIL_REDIRECT on (or for a test site), a demo restaurant's owner
// email goes to the builder instead: test sign-ups use made-up addresses, which
// may belong to a real stranger. A real restaurant's owner gets their own.
// attachments: files sent with it (e.g. the monthly report's PDF).
export async function sendOwnerEmail(
  restaurant: Restaurant,
  email: { subject: string; text: string; html: string; attachments?: { filename: string; content: Buffer }[]; kind?: string },
): Promise<Delivery> {
  const to = restaurant.owner_email?.trim();
  if (!to || !isEmail(to)) return { delivery: "simulated", id: null, to: null, redirectedFrom: null, reason: "no owner email" };
  const route = routeEmail(to, {
    redirect: redirectEmails(emailRedirectSwitch(process.env).on, restaurant),
    allowed: [...builderEmails(), ...(restaurant.is_demo ? [] : [to]), ...(process.env.TEST_EMAIL_ALLOW ?? "").split(",")].filter(Boolean),
    builder: builderEmails()[0] ?? null,
  });
  if (route.kind === "simulate") return { delivery: "simulated", id: null, to: null, redirectedFrom: null, reason: route.reason };
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Missing RESEND_API_KEY");
  const { data, error } = await new Resend(apiKey).emails.send({
    from: fromHeader("Dina at DinerAI", senderAddress(process.env)),
    to: route.to,
    subject: route.redirectedFrom ? `[Test → ${route.redirectedFrom}] ${email.subject}` : email.subject,
    text: email.text,
    html: email.html,
    ...(email.attachments?.length ? { attachments: email.attachments } : {}),
    tags: [{ name: "kind", value: email.kind ?? "owner_setup" }],
  });
  if (error) throw new Error(`Resend: ${error.message}`);
  return { delivery: "email", id: data?.id ?? null, to: route.to, redirectedFrom: route.redirectedFrom };
}
