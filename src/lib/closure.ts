import "server-only";
import { randomBytes } from "node:crypto";
import { after } from "next/server";
import { logAction } from "@/lib/audit";
import { alertBuilder } from "@/lib/builder-alerts";
import {
  canSkipCoolingOff,
  closedEmail,
  closeRefused,
  closesAt,
  closureKind,
  closureRef,
  confirmEmail,
  EXPORT_DAYS,
  googleClosing,
  nameMatches,
  type ClosureKind,
  type ClosureStatus,
} from "@/lib/closure-rules";
import { formatLondon } from "@/lib/clock";
import { exportCustomers } from "@/lib/customer-data";
import { csvCell } from "@/lib/customer-csv";
import { check } from "@/lib/drafts";
import { kickWorkers } from "@/lib/queue/kick";
import { enqueue } from "@/lib/queue/store";
import { getSupabase, type Restaurant } from "@/lib/supabase";

// Closing a restaurant's account (rules and the order of things: lib/closure-rules.ts).
// Builder only: the admin console page (/onboarding/admin/close) and its actions
// check the login. Every query is by this restaurant's id (or a closure's own id),
// and its files are only those under its own folder, so another restaurant is
// never touched (tests/closure.test.ts).

export class ClosureError extends Error {}

export const EXPORT_BUCKET = "account-exports";
// The restaurant's own folders in storage (as scripts/delete-restaurants.mjs).
const RESTAURANT_BUCKETS = ["post-photos", "sales-files", "onboarding-uploads"];
const MISSING = new Set(["42P01", "PGRST205"]);

export type Closure = {
  id: string;
  ref: string;
  restaurant_id: string | null;
  kind: ClosureKind;
  status: ClosureStatus;
  requested_at: string;
  confirmed_at: string | null;
  closes_at: string | null;
  skipped_cooling_off: boolean;
  paused_before: boolean | null;
  cancelled_at: string | null;
  closed_at: string | null;
  export_paths: { label: string; path: string }[] | null;
  export_expires_at: string | null;
  export_deleted_at: string | null;
  steps: Record<string, unknown>;
  counts: Record<string, number> | null;
  last_error: string | null;
};

async function restaurant(id: string) {
  const r = check(await getSupabase().from("restaurants").select("*").eq("id", id).maybeSingle<Restaurant>());
  if (!r) throw new ClosureError("That restaurant wasn't found");
  return r;
}

async function closure(id: string) {
  const c = check(await getSupabase().from("account_closures").select("*").eq("id", id).maybeSingle<Closure>());
  if (!c) throw new ClosureError("That closure wasn't found");
  return c;
}

const update = async (id: string, fields: Partial<Closure>) => check(await getSupabase().from("account_closures").update(fields).eq("id", id));
const audit = (restaurantId: string | null, detail: string, data: Record<string, unknown> = {}) => logAction({ restaurantId, actor: "builder", action: "closure", detail, data });

// ---------- Ask 1: request ----------

export async function requestClosure(restaurantId: string, typedName: string, builderEmail: string) {
  const r = await restaurant(restaurantId);
  const refused = closeRefused(r);
  if (refused) throw new ClosureError(refused);
  if (!nameMatches(typedName, r.name)) throw new ClosureError(`Nothing changed: type the restaurant's name exactly (${r.name}).`);
  const { data: open } = await getSupabase().from("account_closures").select("id").eq("restaurant_id", r.id).in("status", ["requested", "scheduled", "closing"]).limit(1);
  if (open?.length) throw new ClosureError(`${r.name} already has a closure in progress.`);
  const ref = closureRef(randomBytes(6));
  const row = check(await getSupabase().from("account_closures").insert({ ref, restaurant_id: r.id, kind: closureKind(r), status: "requested" }).select("*").single<Closure>())!;
  await audit(r.id, `Closing the account requested (${ref}) by ${builderEmail}: nothing changes until it's confirmed`, { ref });
  return row;
}

// ---------- Ask 2: confirm (the cooling-off starts) ----------

