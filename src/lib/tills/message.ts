import "server-only";
import { appUrl, type Restaurant } from "@/lib/supabase";
import { queueTillSync } from "./actions";
import { PROVIDERS } from "./providers";
import { syncStatusLine } from "./rules";
import { tillFor } from "./store";
import { notReady } from "./sync";

// TILL and SYNC TILL on WhatsApp: where the till connection is up to, and a
// sync now. (Reading only, so it isn't a test command.)
export async function tillCommandText(r: Restaurant, syncNow: boolean) {
  const link = `${appUrl()}/settings/till?r=${r.id}`;
  const c = await tillFor(r.id).catch(() => null);
  if (!c) return `🧾 No till is connected yet. Connect Square, Epos Now, Lightspeed or Toast here and your sales come in every hour by themselves: ${link}`;
  const name = `${PROVIDERS[c.provider].name}${c.mode === "dummy" ? " (dummy, for testing)" : ""}`;
  const waiting = notReady(c);
  if (waiting) return `🧾 ${name} is connected, but first: ${waiting}. ${link}`;
  if (syncNow && c.status === "ok") {
    await queueTillSync(r.id, c.id);
    return `🧾 Reading new sales from ${name} now. They'll be in within a few minutes (send *SALES* to see them).`;
  }
  return `🧾 ${name}${c.location_name ? `: ${c.location_name}` : ""}\n${syncStatusLine(c, new Date())}\nSend *SYNC TILL* to read new sales now. Manage it here: ${link}`;
}
