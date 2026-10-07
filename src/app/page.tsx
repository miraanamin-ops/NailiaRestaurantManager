import { Suspense } from "react";
import { connection } from "next/server";
import {
  getSupabase,
  type Customer,
  type Message,
  type Restaurant,
  type Review,
} from "@/lib/supabase";

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

  const [restaurantRes, customersRes, reviewsRes, draftsRes, sentRes, messagesRes] =
    await Promise.all([
      supabase.from("restaurants").select("*").limit(1).maybeSingle<Restaurant>(),
      supabase.from("customers").select("*").order("name").returns<Customer[]>(),
      supabase.from("reviews").select("*").order("review_date", { ascending: false }).returns<Review[]>(),
      supabase.from("drafts").select("id", { count: "exact", head: true }),
      supabase.from("sent_log").select("id", { count: "exact", head: true }),
      supabase
        .from("messages")
        .select("id, direction, from_number, to_number, body, status, error, created_at")
        .order("created_at", { ascending: false })
        .limit(30)
        .returns<Message[]>(),
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
