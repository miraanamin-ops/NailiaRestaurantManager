// What each customer email says, as plain data. The HTML email (templates.tsx)
// and the WhatsApp preview image (preview-image.tsx) both draw from this, so the
// preview the owner approves matches what customers get. No imports beyond the
// brand rules, so it's unit-tested (tests/email.test.ts).
import { COPY, type Brand } from "./brand";

export type EmailKind = "confirm" | "welcome" | "campaign" | "birthday" | "feedback";

export type EmailButton = { label: string; url: string; style: "primary" | "secondary" };

export type EmailContent = {
  kind: EmailKind;
  subject: string;
  preheader: string; // the grey line shown after the subject in the inbox
  brand: Brand;
  banner: string | null; // a small line above the heading, e.g. "Birthday treat"
  heading: string;
  paragraphs: string[];
  offer: { title: string; detail: string } | null;
  stars: string[] | null; // feedback: five links, 1 to 5 stars, to the private form
  buttons: EmailButton[];
  note: string | null; // small print under the buttons
  signOff: string | null;
  footer: {
    reason: string;
    unsubscribeUrl: string | null; // null only on the owner's own copy and the confirm email
    deleteUrl: string | null;
    ownerCopy: boolean;
  };
  trackingPixel: string | null;
};

export type Links = { unsubscribe: string | null; deleteData: string | null };

const firstOf = (name: string) => name.trim().split(/\s+/)[0] || "there";

function footer(brand: Brand, reason: string, links: Links, ownerCopy = false): EmailContent["footer"] {
  return { reason, unsubscribeUrl: links.unsubscribe, deleteUrl: links.deleteData, ownerCopy };
}

const base = (brand: Brand) => ({ brand, banner: null, offer: null, stars: null, note: null, trackingPixel: null });

// Double opt-in: nothing else is sent until this link is clicked.
export function confirmContent(brand: Brand, i: { firstName: string; reward: string; confirmUrl: string; links: Links }): EmailContent {
  const c = COPY[brand.tone];
  return {
    ...base(brand),
    kind: "confirm",
    subject: `Confirm your email for ${brand.name}`,
    preheader: `One tap and your reward (${i.reward}) is on its way.`,
    heading: c.confirmHeading(firstOf(i.firstName)),
    paragraphs: [c.confirmBody(brand.name, i.reward)],
    buttons: [{ label: "Confirm my email", url: i.confirmUrl, style: "primary" }],
    note: "Didn't sign up? Just ignore this email: you won't hear from us again. The link works for 7 days.",
    signOff: brand.signOff,
    footer: footer(brand, `Someone (hopefully you) entered this address on ${brand.name}'s sign-up page.`, i.links),
  };
}

export function welcomeContent(brand: Brand, i: { firstName: string; reward: string; rewardUrl: string; links: Links }): EmailContent {
  const c = COPY[brand.tone];
  return {
    ...base(brand),
    kind: "welcome",
    subject: `Welcome to ${brand.name}! Your reward is inside 🎁`,
    preheader: `${i.reward}, on the house. Show it at the till on your next visit.`,
    heading: c.welcomeHeading(firstOf(i.firstName)),
    paragraphs: [c.welcomeBody(i.reward), "Next time you're in, tap the button below at the till and show the screen to our staff."],
    offer: { title: i.reward, detail: "Your welcome reward" },
    buttons: [{ label: "Show at the till", url: i.rewardUrl, style: "primary" }],
    note: 'Only tap "Redeem now" when you\'re at the till: the reward can be used once and lasts 10 minutes after you tap it.',
    signOff: brand.signOff,
    footer: footer(brand, `You're getting this because you signed up at ${brand.name}.`, i.links),
  };
}

