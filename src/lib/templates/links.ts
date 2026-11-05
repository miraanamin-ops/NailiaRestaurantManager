import "server-only";
import { signLink } from "@/lib/signed-links";
import { appUrl } from "@/lib/supabase";
import type { TemplateKind } from "./specs";

// Download links for the owner's spreadsheets: they work without logging in (a
// phone opening them from WhatsApp) for 14 days, for this restaurant only (the
// menu costs sheet has their own prices and costs). /templates/<kind>.
export const TEMPLATE_LINK_DAYS = 14;
export const TEMPLATE_KINDS: TemplateKind[] = ["menu_costs", "staff", "sales_example", "daily_takings"];
export const TEMPLATE_LABELS: Record<TemplateKind, string> = {
  menu_costs: "Menu costs sheet",
  staff: "Team sheet",
  sales_example: "Example till export",
  daily_takings: "Daily takings sheet",
};

export const templatePurpose = (kind: TemplateKind) => `template:${kind}`;

export function templateUrl(kind: TemplateKind, restaurantId: string) {
  const t = signLink(templatePurpose(kind), restaurantId, TEMPLATE_LINK_DAYS * 86_400_000);
  return `${appUrl()}/templates/${kind}?r=${encodeURIComponent(restaurantId)}&t=${encodeURIComponent(t)}`;
}

export function templateUrls(restaurantId: string) {
  return Object.fromEntries(TEMPLATE_KINDS.map((k) => [k, templateUrl(k, restaurantId)])) as Record<TemplateKind, string>;
}

// The same, or null if links can't be signed (no LINK_SECRET or CRON_SECRET set): pages just leave them out.
export function safeTemplateUrls(restaurantId: string) {
  try {
    return templateUrls(restaurantId);
  } catch {
    return null;
  }
}