export async function confirmClosure(input: { closureId: string; typedName: string; understood: boolean; skipCoolingOff: boolean; builderEmail: string }) {
  const c = await closure(input.closureId);
  if (c.status !== "requested" || !c.restaurant_id) throw new ClosureError(`That closure is ${c.status}, so it can't be confirmed.`);
  const r = await restaurant(c.restaurant_id);
  if (!nameMatches(input.typedName, r.name)) throw new ClosureError(`Not confirmed: type the restaurant's name exactly (${r.name}) a second time.`);
  if (!input.understood) throw new ClosureError("Not confirmed: tick the box to say you understand everything will be deleted.");
  if (input.skipCoolingOff && !canSkipCoolingOff(r)) throw new ClosureError("Only a demo or Pilot Zero restaurant can skip the 24-hour cooling-off.");
  const now = new Date();
  const when = closesAt(r, now, input.skipCoolingOff);
  await update(c.id, { status: "scheduled", confirmed_at: now.toISOString(), closes_at: when.toISOString(), skipped_cooling_off: input.skipCoolingOff, paused_before: r.paused });
  // Nothing more goes to customers while it's closing.
  check(await getSupabase().from("restaurants").update({ paused: true, paused_at: now.toISOString() }).eq("id", r.id));
  const { sendOwnerEmail } = await import("@/lib/email");
  const mail = confirmEmail({ restaurant: r.name, closesAt: formatLondon(when), coolingOff: !input.skipCoolingOff });
  const delivery = await sendOwnerEmail(r, { ...mail, html: textHtml(mail.text) }).catch((err: unknown) => ({ delivery: "failed", reason: err instanceof Error ? err.message : String(err) }));
  await update(c.id, { steps: { ...c.steps, confirm_email: delivery.delivery } });
  await audit(r.id, `Closing the account confirmed (${c.ref}) by ${input.builderEmail}: ${input.skipCoolingOff ? "closing now (cooling-off skipped)" : `closes ${formatLondon(when)}`}; sending paused`, { ref: c.ref });
  if (input.skipCoolingOff) await queueClosing(c.id);
  return { closesAt: when };
}

// ---------- Cancel (until it's closing) ----------

export async function cancelClosure(closureId: string, builderEmail: string) {
  const c = await closure(closureId);
  if (c.status !== "requested" && c.status !== "scheduled" && c.status !== "failed") throw new ClosureError(`That closure is ${c.status}, so it can't be cancelled.`);
  await update(c.id, { status: "cancelled", cancelled_at: new Date().toISOString() });
  if (c.restaurant_id && c.paused_before === false) check(await getSupabase().from("restaurants").update({ paused: false, paused_at: null }).eq("id", c.restaurant_id));
  await audit(c.restaurant_id, `Closing the account cancelled (${c.ref}) by ${builderEmail}${c.paused_before === false ? "; sending back on" : ""}`, { ref: c.ref });
}

// A closure whose job failed: try again now.
export async function retryClosure(closureId: string, builderEmail: string) {
  const c = await closure(closureId);
  if (c.status !== "failed") throw new ClosureError(`That closure is ${c.status}.`);
  await update(c.id, { status: "scheduled", closes_at: new Date().toISOString(), last_error: null });
  await audit(c.restaurant_id, `Closing the account tried again (${c.ref}) by ${builderEmail}`, { ref: c.ref });
  await queueClosing(c.id);
}

async function queueClosing(closureId: string) {
  // A system job (no restaurant): the restaurant row, and its jobs, are deleted by it.
  await enqueue({ type: "account_close", restaurantId: null, key: `account_close:${closureId}:${Date.now()}`, payload: { closure: closureId }, priority: 20 });
  after(() => kickWorkers(1));
}

// The hourly dispatcher: closures whose cooling-off is over. Before 056, none.
export async function dueClosures(now: Date) {
  const res = await getSupabase().from("account_closures").select("id").eq("status", "scheduled").lte("closes_at", now.toISOString());
  if (res.error && MISSING.has(res.error.code)) return [];
  return ((check(res) ?? []) as { id: string }[]).map((c) => ({ id: c.id }));
}

