import "server-only";
import { formatValidity, getCampaignForDraft } from "@/lib/campaigns";
import { check, type Draft } from "@/lib/drafts";
import { signLink, verifyLink } from "@/lib/signed-links";
import { appUrl, getSupabase, type Restaurant } from "@/lib/supabase";
import { brandFor } from "./brand";
import { confirmContent, feedbackContent, googleReviewUrl, welcomeContent, type EmailContent } from "./content";
import { campaignEmailContent, customerLinks } from "./index";

// Preview images of emails for WhatsApp. Twilio fetches the picture from our
// site, so the link is public but signed (it only works for that one email, for
// a week) and shows sample links, never a real customer's.

export const SAMPLE_KINDS = ["confirm", "welcome", "feedback"] as const;
export type SampleKind = (typeof SAMPLE_KINDS)[number];

const PURPOSE = "email-preview";
const WEEK = 7 * 86_400_000;

// Twilio can only fetch pictures from a public https address (not localhost).
const publicSite = () => appUrl().startsWith("https://");

function previewUrl(subject: string) {
  return `${appUrl()}/api/email-preview/${subject}?s=${signLink(PURPOSE, subject, WEEK)}`;
}

export function draftPreviewUrl(draft: Pick<Draft, "id" | "kind" | "version">) {
  if (draft.kind !== "email_campaign" || !publicSite()) return null;
  return `${previewUrl(`draft-${draft.id}`)}&v=${draft.version}`;
}

// The real email as a web page (the app opens it full screen). Signed like the picture.
export function draftPreviewHtmlUrl(draft: Pick<Draft, "id" | "kind" | "version">) {
  if (draft.kind !== "email_campaign") return null;
  return `${previewUrl(`draft-${draft.id}`)}&v=${draft.version}&format=html`;
}

export function samplePreviewUrl(restaurantId: string, kind: SampleKind) {
  return publicSite() ? previewUrl(`${kind}-${restaurantId}`) : null;
}

export const verifyPreview = (subject: string, sig: string | null) => verifyLink(PURPOSE, subject, sig);

const SAMPLE_NAME = "Sam";

// The content behind a preview: a campaign draft, or one of the fixed emails with sample details.
// look: draw a campaign in another of its family's looks (the app's email page shows each before one is chosen).
export async function previewContent(subject: string, look?: string | null): Promise<EmailContent | null> {
  const m = subject.match(/^(draft|confirm|welcome|feedback)-([0-9a-f-]{36})$/);
  if (!m) return null;
  const [, kind, id] = m;
  const supabase = getSupabase();
  const base = appUrl();

  if (kind === "draft") {
    const draft = check(await supabase.from("drafts").select("id, restaurant_id").eq("id", id).maybeSingle<{ id: string; restaurant_id: string }>());
    const campaign = draft ? await getCampaignForDraft(draft.id) : null;
    const restaurant = draft ? await loadRestaurant(draft.restaurant_id) : null;
    if (!campaign || !restaurant) return null;
    const { designOf, LOOKS } = await import("./designs");
    const saved = designOf(campaign);
    const shown = look && (LOOKS[saved.family] as readonly string[]).includes(look) ? { ...saved, look: look as typeof saved.look } : saved;
    return campaignEmailContent({
      restaurant,
      campaign: { ...campaign, email_design: shown },
      validity: formatValidity(campaign.valid_from, campaign.valid_until),
      baseUrl: base,
      token: "preview",
      firstName: "[First name]",
      unsubscribeToken: "preview",
      ownerCopy: false,
      track: false,
    });
  }
  const restaurant = await loadRestaurant(id);
  if (!restaurant) return null;
  return sampleContent(restaurant, kind as SampleKind);
}

export function sampleContent(restaurant: Restaurant, kind: SampleKind): EmailContent {
  const base = appUrl();
  const brand = brandFor(restaurant);
  const links = customerLinks(base, "preview");
  const reward = restaurant.signup_reward ?? "a little welcome treat";
  if (kind === "confirm") return confirmContent(brand, { firstName: SAMPLE_NAME, reward, confirmUrl: `${base}/confirm/preview`, links });
  if (kind === "welcome") return welcomeContent(brand, { firstName: SAMPLE_NAME, reward, rewardUrl: `${base}/reward/preview`, links });
  return feedbackContent(brand, { firstName: SAMPLE_NAME, feedbackUrl: `${base}/feedback/preview`, googleUrl: googleReviewUrl(restaurant), links });
}

async function loadRestaurant(id: string) {
  return check(await getSupabase().from("restaurants").select("*").eq("id", id).maybeSingle<Restaurant>());
}
