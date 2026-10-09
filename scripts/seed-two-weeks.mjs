// Adds two weeks of dummy activity (dated back from now) so the weekly report
// has real "last week vs the week before" comparisons, and the morning brief's
// "done for you" line has something from the last 24 hours. Last week is busier.
// Everything it adds is tagged, so running it again replaces it, and --remove
// takes it all out. Existing data is never touched.
// Usage: node --env-file=.env.local scripts/seed-two-weeks.mjs [--remove]
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const TAG = "report-seed";
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const now = Date.now();
// "d days ago at about h hours into that day" (d=0 means earlier today, within the last 24h).
const at = (d, h) => new Date(now - d * DAY - h * HOUR).toISOString();
const token = () => randomBytes(24).toString("base64url");
const ok = (res, what) => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
};

// Dummy data only ever goes into a demo restaurant (restaurants.is_demo).
const { data: restaurant } = await s.from("restaurants").select("id, name, is_demo").eq("is_demo", true).limit(1).maybeSingle();
if (!restaurant) throw new Error("No demo restaurant (restaurants.is_demo = true). Dummy data is never added to a real restaurant.");
const rid = restaurant.id;

async function remove() {
  const drafts = ok(await s.from("drafts").select("id").eq("restaurant_id", rid).eq("request", TAG), "find drafts");
  if (drafts.length) ok(await s.from("drafts").delete().in("id", drafts.map((d) => d.id)), "delete drafts"); // cascades campaigns, sends, posts
  ok(await s.from("consents").delete().eq("restaurant_id", rid).eq("source", "report_seed"), "delete consents");
  ok(await s.from("customer_events").delete().eq("restaurant_id", rid).eq("detail", TAG), "delete events");
  ok(await s.from("customers").delete().eq("restaurant_id", rid).eq("notes", TAG), "delete customers"); // cascades rewards
  ok(await s.from("reviews").delete().eq("restaurant_id", rid).eq("source", "seed_report"), "delete reviews");
}

await remove();
if (process.argv.includes("--remove")) {
  console.log("Removed all two-week dummy data.");
  process.exit(0);
}

// ---------- Reviews: 5 the week before (avg 4.0), 8 last week (avg 4.6) ----------
const REVIEWS = [
  [12, 5, "Hamid R.", 4, "Lovely mixed grill, but the wait for a table on Friday was long."],
  [11, 3, "Ellie S.", 3, "Food was tasty but our order came out in the wrong order and the naan was cold."],
  [10, 6, "Kofi A.", 5, "Proper charcoal flavour, the lamb chops are the best around Whitechapel."],
  [9, 4, "Sara D.", 4, "Great value and friendly staff. A bit loud on a Saturday."],
  [8, 8, "Tariq M.", 4, "Seekh kebabs were spot on. Would love more veggie options."],
  [6, 5, "Jess P.", 5, "Booked for a birthday and the team brought out kunafa with a candle. So kind!"],
  [5, 7, "Usman K.", 5, "Smash burger was unreal and the masala chips are addictive."],
  [5, 2, "Holly W.", 4, "Really good food, took a while to get the bill though."],
  [4, 6, "Ahmed B.", 5, "Family-run feel, the owner came over to say hello. Mixed grill platter is huge."],
  [3, 3, "Nina F.", 5, "Fast takeaway, still hot when I got home. Peri peri wings were perfect."],
  [2, 9, "Rob T.", 4, "Tasty chicken tikka. Music was a bit loud for us."],
  [1, 4, "Layla H.", 5, "Best mango lassi in East London and the staff are lovely."],
  [0, 3, "Dev N.", 5, "Lamb chops cooked perfectly. Friendly welcome as always."],
];
const reviewRows = REVIEWS.map(([d, h, author, rating, text], i) => {
  const date = at(d, h);
  // Most get a reply a few hours later; the newest two were replied to within the last 24h.
  const replied = i !== 1; // one left unanswered from the week before
  const replyAt = replied ? new Date(Math.min(now - HOUR, new Date(date).getTime() + 3 * HOUR)).toISOString() : null;
  return {
    restaurant_id: rid,
    source: "seed_report",
    author_name: author,
    rating,
    text,
    review_date: date,
    created_at: date,
    handled_at: date, // already seen, so the review check doesn't draft new replies
    replied,
    reply_text: replied ? `Thank you so much, ${author.split(" ")[0]}! We really appreciate it and hope to see you again soon. 🙏` : null,
    reply_posted_at: replyAt,
  };
});
ok(await s.from("reviews").insert(reviewRows), "insert reviews");

