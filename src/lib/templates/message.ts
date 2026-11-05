import "server-only";
import { safeTemplateUrls, TEMPLATE_LINK_DAYS } from "./links";

// The SPREADSHEETS reply on WhatsApp: each sheet with its link and what it's for.
export function spreadsheetsText(restaurantId: string) {
  const u = safeTemplateUrls(restaurantId);
  if (!u) return "Sorry, I can't make the spreadsheet links right now. You can download them from your settings page.";
  return [
    "📊 *Your spreadsheets* (fill one in and send it back here):",
    `• *Menu costs*: your dishes and prices are filled in; add roughly what each costs to make. ${u.menu_costs}`,
    `• *Team*: one row per person, for your rotas. ${u.staff}`,
    `• *Daily takings*: only if your till can't export your sales. ${u.daily_takings}`,
    `• *Example till export*: what to ask your till for. ${u.sales_example}`,
    `_Links work for ${TEMPLATE_LINK_DAYS} days. Your costs are private: never shown to customers._`,
  ].join("\n");
}
