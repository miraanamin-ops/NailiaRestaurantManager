import "server-only";
import { formatValidity } from "@/lib/campaigns";
import { brandFor, type BrandInput } from "@/lib/email/brand";
import { campaignContent } from "@/lib/email/content";
import { emailPreviewImage } from "@/lib/email/preview-image";
import { campaignFieldsFrom, type GrowthDraftOutput } from "./growth-rules";

// A picture of Growth's email as a customer sees it on a phone (the same template
// and wording as a real send), for the checker's brand checks (B1 to B4) and the
// /log comparison. Null for a special idea or a question.
export async function growthPreviewPng(restaurant: BrandInput, d: GrowthDraftOutput): Promise<{ media_type: "image/png"; data: string } | null> {
  if (d.needs_owner_input || !d.offer || d.type === "special_idea") return null;
  const f = campaignFieldsFrom(d);
  const content = campaignContent(brandFor(restaurant), {
    birthday: d.type === "birthday_batch",
    subject: f.subject,
    body: f.body,
    offer: f.offer,
    validity: formatValidity(f.valid_from, f.valid_until),
    firstName: "[First name]",
    offerUrl: "https://app.dinerai.co.uk/offer/preview",
    links: { unsubscribe: "https://app.dinerai.co.uk/unsubscribe/preview", deleteData: "https://app.dinerai.co.uk/delete/preview" },
    ownerCopy: false,
    trackingPixel: null,
  });
  try {
    const png = await emailPreviewImage(content).arrayBuffer();
    return { media_type: "image/png", data: Buffer.from(png).toString("base64") };
  } catch (err) {
    console.error("Couldn't draw the email preview", err);
    return null;
  }
}

// What the offer email template adds to every campaign (not written by Growth), so
// the checker can tell the template's fixed wording from the draft's claims.
export const TEMPLATE_SOURCE = {
  ref: "template:offer_email",
  found: true as const,
  data: {
    meaning: "The email template adds these to every offer email, around the draft's own wording. They are part of the product, not claims made by the draft.",
    heading: "the subject line (campaigns) or 'Happy birthday, [First name]!' with a 'A birthday treat for you' banner (birthday emails)",
    offer_box: "the offer description and conditions, then 'Valid <dates>'",
    button: "Show at the till (opens the customer's own offer page)",
    note: 'One use per person. Tap "Redeem now" at the till on a valid day; it lasts 10 minutes.',
    sign_off: "the restaurant team's sign-off",
    footer: "why the customer is getting the email, an Unsubscribe link and a Delete my data link",
    first_name: "[First name] is filled in for each customer",
  },
};
