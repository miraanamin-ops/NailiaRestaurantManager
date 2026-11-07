import { Suspense } from "react";
import type { Metadata } from "next";
import { PageSkeleton } from "@/components/app-shell";
import { RestaurantSwitcher } from "@/components/restaurant-switcher";
import { EmptyCard, Page, PageHeader, Panel, Pill, Stars, Tile } from "@/components/ui";
import { waitingItems } from "@/lib/dashboard/data";
import { ownerPage } from "@/lib/dashboard/page-context";
import { changeLabel, compare, shortName } from "@/lib/dashboard/rules";
import { google } from "@/lib/google";
import type { Review } from "@/lib/supabase";

// The owner's Google reviews: rating, who's been answered, and what's waiting.
export const metadata: Metadata = { title: "Reviews · DinerAI", robots: { index: false, follow: false } };

export default function ReviewsPage({ searchParams }: PageProps<"/reviews">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Reviews searchParams={searchParams} />
    </Suspense>
  );
}

const DAY_MS = 86_400_000;

async function Reviews({ searchParams }: Pick<PageProps<"/reviews">, "searchParams">) {
  const { owner, restaurant, choices, one, now } = await ownerPage("/reviews", searchParams);
  if (!restaurant) return <Page narrow>No restaurant found for {owner.email}.</Page>;
  const r = restaurant.id;
  const [reviews, waiting] = await Promise.all([google().listReviews(r) as Promise<Review[]>, waitingItems(r)]);
  const sorted = [...reviews].sort((a, b) => b.review_date.localeCompare(a.review_date));
  const filter = one("show");
  const shown = filter === "low" ? sorted.filter((x) => x.rating <= 3) : filter === "unanswered" ? sorted.filter((x) => !x.replied) : sorted;
  const waitingIds = new Set(waiting.map((w) => w.review?.id).filter(Boolean));
  const avg = (rs: Review[]) => (rs.length ? Math.round((rs.reduce((s, x) => s + x.rating, 0) / rs.length) * 10) / 10 : 0);
  const monthAgo = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const recent = sorted.filter((x) => x.review_date >= monthAgo);
  const before = sorted.filter((x) => x.review_date < monthAgo);
  const ratingChange = before.length && recent.length ? compare(avg(sorted), avg(before)) : null;
  const replied = sorted.length ? Math.round((sorted.filter((x) => x.replied).length / sorted.length) * 100) : 0;
  const chip = (key: string | undefined, label: string) => (
    <a
      href={`/reviews?r=${r}${key ? `&show=${key}` : ""}`}
      className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] ${filter === key ? "bg-[#c8f03c] font-semibold text-[#0b0c0a]" : "bg-[#1e221b] text-[#a3a99d] hover:text-[#edefe8]"}`}
    >
      {label}
    </a>
  );

  return (
    <Page narrow>
      <RestaurantSwitcher choices={choices} current={r} path="/reviews" />
      <PageHeader eyebrow="Reviews" title="Google reviews" sub="Replies are drafted for you; nothing is posted until you approve it." />
      {!sorted.length ? (
        <EmptyCard icon="star" title="No reviews yet" text="Once your Google profile is connected, new reviews show here and a reply is drafted for each." />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-2.5">
            <Tile label="Rating" value={`${avg(sorted).toFixed(1)}★`} change={ratingChange} changeText={ratingChange ? changeLabel(ratingChange, "diff") : undefined} />
            <Tile label="Last 30 days" value={recent.length} foot="new reviews" />
            <Tile label="Replied" value={`${replied}%`} foot={waitingIds.size ? `${waitingIds.size} waiting` : "all done"} />
          </div>
          <div className="flex gap-2 overflow-x-auto [scrollbar-width:none]">
            {chip(undefined, "All")}
            {chip("low", "1 to 3 stars")}
            {chip("unanswered", "Not replied")}
          </div>
          <div className="space-y-2">
            {shown.map((rv) => (
              <Panel key={rv.id} edge={rv.rating <= 3 && !rv.replied ? "ember" : undefined} className="space-y-1.5">
                <div className="flex items-start justify-between gap-3 pl-1">
                  <div className="flex items-center gap-2">
                    <Stars rating={rv.rating} />
                    <span className="text-[14px] font-medium text-[#edefe8]">{shortName(rv.author_name)}</span>
                  </div>
                  {waitingIds.has(rv.id) ? <Pill tone="amber">Waiting for you</Pill> : rv.replied ? <Pill tone="signal">Replied</Pill> : <Pill>No reply</Pill>}
                </div>
                {rv.text && <p className="pl-1 text-[14px] leading-relaxed text-[#a3a99d]">{rv.text}</p>}
                <div className="pl-1 font-mono text-[11px] text-[#6e7468]">
                  {new Date(rv.review_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" })}
                </div>
              </Panel>
            ))}
            {!shown.length && <p className="text-[14px] text-[#a3a99d]">None here.</p>}
          </div>
        </div>
      )}
    </Page>
  );
}