// ---------- Closing ----------

// Every row of the restaurant's own data, page by page (a table not on this database is skipped).
async function rowsOf(table: string, restaurantId: string, columns = "*") {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const res = await getSupabase().from(table).select(columns).eq("restaurant_id", restaurantId).range(from, from + 999);
    if (res.error) {
      if (MISSING.has(res.error.code)) return out;
      throw new Error(`${table}: ${res.error.message}`);
    }
    const page = (res.data ?? []) as unknown as Record<string, unknown>[];
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

// What the owner gets: everything that's theirs (not our internal logs or logins).
const EXPORT_TABLES = ["customers", "consents", "rewards", "campaigns", "reviews", "drafts", "google_posts", "feedback", "sales_days", "sales_items", "staff", "rota_weeks", "rota_shifts", "reports", "messages", "onboarding_messages", "audit_log"];
const SECRET = /(token|secret|link_code|_enc$|password)/i;
const withoutSecrets = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([k]) => !SECRET.test(k)));

async function buildExport(c: Closure, r: Restaurant) {
  const data: Record<string, unknown> = { exported_at: new Date().toISOString(), restaurant: withoutSecrets(r as unknown as Record<string, unknown>) };
  for (const t of EXPORT_TABLES) data[t] = (await rowsOf(t, r.id)).map(withoutSecrets);
  const days = (data.sales_days as Record<string, unknown>[]).sort((a, b) => String(a.day).localeCompare(String(b.day)));
  const salesCsv = [["Day", "Net sales", "Gross sales", "Orders", "From"].map(csvCell).join(","), ...days.map((d) => [d.day, d.net_sales, d.gross_sales, d.transactions, d.source].map((v) => csvCell(v as string)).join(","))].join("\r\n") + "\r\n";
  const { csv } = await exportCustomers(r.id);
  const files = [
    { label: "Everything (JSON)", name: "account.json", body: JSON.stringify(data, null, 2), type: "application/json" },
    { label: "Customer list (CSV)", name: "customers.csv", body: csv, type: "text/csv" },
    { label: "Daily sales (CSV)", name: "sales.csv", body: salesCsv, type: "text/csv" },
  ];
  const storage = getSupabase().storage.from(EXPORT_BUCKET);
  const paths: { label: string; path: string }[] = [];
  for (const f of files) {
    const path = `${c.ref}/${f.name}`;
    const { error } = await storage.upload(path, Buffer.from(f.body, "utf8"), { contentType: f.type, upsert: true });
    if (error) throw new Error(`Couldn't save the export (${f.name}): ${error.message}`);
    paths.push({ label: f.label, path });
  }
  return paths;
}

// Every file under the restaurant's own folder in a bucket.
async function filesUnder(bucket: string, prefix: string): Promise<string[]> {
  const out: string[] = [];
  const { data } = await getSupabase().storage.from(bucket).list(prefix, { limit: 1000 });
  for (const f of (data ?? []) as { name: string; id?: string | null }[]) {
    const path = `${prefix}/${f.name}`;
    if (f.id === null) out.push(...(await filesUnder(bucket, path)));
    else out.push(path);
  }
  return out;
}

// The owner's login, unless another restaurant (or the builder) uses that email.
async function removeLogin(email: string | null | undefined, restaurantId: string) {
  const address = email?.trim().toLowerCase();
  if (!address) return "no login";
  const builders = (process.env.BUILDER_EMAIL ?? "").split(",").map((e) => e.trim()).filter(Boolean);
  if (builders.some((b) => b.toLowerCase() === address)) return "kept (the builder's own login)";
  const { data: others } = await getSupabase().from("restaurants").select("id").ilike("owner_email", address.replace(/[%_\\]/g, "\\$&")).neq("id", restaurantId);
  if (others?.length) return "kept (another restaurant uses it)";
  const admin = (getSupabase() as unknown as { auth?: { admin?: { listUsers: (o: { page: number; perPage: number }) => Promise<{ data: { users: { id: string; email?: string }[] } }>; deleteUser: (id: string) => Promise<{ error: { message: string } | null }> } } }).auth?.admin;
  if (!admin) return "not reachable";
  for (let page = 1; page <= 20; page++) {
    const { data } = await admin.listUsers({ page, perPage: 200 });
    const user = data.users.find((u) => u.email?.toLowerCase() === address);
    if (user) {
      const { error } = await admin.deleteUser(user.id);
      return error ? `couldn't delete: ${error.message}` : "deleted";
    }
    if (data.users.length < 200) break;
  }
  return "none found";
}

