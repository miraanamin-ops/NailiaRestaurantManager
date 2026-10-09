import { Suspense } from "react";
import type { Metadata } from "next";
import { NotFoundCard } from "@/components/brand-shell";
import { google, type GooglePost } from "@/lib/google";
import { getRestaurantBySlug } from "@/lib/signups";

export const metadata: Metadata = { title: "Google listing preview", robots: { index: false } };

// A rough look-alike of the restaurant's Google listing, built only from the
// Google connector, so it shows exactly what's been "posted".
export default function GooglePreviewPage({ params }: PageProps<"/google/[slug]">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-white" />}>
      <Listing params={params} />
    </Suspense>
  );
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const TOPIC_LABEL: Record<GooglePost["topic"], string> = { update: "Update", offer: "Offer", event: "Event" };

function Stars({ rating, size = "text-sm" }: { rating: number; size?: string }) {
  const full = Math.round(rating);
  return (
    <span className={`${size} tracking-tight`} aria-label={`${rating} out of 5 stars`}>
      <span className="text-[#fbbc04]">{"★".repeat(full)}</span>
      <span className="text-[#dadce0]">{"★".repeat(5 - full)}</span>
    </span>
  );
}

function when(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} week${days < 14 ? "" : "s"} ago`;
  return `${Math.floor(days / 30)} month${days < 60 ? "" : "s"} ago`;
}

const initialColors = ["#1a73e8", "#e8710a", "#188038", "#d93025", "#9334e6", "#007b83"];

async function Listing({ params }: Pick<PageProps<"/google/[slug]">, "params">) {
  const { slug } = await params;
  const r = await getRestaurantBySlug(slug);
  if (!r) return <NotFoundCard />;

  const g = google();
  const [reviews, posts] = await Promise.all([g.listReviews(r.id), g.listPublishedPosts(r.id)]);
  const avg = reviews.length ? reviews.reduce((s, x) => s + x.rating, 0) / reviews.length : 0;

  return (
    <div className="min-h-dvh bg-[#f1f3f4] font-sans text-[#202124]">
      {g.mode === "dummy" && (
        <p className="bg-amber-100 px-4 py-2 text-center text-xs text-amber-900">
          Preview of the dummy Google listing. Real Google isn&apos;t connected yet.
        </p>
      )}
      <div className="mx-auto w-full max-w-xl bg-white pb-10 shadow-sm">
        {/* Header */}
        <div className="h-36 w-full" style={{ background: `linear-gradient(135deg, ${r.brand_dark}, ${r.brand_color})` }} />
        <div className="px-4 pt-4">
          <h1 className="text-2xl font-normal">{r.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-1 text-sm text-[#70757a]">
            <span className="text-[#202124]">{avg.toFixed(1)}</span>
            <Stars rating={avg} />
            <span>({reviews.length})</span>
            <span>· {r.cuisine ?? "Restaurant"}</span>
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1 text-sm">
            {["Directions", "Call", "Website", "Share"].map((b) => (
              <span key={b} className="shrink-0 rounded-full border border-[#dadce0] px-4 py-1.5 text-[#1a73e8]">
                {b}
              </span>
            ))}
          </div>
          <dl className="mt-4 space-y-2 border-t border-[#ebebeb] pt-4 text-sm">
            <div className="flex gap-3">
              <dt>📍</dt>
              <dd>{r.address}</dd>
            </div>
            <div className="flex gap-3">
              <dt>📞</dt>
              <dd>{r.phone}</dd>
            </div>
            <div className="flex gap-3">
              <dt>🕒</dt>
              <dd className="space-y-0.5">
                {DAYS.map((d) => (
                  <div key={d} className="flex gap-4">
                    <span className="w-24">{d}</span>
                    <span className="text-[#70757a]">{r.opening_hours[d] ?? "Closed"}</span>
                  </div>
                ))}
              </dd>
            </div>
          </dl>
        </div>

        {/* Posts */}
        <section className="mt-6 border-t-8 border-[#f1f3f4] px-4 pt-4">
          <h2 className="text-lg">Updates from {r.name}</h2>
          {posts.length === 0 ? (
            <p className="mt-2 text-sm text-[#70757a]">No posts yet. Approved posts appear here.</p>
          ) : (
            <div className="mt-3 flex snap-x gap-3 overflow-x-auto pb-2">
              {posts.map((p) => (
                <article key={p.id} className="w-72 shrink-0 snap-start overflow-hidden rounded-lg border border-[#dadce0]">
                  {p.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.photo_url} alt="" className="h-44 w-full object-cover" />
                  ) : (
                    <div className="flex h-24 items-center justify-center text-3xl text-white" style={{ background: r.brand_color }}>
                      {p.topic === "offer" ? "🏷️" : p.topic === "event" ? "📅" : "🔥"}
                    </div>
                  )}
                  <div className="p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-[#70757a]">
                      {TOPIC_LABEL[p.topic]} · {when(p.published_at!)}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{p.text}</p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        {/* Reviews */}
        <section className="mt-6 border-t-8 border-[#f1f3f4] px-4 pt-4">
          <h2 className="text-lg">Reviews</h2>
          <div className="mt-2 flex items-center gap-3">
            <span className="text-5xl font-light">{avg.toFixed(1)}</span>
            <div>
              <Stars rating={avg} size="text-lg" />
              <p className="text-sm text-[#70757a]">{reviews.length} reviews</p>
            </div>
          </div>
          <ul className="mt-4 divide-y divide-[#ebebeb]">
            {reviews.map((rev, i) => (
              <li key={rev.id} className="py-4">
                <div className="flex items-center gap-3">
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-medium text-white"
                    style={{ background: initialColors[i % initialColors.length] }}
                  >
                    {rev.author_name.charAt(0)}
                  </span>
                  <span className="text-sm font-medium">{rev.author_name}</span>
                </div>
                <div className="mt-2 flex items-center gap-2 text-xs text-[#70757a]">
                  <Stars rating={rev.rating} />
                  <span>{when(rev.review_date)}</span>
                </div>
                {rev.text && <p className="mt-1 text-sm leading-relaxed">{rev.text}</p>}
                {rev.reply_text && (
                  <div className="mt-3 rounded-lg bg-[#f1f3f4] p-3 text-sm">
                    <p className="text-xs font-medium">
                      Response from the owner{" "}
                      <span className="font-normal text-[#70757a]">· {when(rev.reply_posted_at ?? rev.review_date)}</span>
                    </p>
                    <p className="mt-1 whitespace-pre-wrap leading-relaxed">{rev.reply_text}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