// A campaign or birthday email: the wording the owner approved, plus the offer and its link.
export function campaignContent(
  brand: Brand,
  i: {
    birthday: boolean;
    subject: string;
    body: string;
    offer: string;
    validity: string;
    firstName: string; // "[First name]" on the owner's copy and the preview
    offerUrl: string;
    links: Links;
    ownerCopy: boolean;
    trackingPixel: string | null;
  },
): EmailContent {
  const personal = (s: string) => s.replaceAll("{first_name}", i.firstName);
  const paragraphs = personal(i.body).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return {
    ...base(brand),
    kind: i.birthday ? "birthday" : "campaign",
    subject: `${i.ownerCopy ? "[Your copy] " : ""}${personal(i.subject)}`,
    preheader: `${i.offer} · valid ${i.validity}`,
    banner: i.birthday ? "🎂 A birthday treat for you" : null,
    heading: i.birthday ? `Happy birthday, ${i.firstName}!` : personal(i.subject),
    paragraphs,
    offer: { title: i.offer, detail: `Valid ${i.validity}` },
    buttons: [{ label: "Show at the till", url: i.offerUrl, style: "primary" }],
    note: 'One use per person. Tap "Redeem now" at the till on a valid day; it lasts 10 minutes.',
    signOff: brand.signOff,
    footer: i.ownerCopy
      ? footer(brand, "This is your owner copy. Customers' emails have unsubscribe and delete-my-data links here.", { unsubscribe: null, deleteData: null }, true)
      : footer(brand, `You're getting this because you signed up at ${brand.name} and asked for offers by email.`, i.links),
    trackingPixel: i.trackingPixel,
  };
}

// "How was your visit?" The Google review link goes to EVERY customer, whatever
// they think of their visit: it's shown before any rating, the same for everyone.
// (Only asking happy customers for Google reviews breaks Google's rules.)
export function feedbackContent(brand: Brand, i: { firstName: string; feedbackUrl: string; googleUrl: string; links: Links }): EmailContent {
  const c = COPY[brand.tone];
  return {
    ...base(brand),
    kind: "feedback",
    subject: `How was your visit to ${brand.name}?`,
    preheader: "Two quick ways to tell us: a Google review, or a private note to the owner.",
    heading: c.feedbackHeading(firstOf(i.firstName)),
    paragraphs: [
      c.feedbackBody(brand.name),
      "Tap a star to tell us privately: it goes straight to the owner. And if you have a minute, a Google review helps other people find us.",
    ],
    stars: [1, 2, 3, 4, 5].map((n) => `${i.feedbackUrl}?rating=${n}`),
    buttons: [
      { label: "Leave a Google review", url: i.googleUrl, style: "primary" },
      { label: "Tell us privately", url: i.feedbackUrl, style: "secondary" },
    ],
    signOff: brand.signOff,
    footer: footer(brand, `You're getting this because you used a reward or offer from ${brand.name}. We only ask once a month at most.`, i.links),
  };
}

// The link that opens Google's "write a review" box for this restaurant.
export function googleReviewUrl(r: { google_place_id: string | null; name: string; address: string | null }) {
  if (r.google_place_id) return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(r.google_place_id)}`;
  const q = [r.name, r.address].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

// The plain-text version (every email has one; spam filters and some readers want it).
export function plainText(c: EmailContent) {
  const lines = [c.banner, c.heading, "", ...c.paragraphs.flatMap((p) => [p, ""])].filter((l) => l !== null) as string[];
  if (c.offer) lines.push(c.offer.title, c.offer.detail, "");
  if (c.stars) lines.push(`Rate your visit privately: ${c.stars[0].replace(/\?rating=1$/, "")}`, "");
  for (const b of c.buttons) lines.push(`${b.label}: ${b.url}`);
  if (c.note) lines.push("", c.note);
  if (c.signOff) lines.push("", c.signOff);
  lines.push("", "--", `${c.brand.name}${c.brand.address ? ` · ${c.brand.address}` : ""}`, c.footer.reason);
  if (c.footer.unsubscribeUrl) lines.push(`Unsubscribe: ${c.footer.unsubscribeUrl}`);
  if (c.footer.deleteUrl) lines.push(`Delete my data: ${c.footer.deleteUrl}`);
  return lines.join("\n");
}
