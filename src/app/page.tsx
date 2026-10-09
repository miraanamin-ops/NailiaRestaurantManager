import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { formatValidity, recentCampaignStats, SEGMENT_LABELS } from "@/lib/campaigns";
import { google } from "@/lib/google";
import {
  getSupabase,
  type Customer,
  type Message,
  type Restaurant,
  type Review,
} from "@/lib/supabase";

// Password-protected by src/proxy.ts. Never shown in search engines.
export const metadata: Metadata = { title: "Naila – test data", robots: { index: false, follow: false } };

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
      <p className="text-sm font-medium uppercase tracking-wide text-orange-600">
        Naila · test data
      </p>
      <Suspense fallback={<p className="mt-6 text-neutral-500">Loading data from Supabase…</p>}>
        <Dashboard />
      </Suspense>
    </main>
  );
}

type DraftRow = {
  id: string;
  kind: string;
  content: string;
  status: string;
  waiting_for: string | null;
  audience: string | null;
  version: number;
  created_at: string;
};

type BlockRow = {
  id: string;
  reason: string;
  detail: string | null;
  created_at: string;
};

type EventRow = {
  id: string;
  type: string;
  detail: string | null;
  created_at: string;
  customers: { name: string; email: string | null } | null;
};

const EVENT_LABELS: Record<string, string> = {
  signup: "📝 Signed up",
  repeat_signup: "🔁 Signed up again",
  welcome_email_sent: "📧 Welcome email sent",
  email_failed: "⚠️ Email failed",
  redeemed: "🎁 Reward redeemed",
  offer_redeemed: "🎟️ Campaign offer redeemed",
  unsubscribed: "🚪 Unsubscribed",
};

type FeedbackRow = {
  id: string;
  draft_kind: string | null;
  kind: "edit" | "skip";
  note: string;
  created_at: string;
};

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  approved: "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-200",
  sent: "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-200",
  queued: "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200",
  blocked: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200",
  skipped: "bg-neutral-200 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200",
  superseded: "bg-neutral-100 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400",
};

// True if the birthday (any year) falls within the next 7 days, today included.
function isBirthdayThisWeek(birthday: string | null, today: Date) {
  if (!birthday) return false;
  const [, m, d] = birthday.split("-").map(Number);
  for (let i = 0; i < 7; i++) {
    const day = new Date(today);
    day.setUTCDate(today.getUTCDate() + i);
    if (day.getUTCMonth() + 1 === m && day.getUTCDate() === d) return true;
  }
  return false;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/London",
  });
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="text-amber-500" aria-label={`${rating} out of 5 stars`}>
      {"★".repeat(rating)}
      <span className="text-neutral-300">{"★".repeat(5 - rating)}</span>
    </span>
  );
}

