import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import { logAction } from "@/lib/audit";
import { referralCodeOf, referralLink } from "@/lib/billing/referrals";
import { check } from "@/lib/drafts";
import { isMonthly } from "@/lib/report/monthly-rules";
import { reportExpired } from "@/lib/report/types";
import { signLink } from "@/lib/signed-links";
import { appUrl, getSupabase, type Restaurant } from "@/lib/supabase";
import { settingsChanges, settingsView, type SettingsInput } from "./settings-rules";

// The app's Reports tab and More tab (step 50, phase 5): the same data and the same
// server code as the website's dashboard. Every change is logged like the website's
// (saveProfileFields / logSetting / logAction), so UNDO and the activity log work.

// ---------- Reports ----------

const DAY = 86_400_000;

// The saved reports, newest first (weekly and monthly), as they were made: never recalculated.
export async function reportList(restaurantId: string) {
  const rows =
    check(
      await getSupabase()
        .from("reports")
        .select("token, period_start, period_end, created_at, data")
        .eq("restaurant_id", restaurantId)
        .order("created_at", { ascending: false })
        .limit(26)
        .returns<{ token: string; period_start: string; period_end: string; created_at: string; data: { kind?: string; period?: { label?: string }; figures?: { label?: string } } }[]>(),
    ) ?? [];
  return rows.map((r) => ({
    token: r.token,
    kind: isMonthly(r.data) ? ("monthly" as const) : ("weekly" as const),
    label: isMonthly(r.data) ? (r.data.figures?.label ?? "Monthly report") : (r.data.period?.label ?? "Weekly report"),
    createdAt: r.created_at,
  }));
}

// One report: its saved snapshot, for the app to draw, and a short link to its PDF
// (to download and share). Only the restaurant's own; the app's login stands in for
// the website link's 30 days.
export async function reportFor(restaurantId: string, token: string) {
  const row = check(
    await getSupabase().from("reports").select("token, restaurant_id, data, created_at, expires_at").eq("token", token).eq("restaurant_id", restaurantId).maybeSingle<{ token: string; restaurant_id: string; data: unknown; created_at: string; expires_at: string | null }>(),
  );
  if (!row) return null;
  return {
    token: row.token,
    kind: isMonthly(row.data) ? ("monthly" as const) : ("weekly" as const),
    data: row.data,
    pdfUrl: `${appUrl()}/api/report-pdf/${row.token}?s=${encodeURIComponent(signLink("report-pdf", row.token, DAY))}`,
    // The web page (with its own 30-day link), if it's still open.
    webUrl: reportExpired(row.expires_at, new Date()) ? null : `${appUrl()}/report/${row.token}`,
  };
}

// ---------- Customers ----------

export type CustomerRow = { id: string; name: string | null; email: string | null; created_at: string; email_confirmed_at: string | null; unsubscribed_at: string | null; source: string | null; import_status: string | null };

export function customerStatus(c: Pick<CustomerRow, "email_confirmed_at" | "unsubscribed_at" | "import_status">) {
  if (c.unsubscribed_at) return "Unsubscribed";
  if (c.import_status === "not_contacted") return "Imported, not emailed yet";
  if (c.email_confirmed_at) return "Signed up";
  return "Hasn't confirmed their email";
}

const PAGE = 50;

// The list (newest first, 50 at a time, searched by name or email), the counts, the
// sign-up link and its QR code, and the printable pack.
export async function customersFor(r: Restaurant, q: string, page: number) {
  const db = getSupabase();
  const term = q.trim().slice(0, 80).replace(/[%_,()]/g, " ").trim();
  let list = db
    .from("customers")
    .select("id, name, email, created_at, email_confirmed_at, unsubscribed_at, source, import_status", { count: "exact" })
    .eq("restaurant_id", r.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .range(page * PAGE, page * PAGE + PAGE - 1);
  if (term) list = list.or(`name.ilike.%${term}%,email.ilike.%${term}%`);
  const [rows, total, confirmed] = await Promise.all([
    list.returns<CustomerRow[]>(),
    db.from("customers").select("id", { count: "exact", head: true }).eq("restaurant_id", r.id).is("deleted_at", null),
    db.from("customers").select("id", { count: "exact", head: true }).eq("restaurant_id", r.id).is("deleted_at", null).not("email_confirmed_at", "is", null).is("unsubscribed_at", null),
  ]);
  const signupUrl = `${appUrl()}/r/${r.slug}`;
  const qrSvg = await QRCode.toString(signupUrl, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: r.brand_dark ?? "#0b0c0a", light: "#ffffff" } });
  return {
    total: total.count ?? 0,
    subscribed: confirmed.count ?? 0,
    matching: rows.count ?? 0,
    page,
    pageSize: PAGE,
    customers: (check(rows) ?? []).map((c) => ({ id: c.id, name: c.name, email: c.email, joined: c.created_at, status: customerStatus(c) })),
    signupUrl,
    qrSvg,
    qrPackUrl: `${appUrl()}/r/${r.slug}/qr-pack`,
  };
}

// The export: the same signed one-hour link as EXPORT CUSTOMERS on WhatsApp; only the
// download itself is logged (on the website's download page), so one export is one line.
const EXPORT_LINK_MS = 60 * 60_000;
export const exportLink = (r: Pick<Restaurant, "id">) => `${appUrl()}/export/download?r=${r.id}&t=${signLink("customer-export", r.id, EXPORT_LINK_MS)}`;

// ---------- Settings ----------

export const settingsFor = (r: Restaurant) => settingsView(r);

// Saved through the website's saveProfileFields (versioned, logged, UNDO-able); the
// notification choices on their own, logged as a setting.
export async function saveSettings(r: Restaurant, input: SettingsInput) {
  const { fields, alerts, problem } = settingsChanges(input, r);
  if (problem) return { ok: false as const, problem };
  if (Object.keys(fields).length) {
    const { saveProfileFields } = await import("@/lib/profile-edits");
    await saveProfileFields(r, fields as never, "Changed in the app");
  }
  if (alerts) {
    const before = settingsView(r).alerts;
    check(await getSupabase().from("restaurants").update({ app_alerts: alerts }).eq("id", r.id).select("id"));
    const off = Object.entries(alerts).filter(([, on]) => !on).map(([k]) => k);
    await logAction({ restaurantId: r.id, actor: "owner", action: "setting", detail: off.length ? `App notifications: ${off.join(", ")} off` : "App notifications: all on", data: { field: "app_alerts", before, after: alerts } });
  }
  return { ok: true as const };
}

// ---------- Recommend a restaurant ----------

export async function referralFor(r: Restaurant) {
  const code = await referralCodeOf(r);
  return { code, link: referralLink(code) };
}

// ---------- Help ----------

// The owner help guide (agents/help.md, the same one the assistant answers from), and
// where "Talk to a person" goes.
export async function helpGuide() {
  const text = (await readFile(path.join(process.cwd(), "agents", "help.md"), "utf8")).replace(/\r\n/g, "\n");
  // The note at the top is about how the assistant uses the guide: not for owners.
  const body = text.replace(/^# .*\n+[\s\S]*?\n---\n/, "");
  return { markdown: body.trim(), supportEmail: process.env.SUPPORT_EMAIL || "support@dinerai.co.uk" };
}
