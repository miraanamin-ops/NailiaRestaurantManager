// Read only: every restaurant, login and record linked to a WhatsApp number or an
// email address (including its +tag variants, and for Gmail its dotted variants).
//   node --env-file=.env.live.local scripts/who-uses.mjs --email you@gmail.com --phone +447700900123 --live
// Without --phone it uses BUILDER_WHATSAPP, without --email BUILDER_EMAIL (if set).
// Nothing is changed; numbers and emails are shown as stored.
import { createClient } from "@supabase/supabase-js";
import { guardLive } from "./lib/live-guard.mjs";

guardLive(process.env, "who-uses");
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const phone = arg("--phone") ?? process.env.BUILDER_WHATSAPP ?? "";
const email = (arg("--email") ?? process.env.BUILDER_EMAIL ?? "").toLowerCase();
const digits = (n) => String(n ?? "").replace(/\D/g, "");

// The address an email lands in: +tag dropped, and Gmail ignores dots.
function mailbox(address) {
  const [local = "", domain = ""] = String(address ?? "").toLowerCase().trim().split("@");
  const base = local.split("+")[0];
  const gmail = domain === "gmail.com" || domain === "googlemail.com";
  return `${gmail ? base.replace(/\./g, "") : base}@${gmail ? "gmail.com" : domain}`;
}
const wantBox = email ? mailbox(email) : null;
const sameEmail = (e) => wantBox !== null && !!e && mailbox(e) === wantBox;
const samePhone = (n) => digits(phone) !== "" && digits(n) === digits(phone);

console.log(`Looking for: phone ${phone || "(none given)"}, email ${email || "(none given)"} and its variants (mailbox ${wantBox ?? "-"})\n`);

async function all(table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await s.from(table).select(columns).range(from, from + 999);
    if (error) return { error: error.message, rows };
    rows.push(...data);
    if (data.length < 1000) return { rows };
  }
}
const names = new Map();
const show = (title, lines) => console.log(`${title}\n${lines.length ? lines.map((l) => `  ${l}`).join("\n") : "  (none)"}\n`);

// Every restaurant, flagged where it matches.
const r = await all("restaurants", "id, name, slug, owner_whatsapp, whatsapp_from, owner_email, reply_to_email, is_demo, is_test, active, created_at");
const rr = r.error?.includes("is_test") ? await all("restaurants", "id, name, slug, owner_whatsapp, whatsapp_from, owner_email, reply_to_email, is_demo, active, created_at") : r;
if (rr.error) throw new Error(rr.error);
for (const x of rr.rows) names.set(x.id, `${x.name} (${x.slug})`);
show(
  "All restaurants (>> = linked to you)",
  rr.rows.map((x) => {
    const hits = [samePhone(x.owner_whatsapp) && "owner number", samePhone(x.whatsapp_from) && "sending number", sameEmail(x.owner_email) && "owner email", sameEmail(x.reply_to_email) && "reply-to email"].filter(Boolean);
    const flags = [x.is_demo && "demo", x.is_test && "test", x.active ? "active" : "inactive"].filter(Boolean).join(", ");
    return `${hits.length ? ">>" : "  "} ${x.name} (${x.slug}) [${flags}] owner ${x.owner_whatsapp ?? "-"} / ${x.owner_email ?? "-"}${hits.length ? `  <- ${hits.join(", ")}` : ""}`;
  }),
);

// Login accounts (Supabase Auth).
const users = [];
for (let page = 1; ; page++) {
  const { data, error } = await s.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw new Error(error.message);
  users.push(...data.users);
  if (data.users.length < 1000) break;
}
show(
  "Login accounts",
  users.filter((u) => sameEmail(u.email) || samePhone(u.phone)).map((u) => `${u.email ?? u.phone} (created ${u.created_at?.slice(0, 10)}, last sign-in ${u.last_sign_in_at?.slice(0, 10) ?? "never"})`),
);

// Other records that hold a number or an email.
const checks = [
  ["customers", "restaurant_id, email, phone, source, deleted_at", (x) => sameEmail(x.email) || samePhone(x.phone), (x) => `${x.email ?? x.phone} (${x.source ?? "?"}${x.deleted_at ? ", deleted" : ""})`],
  ["consents", "restaurant_id, email", (x) => sameEmail(x.email), (x) => x.email],
  ["staff_numbers", "restaurant_id, whatsapp", (x) => samePhone(x.whatsapp), (x) => x.whatsapp],
  ["onboarding", "restaurant_id, pending_whatsapp", (x) => samePhone(x.pending_whatsapp), (x) => `waiting to link ${x.pending_whatsapp}`],
  ["google_connections", "restaurant_id, google_email", (x) => sameEmail(x.google_email), (x) => x.google_email],
];
for (const [table, cols, match, label] of checks) {
  const res = await all(table, cols);
  if (res.error) {
    show(table, [`(couldn't read: ${res.error})`]);
    continue;
  }
  const hits = res.rows.filter(match);
  show(table, hits.map((x) => `${names.get(x.restaurant_id) ?? x.restaurant_id ?? "no restaurant"}: ${label(x)}`));
}

// WhatsApp messages: counts per restaurant only.
if (digits(phone)) {
  const res = await all("messages", "restaurant_id, from_number, to_number");
  if (res.error) show("messages", [`(couldn't read: ${res.error})`]);
  else {
    const counts = new Map();
    for (const m of res.rows.filter((m) => samePhone(m.from_number) || samePhone(m.to_number))) {
      const k = names.get(m.restaurant_id) ?? m.restaurant_id ?? "no restaurant";
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    show("WhatsApp messages to or from the number", [...counts].map(([k, n]) => `${k}: ${n}`));
  }
}