async function Dashboard() {
  // Always fetch fresh data on every visit.
  await connection();
  const supabase = getSupabase();

  const [restaurantRes, customersRes, reviewsRes, draftsRes, sentRes, messagesRes, draftListRes, feedbackRes, blocksRes, eventsRes] =
    await Promise.all([
      supabase.from("restaurants").select("*").limit(1).maybeSingle<Restaurant>(),
      supabase.from("customers").select("*").order("name").returns<Customer[]>(),
      // Reviews come through the Google connector, like everywhere else.
      supabase
        .from("restaurants")
        .select("id")
        .limit(1)
        .single<{ id: string }>()
        .then(async ({ data }) => ({ data: (data ? await google().listReviews(data.id) : []) as Review[], error: null })),
      supabase.from("drafts").select("id", { count: "exact", head: true }),
      supabase.from("sent_log").select("id", { count: "exact", head: true }),
      supabase
        .from("messages")
        .select("id, direction, from_number, to_number, body, status, error, created_at")
        .order("created_at", { ascending: false })
        .limit(30)
        .returns<Message[]>(),
      supabase
        .from("drafts")
        .select("id, kind, content, status, waiting_for, audience, version, created_at")
        .order("created_at", { ascending: false })
        .limit(15)
        .returns<DraftRow[]>(),
      supabase
        .from("draft_feedback")
        .select("id, draft_kind, kind, note, created_at")
        .order("created_at", { ascending: false })
        .limit(15)
        .returns<FeedbackRow[]>(),
      supabase
        .from("blocked_sends")
        .select("id, reason, detail, created_at")
        .order("created_at", { ascending: false })
        .limit(20)
        .returns<BlockRow[]>(),
      supabase
        .from("customer_events")
        .select("id, type, detail, created_at, customers(name, email)")
        .order("created_at", { ascending: false })
        .limit(40)
        .returns<EventRow[]>(),
    ]);

  const error =
    restaurantRes.error ?? customersRes.error ?? reviewsRes.error ?? draftsRes.error ?? sentRes.error;
  if (error) {
    return (
      <div className="mt-6 rounded-lg border border-red-300 bg-red-50 p-4 text-red-800">
        <p className="font-semibold">Couldn’t load data from Supabase</p>
        <p className="mt-1 text-sm">{error.message}</p>
      </div>
    );
  }

  const restaurant = restaurantRes.data;
  const customers = customersRes.data ?? [];
  const reviews = reviewsRes.data ?? [];
  // The messages table is added in step 2; don't break the page if it's missing.
  const messages = messagesRes.error ? null : (messagesRes.data ?? []);
  // Same for the approval-loop columns added in step 3.
  const draftList = draftListRes.error ? null : (draftListRes.data ?? []);
  const feedback = feedbackRes.error ? null : (feedbackRes.data ?? []);
  // And the safety-rule log from step 4.
  const blocks = blocksRes.error ? null : (blocksRes.data ?? []);
  // And the email sign-up log from step 5.
  const events = eventsRes.error ? null : (eventsRes.data ?? []);
  const countEvents = async (type: string) =>
    (await supabase.from("customer_events").select("id", { count: "exact", head: true }).eq("type", type)).count ?? 0;
  const [signupCount, redeemedCount, unsubCount] = events
    ? await Promise.all([countEvents("signup"), countEvents("redeemed"), countEvents("unsubscribed")])
    : [0, 0, 0];
  // Email campaigns from step 6 (null until the table exists).
  const campaigns = restaurant ? await recentCampaignStats(restaurant.id, 10).catch(() => null) : null;
  if (!restaurant) {
    return <p className="mt-6">No restaurant found. Run supabase/setup.sql in Supabase first.</p>;
  }

  const today = new Date();
  const birthdaysThisWeek = customers.filter((c) => isBirthdayThisWeek(c.birthday, today));
  const avgRating = reviews.length
    ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)
    : "–";

  return (
    <div className="mt-2 space-y-10">
      {/* Restaurant */}
      <section>
        <h1 className="text-3xl font-bold">{restaurant.name}</h1>
        <p className="mt-1 text-neutral-600 dark:text-neutral-400">
          {restaurant.cuisine} · {restaurant.address} · {restaurant.phone}
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Customers" value={customers.length} />
          <Stat label="Birthdays this week" value={birthdaysThisWeek.length} />
          <Stat label="Reviews (avg)" value={`${reviews.length} (${avgRating}★)`} />
          <Stat label="Drafts / sent" value={`${draftsRes.count ?? 0} / ${sentRes.count ?? 0}`} />
        </div>

        <div className="mt-6 grid gap-6 md:grid-cols-3">
          <Card title="Brand voice" className="md:col-span-2">
            <p className="text-sm leading-relaxed">{restaurant.brand_voice}</p>
          </Card>
          <Card title="Opening hours">
            <dl className="space-y-1 text-sm">
              {Object.entries(restaurant.opening_hours).map(([day, hours]) => (
                <div key={day} className="flex justify-between gap-4">
                  <dt>{day}</dt>
                  <dd className="text-neutral-600 dark:text-neutral-400">{hours}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>

        <Card title="Menu" className="mt-6">
          <div className="grid gap-6 sm:grid-cols-2">
            {restaurant.menu.map((cat) => (
              <div key={cat.category}>
                <h3 className="font-semibold">{cat.category}</h3>
                <ul className="mt-2 space-y-2 text-sm">
                  {cat.items.map((item) => (
                    <li key={item.name}>
                      <div className="flex justify-between gap-4">
                        <span>{item.name}</span>
                        <span className="tabular-nums">£{item.price.toFixed(2)}</span>
                      </div>
                      {item.description && (
                        <p className="text-neutral-500">{item.description}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      </section>

      {/* Email campaigns */}
      <section>
        <h2 className="text-2xl font-bold">Email campaigns</h2>
        {campaigns === null ? (
          <p className="mt-2 text-neutral-500">Campaigns not set up yet (run supabase/006_email_campaigns.sql).</p>
        ) : (
          <>
            <p className="mt-2 text-sm text-neutral-500">
              {restaurant.email_test_mode
                ? `Test mode: only ${restaurant.owner_email ?? "the owner's email (text MY EMAIL …)"} gets a real email; customers are logged as simulated.`
                : "Live mode: every customer with consent gets a real email."}
            </p>
            {campaigns.length === 0 ? (
              <p className="mt-2 text-neutral-500">No campaigns sent yet. Text “Thursday is quiet” to the sandbox.</p>
            ) : (
              <div className="mt-3 overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
                <table className="w-full text-left text-sm">
                  <thead className="bg-neutral-100 dark:bg-neutral-900">
                    <tr>
                      <th className="px-3 py-2">Campaign</th>
                      <th className="px-3 py-2">Offer · valid</th>
                      <th className="px-3 py-2">Segment</th>
                      <th className="px-3 py-2">Sent (real + simulated)</th>
                      <th className="px-3 py-2">Left out</th>
                      <th className="px-3 py-2">Opened</th>
                      <th className="px-3 py-2">Clicked</th>
                      <th className="px-3 py-2">Redeemed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map((s) => (
                      <tr key={s.campaign.id} className="border-t border-neutral-200 dark:border-neutral-800">
                        <td className="px-3 py-2">
                          <span className="font-medium">{s.campaign.name}</span>
                          <br />
                          <span className="text-neutral-500">{s.campaign.subject}</span>
                        </td>
                        <td className="px-3 py-2">
                          {s.campaign.offer}
                          <br />
                          <span className="text-neutral-500">{formatValidity(s.campaign.valid_from, s.campaign.valid_until)}</span>
                        </td>
                        <td className="px-3 py-2">{SEGMENT_LABELS[s.campaign.segment]}</td>
                        <td className="px-3 py-2 tabular-nums">
                          {s.emailed} + {s.simulated}
                          {s.failed ? ` (${s.failed} failed)` : ""}
                        </td>
                        <td className="px-3 py-2 tabular-nums">{s.excluded}</td>
                        <td className="px-3 py-2 tabular-nums">{s.opened}</td>
                        <td className="px-3 py-2 tabular-nums">{s.clicked}</td>
                        <td className="px-3 py-2 tabular-nums">{s.redeemed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      {/* Email sign-ups */}
      <section>
        <h2 className="text-2xl font-bold">Email sign-ups</h2>
        {events === null ? (
          <p className="mt-2 text-neutral-500">Sign-ups not set up yet (run supabase/005_customer_signups.sql).</p>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Sign-up reward" value={restaurant.signup_reward ?? "–"} />
              <Stat label="Sign-ups" value={signupCount} />
              <Stat label="Redeemed" value={redeemedCount} />
              <Stat label="Unsubscribed" value={unsubCount} />
            </div>
            <p className="mt-3 text-sm">
              Sign-up page:{" "}
              <a className="underline" href={`/r/${restaurant.slug}`}>
                /r/{restaurant.slug}
              </a>{" "}
              · Printable QR:{" "}
              <a className="underline" href={`/r/${restaurant.slug}/qr`}>
                /r/{restaurant.slug}/qr
              </a>
            </p>
            <h3 className="mt-6 text-lg font-semibold">Activity (latest 40)</h3>
            {events.length === 0 ? (
              <p className="mt-2 text-neutral-500">No sign-ups yet. Scan the QR code to try it.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm">
                {events.map((e) => (
                  <li key={e.id}>
                    <span className="font-medium">{EVENT_LABELS[e.type] ?? e.type}</span>
                    {e.customers && (
                      <>
                        {" "}
                        · {e.customers.name} ({e.customers.email})
                      </>
                    )}
                    {e.detail && <span className="text-neutral-500"> · {e.detail}</span>}{" "}
                    <span className="text-neutral-500">
                      ({new Date(e.created_at).toLocaleString("en-GB", { timeZone: "Europe/London" })})
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      {/* Safety rules */}
      <section>
        <h2 className="text-2xl font-bold">Safety rules</h2>
        {blocks === null ? (
          <p className="mt-2 text-neutral-500">Safety rules not set up yet (run supabase/004_safety_rules.sql).</p>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Sending" value={restaurant.paused ? "⏸️ Paused" : "▶️ On"} />
              <Stat label="Sending hours" value={`${restaurant.send_window_start?.slice(0, 5)}–${restaurant.send_window_end?.slice(0, 5)}`} />
              <Stat label="Discount cap" value={`${restaurant.discount_cap_percent}%`} />
              <Stat
                label="Clock"
                value={restaurant.fake_now ? `Test: ${new Date(restaurant.fake_now).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "short", timeStyle: "short" })}` : "Real time"}
              />
            </div>
            <h3 className="mt-6 text-lg font-semibold">Blocked or held sends (latest 20)</h3>
            {blocks.length === 0 ? (
              <p className="mt-2 text-neutral-500">Nothing blocked yet.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm">
                {blocks.map((b) => (
                  <li key={b.id}>
                    <span className="font-medium">{b.reason.replace("_", " ")}</span>{" "}
                    <span className="text-neutral-500">
                      ({new Date(b.created_at).toLocaleString("en-GB", { timeZone: "Europe/London" })})
                    </span>
                    : {b.detail}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      {/* Drafts + feedback */}
      <section>
        <h2 className="text-2xl font-bold">Drafts (latest 15)</h2>
        {draftList === null ? (
          <p className="mt-2 text-neutral-500">Approval loop not set up yet (run supabase/003_approval_loop.sql).</p>
        ) : draftList.length === 0 ? (
          <p className="mt-2 text-neutral-500">No drafts yet. Text “NEW REVIEW” to the sandbox.</p>
        ) : (
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {draftList.map((d) => (
              <li key={d.id} className="rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {d.kind.replace("_", " ")} · {d.audience}
                  </span>
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[d.status] ?? STATUS_STYLES.superseded}`}>
                    {d.status}
                    {d.waiting_for ? ` · waiting for ${d.waiting_for.replace("_", " ")}` : ""}
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap">{d.content}</p>
                <p className="mt-2 text-xs text-neutral-500">
                  Version {d.version} · {new Date(d.created_at).toLocaleString("en-GB", { timeZone: "Europe/London" })}
                </p>
              </li>
            ))}
          </ul>
        )}

        {feedback && feedback.length > 0 && (
          <>
            <h3 className="mt-6 text-lg font-semibold">What the assistant has learned (edits and skip reasons)</h3>
            <ul className="mt-2 space-y-1 text-sm">
              {feedback.map((f) => (
                <li key={f.id}>
                  <span className="font-medium">{f.kind === "edit" ? "✏️ Edit" : "⏭️ Skip"}</span>{" "}
                  <span className="text-neutral-500">({f.draft_kind?.replace("_", " ")})</span>: {f.note}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* WhatsApp log */}
      <section>
        <h2 className="text-2xl font-bold">WhatsApp messages (latest 30)</h2>
        {messages === null ? (
          <p className="mt-2 text-neutral-500">Message log not set up yet (run supabase/002_messages.sql).</p>
        ) : messages.length === 0 ? (
          <p className="mt-2 text-neutral-500">No messages yet. Send one to the sandbox number.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {messages.map((m) => (
              <li
                key={m.id}
                className={`rounded-lg border p-3 text-sm ${
                  m.direction === "inbound"
                    ? "border-neutral-200 dark:border-neutral-800"
                    : "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/40"
                }`}
              >
                <p className="text-xs text-neutral-500">
                  {m.direction === "inbound" ? `From ${m.from_number}` : `Naila → ${m.to_number}`} ·{" "}
                  {new Date(m.created_at).toLocaleString("en-GB", { timeZone: "Europe/London" })} · {m.status}
                </p>
                <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
                {m.error && <p className="mt-1 text-xs text-red-600">Error: {m.error}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Customers */}
      <section>
        <h2 className="text-2xl font-bold">Customers ({customers.length})</h2>
        <div className="mt-3 overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-100 dark:bg-neutral-900">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">WhatsApp</th>
                <th className="px-3 py-2">Birthday</th>
                <th className="px-3 py-2">Visits</th>
                <th className="px-3 py-2">Last visit</th>
                <th className="px-3 py-2">Marketing</th>
                <th className="px-3 py-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => {
                const bday = isBirthdayThisWeek(c.birthday, today);
                return (
                  <tr
                    key={c.id}
                    className={`border-t border-neutral-200 dark:border-neutral-800 ${bday ? "bg-amber-50 dark:bg-amber-950/40" : ""}`}
                  >
                    <td className="px-3 py-2 font-medium whitespace-nowrap">
                      {c.name} {bday && <span title="Birthday this week">🎂</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{c.phone}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{c.birthday && formatDate(c.birthday)}</td>
                    <td className="px-3 py-2 tabular-nums">{c.visit_count}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{c.last_visit && formatDate(c.last_visit)}</td>
                    <td className="px-3 py-2">{c.marketing_opt_in ? "Opted in" : "Opted out"}</td>
                    <td className="px-3 py-2 text-neutral-500">{c.notes}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Reviews */}
      <section>
        <h2 className="text-2xl font-bold">Google reviews ({reviews.length})</h2>
        <p className="mt-1 text-sm">
          See how it looks on Google:{" "}
          <a className="underline" href={`/google/${restaurant.slug}`}>
            listing preview (reviews, replies and posts)
          </a>
        </p>
        <ul className="mt-3 grid gap-4 md:grid-cols-2">
          {reviews.map((r) => (
            <li key={r.id} className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{r.author_name}</span>
                <Stars rating={r.rating} />
              </div>
              <p className="mt-2 text-sm leading-relaxed">{r.text}</p>
              <p className="mt-2 text-xs text-neutral-500">
                {formatDate(r.review_date)} · {r.replied ? "Replied" : "Not replied yet"}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Card({
  title,
  className = "",
  children,
}: {
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-lg border border-neutral-200 p-4 dark:border-neutral-800 ${className}`}>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">{title}</h2>
      {children}
    </div>
  );
}
