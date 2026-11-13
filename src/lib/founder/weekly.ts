import "server-only";
import { appUrl, getSupabase } from "@/lib/supabase";
import { founderEmails } from "./emails";
import { loadOverview } from "./data";
import { weeklyDue, weeklyText } from "./weekly-rules";

// The founder's Monday email: the headline numbers and who needs a call, from the
// hourly job at 8am UK on Mondays, once (founder_settings.weekly_sent_on).
// Never throws: it must not stop the hourly run.

export async function sendFounderWeekly(now = new Date()) {
  try {
    const to = founderEmails()[0];
    if (!to) return "no FOUNDER_EMAIL";
    const db = getSupabase();
    const { data, error } = await db.from("founder_settings").select("value").eq("key", "weekly_sent_on").maybeSingle<{ value: string }>();
    if (error) return `skipped: ${error.message}`;
    const due = weeklyDue(now, data?.value ?? null);
    if (!due) return "not due";
    // Claim the week first, so two runs never both send.
    await db.from("founder_settings").upsert({ key: "weekly_sent_on", value: due, updated_at: now.toISOString() }, { onConflict: "key" });
    const o = await loadOverview({ now });
    const { subject, text } = weeklyText(o, appUrl());
    const { sendBuilderEmail } = await import("@/lib/email");
    await sendBuilderEmail(to, subject, text);
    return "sent";
  } catch (err) {
    console.error("The founder's Monday email failed", err);
    return "failed";
  }
}
