// Makes DinerAI's Stripe setup (step 49), in test or live mode depending on the key:
//   - the product "DinerAI" and its price: £99 a month, VAT included (lookup key dinerai_monthly_99)
//   - the founder coupon: £49 off for 4 months (the free month counts as one, so
//     months 2 to 4 cost £50), and the promotion code FOUNDER, 50 uses
//   - the webhook endpoint https://app.dinerai.co.uk/api/stripe/webhook with the
//     events the app handles (its signing secret is printed ONCE, when it's made)
// Safe to run again: anything that exists is left alone.
//   STRIPE_SECRET_KEY=sk_... node scripts/stripe-setup.mjs            show what exists
//   STRIPE_SECRET_KEY=sk_... node scripts/stripe-setup.mjs --apply    make what's missing
// Then put the printed STRIPE_PRICE_ID (and STRIPE_WEBHOOK_SECRET) in Vercel.
const apply = process.argv.includes("--apply");
const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("Set STRIPE_SECRET_KEY first");
  process.exit(1);
}
const live = /^(sk|rk)_live_/.test(key);
const WEBHOOK_URL = process.env.WEBHOOK_URL || "https://app.dinerai.co.uk/api/stripe/webhook";
// Same list as HANDLED in src/lib/billing/events.ts.
const EVENTS = ["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "invoice.payment_failed", "invoice.paid"];
const FOUNDER = { code: "FOUNDER", coupon: "founder_4900_4m", amountOff: 4900, months: 4, maxUses: 50 };

async function stripe(method, path, params) {
  const body = params ? new URLSearchParams(flatten(params)).toString() : undefined;
  const url = `https://api.stripe.com/v1${path}${method === "GET" && body ? `?${body}` : ""}`;
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(method !== "GET" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: method === "GET" ? undefined : body,
  });
  const json = await res.json();
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`${method} ${path}: ${json.error?.message ?? res.status}`);
  }
  return json;
}

function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const name = prefix ? `${prefix}[${k}]` : k;
    if (v && typeof v === "object") flatten(v, name, out);
    else if (v !== undefined) out[name] = String(v);
  }
  return out;
}

console.log(`Stripe ${live ? "LIVE" : "test"} mode${apply ? "" : " (showing only; add --apply to make what's missing)"}\n`);

// 1. Price
let price = (await stripe("GET", "/prices", { lookup_keys: ["dinerai_monthly_99"], limit: 1 })).data[0];
if (!price && apply) {
  const product = await stripe("POST", "/products", { name: "DinerAI", description: "AI marketing assistant for independent restaurants, on WhatsApp" });
  price = await stripe("POST", "/prices", {
    product: product.id,
    currency: "gbp",
    unit_amount: 9900,
    recurring: { interval: "month" },
    tax_behavior: "inclusive",
    lookup_key: "dinerai_monthly_99",
    nickname: "£99 a month, VAT included",
  });
  console.log("Made the £99 a month price.");
}
console.log(price ? `STRIPE_PRICE_ID=${price.id}  (£${price.unit_amount / 100} a ${price.recurring?.interval})` : "Price: not made yet");

// 2. Founder coupon and promotion code
let coupon = await stripe("GET", `/coupons/${FOUNDER.coupon}`);
if (!coupon && apply) {
  coupon = await stripe("POST", "/coupons", { id: FOUNDER.coupon, name: "Founder: £50 a month for months 2 to 4", amount_off: FOUNDER.amountOff, currency: "gbp", duration: "repeating", duration_in_months: FOUNDER.months });
  console.log("Made the founder coupon.");
}
let promo = (await stripe("GET", "/promotion_codes", { code: FOUNDER.code, limit: 1 })).data[0];
if (!promo && coupon && apply) {
  // The API takes the coupon either way round depending on its version.
  promo = await stripe("POST", "/promotion_codes", { coupon: coupon.id, code: FOUNDER.code, max_redemptions: FOUNDER.maxUses }).catch(() =>
    stripe("POST", "/promotion_codes", { promotion: { type: "coupon", coupon: coupon.id }, code: FOUNDER.code, max_redemptions: FOUNDER.maxUses }),
  );
  console.log("Made the FOUNDER code.");
}
console.log(promo ? `FOUNDER: ${promo.active ? "active" : "inactive"}, used ${promo.times_redeemed ?? 0} of ${promo.max_redemptions}` : "FOUNDER: not made yet");

// 3. Webhook endpoint
const hooks = (await stripe("GET", "/webhook_endpoints", { limit: 100 })).data;
let hook = hooks.find((h) => h.url === WEBHOOK_URL);
if (!hook && apply) {
  hook = await stripe("POST", "/webhook_endpoints", { url: WEBHOOK_URL, enabled_events: EVENTS, description: "DinerAI app" });
  console.log(`Made the webhook. STRIPE_WEBHOOK_SECRET=${hook.secret}  (shown only now: put it in Vercel)`);
} else if (hook) {
  const missing = EVENTS.filter((e) => !hook.enabled_events.includes(e) && !hook.enabled_events.includes("*"));
  if (missing.length && apply) {
    await stripe("POST", `/webhook_endpoints/${hook.id}`, { enabled_events: [...new Set([...hook.enabled_events, ...EVENTS])] });
    console.log(`Webhook: added ${missing.join(", ")}`);
  } else console.log(`Webhook: ${hook.url}${missing.length ? ` (missing events: ${missing.join(", ")})` : " (all events on)"}`);
} else console.log("Webhook: not made yet");