export async function runClosing(closureId: string) {
  let c = await closure(closureId);
  if (c.status === "closed" || c.status === "cancelled") return { skipped: `already ${c.status}` };
  if (c.status === "scheduled" && c.closes_at && new Date(c.closes_at) > new Date()) return { skipped: "the cooling-off isn't over" };
  if (!c.restaurant_id) {
    await update(c.id, { status: "failed", last_error: "The restaurant is already gone" });
    return { skipped: "no restaurant" };
  }
  const r = await restaurant(c.restaurant_id);
  if (closeRefused(r)) throw new ClosureError(closeRefused(r)!);
  await update(c.id, { status: "closing" });
  const steps = { ...c.steps };
  const save = async () => update(c.id, { steps });

  // 1. The export, kept for 7 days.
  if (!c.export_paths) {
    const paths = await buildExport(c, r);
    const expires = new Date(Date.now() + EXPORT_DAYS * 86_400_000).toISOString();
    await update(c.id, { export_paths: paths, export_expires_at: expires });
    c = await closure(c.id);
  }
  // 2. Google: our access stops.
  if (!steps.google) {
    const conn = r.google_connection_id ? check(await getSupabase().from("google_connections").select("id, kind").eq("id", r.google_connection_id).maybeSingle<{ id: string; kind: string }>()) : null;
    const plan = googleClosing({ linked: Boolean(r.google_location_id), connectionKind: conn?.kind ?? null });
    if (plan === "revoke") {
      const { disconnect } = await import("@/lib/google/connections");
      await disconnect(r.id);
    } else if (plan === "remove_manager") {
      const { managerEmail } = await import("@/lib/onboarding/dina/setup-config");
      steps.manager_email = (await managerEmail()) ?? "our manager account";
      check(await getSupabase().from("restaurants").update({ google_connection_id: null, google_account_id: null, google_location_id: null, google_linked_at: null }).eq("id", r.id));
      await alertBuilder(`closure-google:${c.ref}`, `Account closed (${c.ref}): remove ${String(steps.manager_email)} as a manager from the Google profile "${r.google_location_title ?? r.google_location_id}". The owner has been told how to remove it too.`);
    }
    steps.google = plan;
    await save();
  }
  // 3. Stripe, when it's on.
  if (!steps.stripe) {
    const { stripeConfigured } = await import("@/lib/billing/config");
    if (!stripeConfigured()) steps.stripe = "off";
    else if (!r.stripe_subscription_id) steps.stripe = "no subscription";
    else {
      const { getStripe } = await import("@/lib/billing/stripe");
      await getStripe().subscriptions.cancel(r.stripe_subscription_id);
      steps.stripe = "cancelled";
    }
    await save();
  }
  // 4. The owner's email with the download links (before the address is deleted).
  if (!steps.email) {
    const storage = getSupabase().storage.from(EXPORT_BUCKET);
    const links: { label: string; url: string }[] = [];
    for (const p of c.export_paths ?? []) {
      const { data } = await storage.createSignedUrl(p.path, EXPORT_DAYS * 86_400);
      if (data?.signedUrl) links.push({ label: p.label, url: data.signedUrl });
    }
    const mail = closedEmail({
      restaurant: r.name,
      links,
      expires: formatLondon(new Date(c.export_expires_at!)),
      removeManager: steps.google === "remove_manager" ? { email: String(steps.manager_email), profile: r.google_location_title ?? "" } : null,
    });
    const { sendOwnerEmail } = await import("@/lib/email");
    steps.email = (await sendOwnerEmail(r, { ...mail, html: textHtml(mail.text) })).delivery;
    await save();
  }
  // 5. Delete: the files, the login, then the restaurant row (every table goes with it).
  const supabase = getSupabase();
  const counts: Record<string, number> = {};
  for (const t of ["customers", "reviews", "drafts", "messages", "sales_days", "staff"]) {
    const { count } = await supabase.from(t).select("id", { count: "exact", head: true }).eq("restaurant_id", r.id);
    counts[t] = count ?? 0;
  }
  let files = 0;
  for (const b of RESTAURANT_BUCKETS) {
    const paths = await filesUnder(b, r.id);
    if (paths.length) {
      const { error } = await supabase.storage.from(b).remove(paths);
      if (error) throw new Error(`files in ${b}: ${error.message}`);
      files += paths.length;
    }
  }
  counts.files = files;
  steps.login = await removeLogin(r.owner_email, r.id);
  await save();
  check(await supabase.from("restaurants").delete().eq("id", r.id));
  const left = check(await supabase.from("restaurants").select("id").eq("id", r.id).maybeSingle<{ id: string }>());
  if (left) throw new Error("The restaurant is still there after deleting it");
  // 6. The one anonymous line kept.
  await update(c.id, { status: "closed", closed_at: new Date().toISOString(), restaurant_id: null, counts, steps });
  await alertBuilder(`closure-done:${c.ref}`, `Account closed (${c.ref}, ${c.kind}): ${counts.customers} customers, ${counts.drafts} drafts, ${counts.messages} messages, ${files} files deleted; Google ${String(steps.google)}, Stripe ${String(steps.stripe)}, owner email ${String(steps.email)}. The export is deleted after ${EXPORT_DAYS} days.`);
  return { ref: c.ref, closed: true, counts, steps };
}

