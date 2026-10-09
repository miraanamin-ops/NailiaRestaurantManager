import "server-only";
import type { RestaurantContext } from "@/lib/assistant";
import { formatValidity, SEGMENT_LABELS, type CampaignFields } from "@/lib/campaigns";
import { KIND_LABELS, type DraftKind } from "@/lib/drafts";
import { aiCheck } from "./ai";
import { misleadingClaims } from "./compliance";
import { moneyAtDraft } from "./money";
import { checkResult, type DraftChecks } from "./types";

export * from "./types";

// Every new or edited draft goes through all four checks before the owner sees it:
// facts (AI) first, then brand and tone (AI) on the corrected text, then the two
// code checks. The code checks run again at send time (lib/send.ts).

async function runAll(
  ctx: RestaurantContext,
  label: string,
  context: string | undefined,
  fields: Record<string, string>,
  offer?: { validFrom: string; validUntil: string },
) {
  const facts = await aiCheck(ctx, "facts", { label, context, fields });
  const tone = await aiCheck(ctx, "tone", { label, context, fields: facts.fields });
  const text = Object.values(tone.fields).join("\n");
  const checks: DraftChecks = {
    tone: tone.result,
    facts: facts.result,
    compliance: checkResult([], misleadingClaims(text, offer)),
    money: checkResult([], moneyAtDraft(text, ctx.discountCapPercent)),
  };
  return { fields: tone.fields, checks };
}

export async function checkDraft(
  ctx: RestaurantContext,
  draft: { kind: DraftKind; audience: string; content: string; context?: string },
) {
  const { fields, checks } = await runAll(ctx, `${KIND_LABELS[draft.kind]} for ${draft.audience}`, draft.context, { content: draft.content });
  return { content: fields.content, checks };
}

export async function checkCampaign(ctx: RestaurantContext, campaign: CampaignFields) {
  const context = `Email campaign "${campaign.name}" to ${SEGMENT_LABELS[campaign.segment]}, valid ${formatValidity(campaign.valid_from, campaign.valid_until)} (${campaign.valid_from} to ${campaign.valid_until}). The offer link, opening hours and unsubscribe link are added to the email automatically, so don't flag them as missing.`;
  const { fields, checks } = await runAll(
    ctx,
    "Email campaign",
    context,
    { subject: campaign.subject, body: campaign.body, offer: campaign.offer },
    { validFrom: campaign.valid_from, validUntil: campaign.valid_until },
  );
  return { fields: { ...campaign, subject: fields.subject, body: fields.body, offer: fields.offer }, checks };
}
