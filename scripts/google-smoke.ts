// Read-only check of a real connected Google location. Writes nothing to Google
// or to our database (a fresh access token is used for this run only).
//
//   node --env-file=.env.local scripts/google-smoke.ts <restaurant slug or id>
//
// Needs SUPABASE_URL, SUPABASE_SECRET_KEY, GOOGLE_TOKEN_KEY, GOOGLE_CLIENT_ID and
// GOOGLE_CLIENT_SECRET (the same values as on Vercel). The restaurant must have
// linked its location on /settings/google. Plain TypeScript that Node runs as is
// (no imports from src/, which needs Next.js).
import { createDecipheriv } from "node:crypto";
// @ts-expect-error: a plain .mjs helper without types
import { guardLive } from "./lib/live-guard.mjs";

// Real Google locations are linked on the live database: run it with the live settings and --live.
guardLive(process.env, "google-smoke");

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing ${k} (run with --env-file=.env.local)`);
  return v;
};

async function db<T>(path: string): Promise<T> {
  const res = await fetch(`${env("SUPABASE_URL")}/rest/v1/${path}`, { headers: { apikey: env("SUPABASE_SECRET_KEY"), Authorization: `Bearer ${env("SUPABASE_SECRET_KEY")}` } });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

function decrypt(stored: string) {
  const [v, iv, tag, data] = stored.split(".");
  if (v !== "v1") throw new Error("Unreadable stored token");
  const d = createDecipheriv("aes-256-gcm", Buffer.from(env("GOOGLE_TOKEN_KEY"), "base64"), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}

let token = "";
async function google<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${new URL(url).pathname}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

type Restaurant = { id: string; name: string; google_connection_id: string | null; google_account_id: string | null; google_location_id: string | null; google_location_title: string | null };
type Conn = { id: string; kind: string; google_email: string | null; status: string; refresh_token_enc: string };

async function step(name: string, run: () => Promise<string>) {
  try {
    console.log(`✅ ${name}: ${await run()}`);
    return true;
  } catch (err) {
    console.log(`❌ ${name}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