export async function closingFailed(closureId: string, err: unknown) {
  await update(closureId, { status: "failed", last_error: (err instanceof Error ? err.message : String(err)).slice(0, 500) }).catch(() => {});
}

// The daily clean-up: exports past their 7 days are deleted.
export async function deleteExpiredExports(now: Date) {
  const res = await getSupabase().from("account_closures").select("id, ref, export_paths").lt("export_expires_at", now.toISOString()).is("export_deleted_at", null);
  if (res.error && MISSING.has(res.error.code)) return 0;
  const rows = (check(res) ?? []) as Pick<Closure, "id" | "ref" | "export_paths">[];
  for (const c of rows) {
    const paths = (c.export_paths ?? []).map((p) => p.path);
    if (paths.length) await getSupabase().storage.from(EXPORT_BUCKET).remove(paths);
    await update(c.id, { export_deleted_at: now.toISOString() });
  }
  return rows.length;
}

// ---------- The admin page ----------

export async function closuresView() {
  const supabase = getSupabase();
  const res = await supabase.from("account_closures").select("*").order("requested_at", { ascending: false }).limit(50);
  if (res.error && MISSING.has(res.error.code)) return null;
  const rows = (check(res) ?? []) as Closure[];
  const ids = rows.map((c) => c.restaurant_id).filter((x): x is string => Boolean(x));
  const names = ids.length ? ((check(await supabase.from("restaurants").select("id, name").in("id", ids)) ?? []) as { id: string; name: string }[]) : [];
  const restaurants = (check(await supabase.from("restaurants").select("*").order("name").returns<Restaurant[]>()) ?? []).filter((r) => !closeRefused(r));
  return { closures: rows.map((c) => ({ ...c, name: names.find((n) => n.id === c.restaurant_id)?.name ?? null })), restaurants };
}

function textHtml(text: string) {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const linked = esc(text).replace(/(https:\/\/[^\s]+)/g, '<a href="$1">$1</a>');
  return `<div style="font-family:system-ui,sans-serif;max-width:560px;line-height:1.5;color:#1c1917">${linked
    .split("\n\n")
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("")}</div>`;
}