// ---------- Sign-ups: 9 the week before, 16 last week (2 in the last 24h) ----------
const NAMES = ["Amina", "Ben", "Chloe", "Dawud", "Esme", "Faisal", "Grace", "Hassan", "Isla", "Jamal", "Kiran", "Lena", "Musa", "Nora", "Owen", "Parveen", "Qasim", "Rosa", "Sami", "Tia", "Umar", "Vera", "Wes", "Yasmin", "Zain"];
const SIGNUP_DAYS = [13, 13, 12, 11, 10, 10, 9, 8, 8, 6, 6, 6, 5, 5, 4, 4, 4, 3, 3, 2, 2, 1, 1, 0, 0];
const todayMD = (plus) => {
  const d = new Date(now + plus * DAY);
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};
const customers = ok(
  await s
    .from("customers")
    .insert(
      NAMES.map((name, i) => ({
        restaurant_id: rid,
        name,
        email: `${name.toLowerCase()}.seed${i}@example.com`,
        // Three of them have birthdays coming up, so the birthday email has someone to go to.
        birthday: i < 3 ? `199${i}-${todayMD(i + 2)}` : `199${i % 10}-0${(i % 9) + 1}-1${i % 9}`,
        marketing_opt_in: i % 8 !== 7, // a few didn't tick the box
        source: "signup",
        unsubscribe_token: token(),
        visit_count: 1,
        notes: TAG,
        created_at: at(SIGNUP_DAYS[i], 2 + (i % 9)),
      })),
    )
    .select("id, name, email, marketing_opt_in, created_at"),
  "insert customers",
);
ok(
  await s.from("customer_events").insert(
    customers.map((c) => ({ restaurant_id: rid, customer_id: c.id, type: "signup", detail: TAG, created_at: c.created_at })),
  ),
  "insert events",
);
ok(
  await s.from("consents").insert(
    customers.map((c) => ({
      restaurant_id: rid,
      customer_id: c.id,
      email: c.email,
      granted: c.marketing_opt_in,
      wording: `Send me offers and news from ${restaurant.name} by email.`,
      form_version: "signup-v1",
      privacy_version: "privacy-v1",
      source: "report_seed",
      created_at: c.created_at,
    })),
  ),
  "insert consents",
);
// Welcome rewards: 3 used the week before, 7 last week (1 in the last 24h).
const REDEEM_AFTER = { 0: 26, 1: 30, 3: 50, 9: 20, 10: 28, 12: 30, 14: 24, 15: 40, 17: 20, 19: 30 };
ok(
  await s.from("rewards").insert(
    customers.map((c, i) => {
      const created = new Date(c.created_at).getTime();
      const redeemed = REDEEM_AFTER[i] !== undefined ? Math.min(now - 2 * HOUR, created + REDEEM_AFTER[i] * HOUR) : null;
      return {
        restaurant_id: rid,
        customer_id: c.id,
        token: token(),
        reward: "a free Mango Lassi",
        created_at: c.created_at,
        redeemed_at: redeemed ? new Date(redeemed).toISOString() : null,
        expires_at: redeemed ? new Date(redeemed + 10 * 60_000).toISOString() : null,
      };
    }),
  ),
  "insert rewards",
);