async function main() {
  const who = process.argv.slice(2).find((a) => a !== "--live");
  if (!who) throw new Error("Usage: node --env-file=.env.live.local scripts/google-smoke.ts <restaurant slug or id> --live");
  const filter = /^[0-9a-f-]{36}$/.test(who) ? `id=eq.${who}` : `slug=eq.${encodeURIComponent(who)}`;
  const [r] = await db<Restaurant[]>(`restaurants?${filter}&select=id,name,google_connection_id,google_account_id,google_location_id,google_location_title`);
  if (!r) throw new Error(`No restaurant ${who}`);
  if (!r.google_connection_id || !r.google_location_id || !r.google_account_id) throw new Error(`${r.name} hasn't linked a Google location yet (/settings/google)`);
  const [conn] = await db<Conn[]>(`google_connections?id=eq.${r.google_connection_id}&select=id,kind,google_email,status,refresh_token_enc`);
  if (!conn) throw new Error("Its Google login is missing");
  console.log(`${r.name} → ${r.google_location_title ?? r.google_location_id} (login: ${conn.kind}, ${conn.google_email}, status ${conn.status})\n`);

  const ok: boolean[] = [];
  ok.push(
    await step("Refresh the login", async () => {
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: env("GOOGLE_CLIENT_ID"), client_secret: env("GOOGLE_CLIENT_SECRET"), refresh_token: decrypt(conn.refresh_token_enc), grant_type: "refresh_token" }),
      });
      const json = (await res.json()) as { access_token?: string; scope?: string; error?: string; error_description?: string };
      if (!json.access_token) throw new Error(`${json.error}: ${json.error_description}`);
      token = json.access_token;
      return `ok (${json.scope?.includes("business.manage") ? "business.manage granted" : "business.manage MISSING"})`;
    }),
  );
  if (!token) process.exit(1);

  const v4 = `https://mybusiness.googleapis.com/v4/${r.google_account_id}/${r.google_location_id}`;
  ok.push(await step("Accounts", async () => {
    const res = await google<{ accounts?: { name: string; accountName?: string }[] }>("https://mybusinessaccountmanagement.googleapis.com/v1/accounts");
    return (res.accounts ?? []).map((a) => `${a.accountName ?? ""} (${a.name})`).join(", ") || "none";
  }));
  ok.push(await step("Locations in the linked account", async () => {
    const res = await google<{ locations?: { name: string; title?: string }[] }>(`https://mybusinessbusinessinformation.googleapis.com/v1/${r.google_account_id}/locations?readMask=name,title&pageSize=100`);
    const list = res.locations ?? [];
    return `${list.length} (${list.some((l) => l.name === r.google_location_id) ? "includes" : "DOES NOT include"} the linked one)`;
  }));
  ok.push(await step("Profile", async () => {
    const l = await google<{ title?: string; phoneNumbers?: { primaryPhone?: string }; regularHours?: { periods?: unknown[] }; categories?: { primaryCategory?: { displayName?: string } } }>(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${r.google_location_id}?readMask=title,phoneNumbers,regularHours,categories`,
    );
    return `${l.title}, ${l.phoneNumbers?.primaryPhone ?? "no phone"}, ${l.categories?.primaryCategory?.displayName ?? "no category"}, ${l.regularHours?.periods?.length ?? 0} opening periods`;
  }));
  ok.push(await step("Reviews", async () => {
    const res = await google<{ reviews?: { reviewer?: { displayName?: string }; starRating?: string; reviewReply?: object }[]; totalReviewCount?: number; averageRating?: number }>(`${v4}/reviews?pageSize=5&orderBy=updateTime%20desc`);
    const latest = (res.reviews ?? []).map((x) => `${x.reviewer?.displayName ?? "?"} ${x.starRating}${x.reviewReply ? " (replied)" : ""}`).join("; ");
    return `${res.totalReviewCount ?? 0} in total, average ${res.averageRating ?? "-"}. Latest: ${latest || "none"}`;
  }));
  ok.push(await step("Posts", async () => `${((await google<{ localPosts?: unknown[] }>(`${v4}/localPosts?pageSize=5`)).localPosts ?? []).length} recent`));
  ok.push(await step("Photos", async () => `${((await google<{ mediaItems?: unknown[] }>(`${v4}/media?pageSize=5`)).mediaItems ?? []).length} (first page)`));
  ok.push(await step("Performance, last 7 full days", async () => {
    const end = new Date(Date.now() - 3 * 86_400_000); // Google's numbers lag a few days
    const start = new Date(end.getTime() - 6 * 86_400_000);
    const p = new URLSearchParams();
    for (const m of ["CALL_CLICKS", "BUSINESS_DIRECTION_REQUESTS", "WEBSITE_CLICKS", "BUSINESS_IMPRESSIONS_MOBILE_MAPS", "BUSINESS_IMPRESSIONS_MOBILE_SEARCH", "BUSINESS_IMPRESSIONS_DESKTOP_MAPS", "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH"]) p.append("dailyMetrics", m);
    for (const [k, d] of [["start", start], ["end", end]] as const) {
      p.set(`dailyRange.${k}_date.year`, String(d.getUTCFullYear()));
      p.set(`dailyRange.${k}_date.month`, String(d.getUTCMonth() + 1));
      p.set(`dailyRange.${k}_date.day`, String(d.getUTCDate()));
    }
    const res = await google<{ multiDailyMetricTimeSeries?: { dailyMetricTimeSeries?: { dailyMetric?: string; timeSeries?: { datedValues?: { value?: string }[] } }[] }[] }>(
      `https://businessprofileperformance.googleapis.com/v1/${r.google_location_id}:fetchMultiDailyMetricsTimeSeries?${p}`,
    );
    const totals: Record<string, number> = {};
    for (const g of res.multiDailyMetricTimeSeries ?? []) for (const s of g.dailyMetricTimeSeries ?? []) totals[s.dailyMetric ?? "?"] = (s.timeSeries?.datedValues ?? []).reduce((n, v) => n + (Number(v.value) || 0), 0);
    const views = Object.entries(totals).filter(([k]) => k.startsWith("BUSINESS_IMPRESSIONS")).reduce((n, [, v]) => n + v, 0);
    return `views ${views}, calls ${totals.CALL_CLICKS ?? 0}, directions ${totals.BUSINESS_DIRECTION_REQUESTS ?? 0}, website clicks ${totals.WEBSITE_CLICKS ?? 0}`;
  }));

  const failed = ok.filter((x) => !x).length;
  console.log(failed ? `\n${failed} check(s) failed.` : "\nAll read-only checks passed.");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