// ---------- One email campaign each week ----------
const original = ok(
  await s.from("customers").select("id, email").eq("restaurant_id", rid).or(`notes.is.null,notes.neq.${TAG}`).eq("marketing_opt_in", true).is("unsubscribed_at", null).not("email", "is", null),
  "original customers",
);
const ymd = (iso) => iso.slice(0, 10);
async function campaign({ d, name, subject, body, offer, recipients, opens, clicks, redeems }) {
  const sentAt = at(d, 1);
  const draft = ok(
    await s
      .from("drafts")
      .insert({
        restaurant_id: rid,
        kind: "email_campaign",
        content: `*${name}*\n*Subject:* ${subject}\n\n${body}\n\n🎁 *Offer:* ${offer}`,
        audience: `Everyone (${recipients.length} with consent)`,
        request: TAG,
        status: "sent",
        approved_at: sentAt,
        sent_at: sentAt,
        created_at: sentAt,
        updated_at: sentAt,
      })
      .select("id")
      .single(),
    "campaign draft",
  );
  const c = ok(
    await s
      .from("campaigns")
      .insert({
        restaurant_id: rid,
        draft_id: draft.id,
        name,
        subject,
        body,
        offer,
        valid_from: ymd(sentAt),
        valid_until: ymd(new Date(new Date(sentAt).getTime() + 3 * DAY).toISOString()),
        segment: "everyone",
        sent_at: sentAt,
        eligible_count: recipients.length,
        excluded_count: 2,
        created_at: sentAt,
      })
      .select("id")
      .single(),
    "campaign",
  );
  const t0 = new Date(sentAt).getTime();
  const later = (hrs) => new Date(Math.min(now - HOUR, t0 + hrs * HOUR)).toISOString();
  ok(
    await s.from("campaign_sends").insert(
      recipients.map((r, i) => ({
        campaign_id: c.id,
        restaurant_id: rid,
        customer_id: r.id,
        email: r.email,
        token: token(),
        kind: "customer",
        delivery: "email",
        created_at: sentAt,
        opened_at: i < opens ? later(1 + i) : null,
        clicked_at: i < clicks ? later(2 + i) : null,
        redeemed_at: i < redeems ? later(20 + i * 3) : null,
        expires_at: i < redeems ? later(20 + i * 3 + 0.17) : null,
      })),
    ),
    "campaign sends",
  );
}
const seededBy = (days) => customers.filter((c) => c.marketing_opt_in && new Date(c.created_at).getTime() < now - days * DAY);
await campaign({
  d: 10,
  name: "Quiet Tuesday grill deal",
  subject: "Tuesday's on us (well, 15% of it) 🔥",
  body: "Hi {first_name},\n\nTuesdays are a bit quiet here, so we're making them worth it: 15% off all grills, all day.\n\nSee you soon!",
  offer: "15% off all grills",
  recipients: [...original, ...seededBy(10)],
  opens: 11,
  clicks: 5,
  redeems: 3,
});
await campaign({
  d: 3,
  name: "Weekend mixed grill for two",
  subject: "Mixed grill for two, this weekend only",
  body: "Hi {first_name},\n\nBring someone hungry: our Mixed Grill Platter for two comes with a free Mango Lassi each this weekend.\n\nSee you Saturday?",
  offer: "Free Mango Lassi with every Mixed Grill Platter",
  recipients: [...original, ...seededBy(3)],
  opens: 17,
  clicks: 9,
  redeems: 6,
});

// ---------- Google posts: 1 the week before, 2 last week (1 in the last 24h) ----------
const POSTS = [
  [11, "update", "Our lamb chops are marinated overnight and flame-grilled over real charcoal. Four pieces for £13.95. Pop in tonight! 🔥"],
  [4, "offer", "This weekend: a free Mango Lassi with every Mixed Grill Platter. See you Saturday!"],
  [0, "update", "Warm kunafa with pistachio and cream, £5.95. The perfect way to finish your grill. 😋"],
];
for (const [d, topic, text] of POSTS) {
  const when = at(d, 2);
  const draft = ok(
    await s
      .from("drafts")
      .insert({ restaurant_id: rid, kind: "google_post", content: text, audience: "your Google listing", request: TAG, status: "sent", approved_at: when, sent_at: when, created_at: when, updated_at: when })
      .select("id")
      .single(),
    "post draft",
  );
  ok(
    await s.from("google_posts").insert({ restaurant_id: rid, draft_id: draft.id, topic, text, published_at: when, google_post_id: `dummy-seed-${d}`, created_at: when }),
    "post",
  );
}

console.log(`Added two weeks of dummy activity: ${reviewRows.length} reviews, ${customers.length} sign-ups, 2 campaigns, ${POSTS.length} Google posts.`);
console.log("Remove it any time with: node --env-file=.env.local scripts/seed-two-weeks.mjs --remove");
