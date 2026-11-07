import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { AppShell, PageSkeleton } from "@/components/app-shell";
import { DraftCard } from "@/components/draft-card";
import { Icon } from "@/components/icons";
import { RestaurantSwitcher } from "@/components/restaurant-switcher";
import { btnSecondary, Eyebrow, linkText, Notice, Page, Panel, Pill, Section, Stars, Tile, WhatsAppTip, withR } from "@/components/ui";
import { londonParts } from "@/lib/clock";
import { homeData, weekAhead, type HomeData } from "@/lib/dashboard/data";

type WeekAheadData = Awaited<ReturnType<typeof weekAhead>>;
import { ownerPage } from "@/lib/dashboard/page-context";
import { changeLabel, firstName, greeting, shortName, todaySummary } from "@/lib/dashboard/rules";
import { ourWhatsAppNumber } from "@/lib/onboarding/channel";
import { whatsAppLink } from "@/lib/onboarding/steps";
import { gbp } from "@/lib/sales/format";
import type { Restaurant } from "@/lib/supabase";

// The owner's home page: does anything need me, how am I doing, what's coming up,
// and what has the assistant done for me. Every number is worked out in code from
// the restaurant's own data; where there's no data yet it says how to get it.
export const metadata: Metadata = { title: "Home · DinerAI", robots: { index: false, follow: false } };

export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <AppShell>
      <Suspense fallback={<PageSkeleton />}>
        <HomePage searchParams={searchParams} />
      </Suspense>
    </AppShell>
  );
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

async function HomePage({ searchParams }: Pick<PageProps<"/">, "searchParams">) {
  const { owner, restaurant, choices, one, now } = await ownerPage("/", searchParams);
  if (!restaurant) {
    return (
      <Page narrow>
        <Notice tone="amber">You&apos;re logged in as {owner.email}, but no restaurant uses that email yet.</Notice>
      </Page>
    );
  }
  const data = await homeData(restaurant, now);
  const r = restaurant.id;
  const hour = londonParts(now).hour;
  const urgent = data.waiting.filter((w) => w.urgent).length;
  const dateLabel = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/London" });
  const name = firstName((restaurant as Restaurant & { owner_name?: string | null }).owner_name);

  return (
    <Page>
      <RestaurantSwitcher choices={choices} current={r} path="/" />
      <div className="space-y-4">
        {one("done") && <Notice>{one("done")}</Notice>}
        {one("oops") && <Notice tone="neg">{one("oops")}</Notice>}
        {!restaurant.active && (
          <Link href={withR("/onboarding", r)} className="block">
            <Notice tone="amber">{restaurant.name} isn&apos;t set up yet. Finish setting up →</Notice>
          </Link>
        )}
        {restaurant.paused && (
          <Notice tone="amber">The assistant is paused: nothing goes to customers or Google. Text RESUME on WhatsApp to start again.</Notice>
        )}
      </div>

      <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-8">
          {/* Today */}
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Eyebrow>{dateLabel}</Eyebrow>
              {restaurant.paused ? <Pill tone="amber" dot>Paused</Pill> : <Pill tone="signal" dot>Assistant on</Pill>}
            </div>
            <div>
              <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] text-[#edefe8]">
                {greeting(hour)}
                {name ? `, ${name}` : ""}
              </h1>
              <p className="mt-0.5 text-[14px] text-[#a3a99d]">{restaurant.name}</p>
            </div>
            <Panel className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#c8f03c] text-[#0b0c0a]">
                  <Icon name="spark" className="h-4 w-4" strokeWidth={2.2} />
                </div>
                <p className="text-[15px] leading-relaxed text-[#edefe8]">
                  {todaySummary({ waiting: data.waiting.length, urgent, forecastOrders: data.today.orders, busy: data.today.busy, event: data.today.events[0] ?? null })}
                </p>
              </div>
              <TodayChips data={data} />
            </Panel>
          </section>

          {/* Waiting for you */}
          <Section title="Waiting for you" count={data.waiting.length || undefined} href={data.waiting.length > 3 ? withR("/approvals", r) : undefined} linkLabel={`See all ${data.waiting.length}`}>
            {data.waiting.length ? (
              <div className="space-y-3">
                {data.waiting.slice(0, 3).map((w) => (
                  <DraftCard key={w.draft.id} item={w} restaurantId={r} back="/" now={now} />
                ))}
              </div>
            ) : (
              <Panel className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#c8f03c]/12 text-[#c8f03c]">
                  <Icon name="check" className="h-5 w-5" strokeWidth={2.4} />
                </div>
                <div>
                  <div className="text-[15px] font-medium text-[#edefe8]">Nothing waiting. You&apos;re all caught up.</div>
                  <div className="text-[13px] text-[#a3a99d]">New drafts arrive in your 9am brief on WhatsApp, and here.</div>
                </div>
              </Panel>
            )}
          </Section>

          {/* How you're doing */}
          <Section title="How you're doing" aside={<Eyebrow>Last 7 days vs the 7 before</Eyebrow>}>
            <Tiles data={data} r={r} />
          </Section>

          {/* Coming up */}
          <Section title="Coming up" aside={<Eyebrow>Next 7 days</Eyebrow>}>
            <Suspense fallback={<div className="dai-skeleton h-44 w-full" />}>
              <ComingUpLoader restaurantId={r} now={now} />
            </Suspense>
          </Section>
        </div>

        <div className="space-y-8">
          {data.tally.length > 0 && (
            <Section title="Done for you this week">
              <Link href={withR("/log", r)} className="block">
                <Panel className="flex items-center gap-3 transition hover:bg-[#1b1f18]">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#c8f03c]/12 text-[#c8f03c]">
                    <Icon name="check" className="h-4 w-4" strokeWidth={2.4} />
                  </div>
                  <p className="flex-1 text-[14px] leading-snug text-[#edefe8]">{capitalise(data.tally.join(" · "))}</p>
                  <Icon name="chevron" className="h-4 w-4 text-[#a3a99d]" />
                </Panel>
              </Link>
            </Section>
          )}

          <ReviewsCard data={data} r={r} />
          <CustomersCard data={data} restaurant={restaurant} />
          <CampaignCard data={data} />
          <SetupCard data={data} />

          <WhatsAppTip>
            You can do all of this on WhatsApp too. Try <span className="text-[#edefe8]">“Thursday is quiet”</span> for an offer, or{" "}
            <span className="text-[#edefe8]">“change Friday hours to 11pm”</span>.
          </WhatsAppTip>
        </div>
      </div>
    </Page>
  );
}

function capitalise(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function TodayChips({ data }: { data: HomeData }) {
  const chips: string[] = [];
  if (data.today.orders !== null) chips.push(`Forecast ${data.today.orders} orders`);
  if (data.today.salesPence !== null) chips.push(`About ${gbp(data.today.salesPence / 100)}`);
  const w = data.today.weather;
  if (w && (w.words || w.tempMax !== null)) chips.push([w.tempMax !== null ? `${w.tempMax}°C` : null, w.words?.toLowerCase()].filter(Boolean).join(" "));
  for (const e of data.today.events) chips.push(e);
  if (!chips.length) return null;
  return (
    <div className="flex gap-2 overflow-x-auto border-t border-[#1e221b] pt-3 [scrollbar-width:none]">
      {chips.map((c) => (
        <span key={c} className="whitespace-nowrap rounded-full bg-[#1e221b] px-2.5 py-1 text-[13px] text-[#a3a99d]">
          {c}
        </span>
      ))}
    </div>
  );
}

function Tiles({ data, r }: { data: HomeData; r: string }) {
  const { sales, rating, customers, redeemed } = data.week;
  return (
    <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
      {sales.hasData ? (
        <Tile
          label="Sales"
          value={gbp(sales.change.now)}
          change={sales.change}
          changeText={changeLabel(sales.change)}
          spark={sales.daily}
          foot={sales.orders ? `${sales.orders.now} orders` : "Before VAT"}
          href={withR("/sales", r)}
        />
      ) : (
        <Link href={withR("/sales", r)} className="flex flex-col justify-between gap-2 rounded-2xl border border-dashed border-[#2c3127] p-3.5">
          <Eyebrow>Sales</Eyebrow>
          <span className="text-[14px] text-[#edefe8]">See your sales here</span>
          <span className="text-[12px] text-[#a3a99d]">Connect your till or send a till report →</span>
        </Link>
      )}
      <Tile
        label="Google rating"
        value={rating.avg !== null ? `${rating.avg.toFixed(1)}★` : "No reviews"}
        change={rating.change}
        changeText={rating.change ? changeLabel(rating.change, "diff") : undefined}
        foot={`${rating.total} review${rating.total === 1 ? "" : "s"}${rating.newThisWeek ? ` · ${rating.newThisWeek} new` : ""}`}
        href={withR("/reviews", r)}
      />
      <Tile
        label="Customers"
        value={customers.total.toLocaleString("en-GB")}
        change={customers.newThisWeek}
        changeText={customers.newThisWeek.now ? `+${customers.newThisWeek.now}` : undefined}
        foot={customers.newThisWeek.now ? `${customers.newThisWeek.now} new sign-up${customers.newThisWeek.now === 1 ? "" : "s"}` : "No new sign-ups"}
        href={withR("/customers", r)}
      />
      <Tile
        label="Offers redeemed"
        value={redeemed.now}
        change={redeemed}
        changeText={redeemed.dir === "same" ? undefined : changeLabel(redeemed, "diff")}
        foot="Rewards and offers"
      />
    </div>
  );
}

// The week ahead streams in on its own: its forecast can take a few seconds the
// first time each day.
async function ComingUpLoader({ restaurantId, now }: { restaurantId: string; now: Date }) {
  const ahead = await weekAhead(restaurantId, now);
  return <ComingUp data={ahead} />;
}

function ComingUp({ data }: { data: Pick<WeekAheadData, "days" | "hasForecast"> }) {
  const max = Math.max(1, ...data.days.map((d) => d.orders ?? 0));
  const quiet = data.days.find((d, i) => i > 0 && d.busy === "quiet");
  return (
    <div className="space-y-2">
      <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
        <div className="grid min-w-[560px] grid-cols-7 gap-1.5 sm:min-w-0">
          {data.days.map((d, i) => {
            const date = new Date(`${d.date}T12:00:00Z`);
            const colour = d.busy === "quiet" ? "bg-[#ffb23d]" : d.busy === "busy" ? "bg-[#c8f03c]" : d.busy === "closed" ? "bg-[#2c3127]" : "bg-[#a3a99d]";
            const height = d.orders !== null ? Math.max(8, Math.round((d.orders / max) * 100)) : 0;
            return (
              <div key={d.date} className={`flex flex-col items-center gap-1.5 rounded-xl bg-[#171a14] p-2 ${i === 0 ? "ring-1 ring-[#c8f03c]/40" : ""}`}>
                <span className={`font-mono text-[11px] font-semibold ${i === 0 ? "text-[#c8f03c]" : d.busy === "quiet" ? "text-[#ffb23d]" : "text-[#a3a99d]"}`}>
                  {i === 0 ? "TODAY" : WEEKDAY[date.getUTCDay()].toUpperCase()}
                </span>
                <span className="text-[13px] text-[#edefe8]">{date.getUTCDate()}</span>
                <div className="flex h-12 w-full items-end rounded-md bg-[#0b0c0a] p-0.5">
                  {d.orders !== null ? (
                    <div className={`w-full rounded ${colour}`} style={{ height: `${height}%` }} />
                  ) : (
                    <div className="h-full w-full rounded border border-dashed border-[#2c3127]" />
                  )}
                </div>
                <span className="font-mono text-[11px] text-[#edefe8]">{d.busy === "closed" ? "Shut" : d.orders ?? "–"}</span>
                <div className="flex w-full flex-col items-center gap-0.5">
                  {d.birthdays > 0 && <span className="truncate text-[10px] text-[#a3a99d]">{d.birthdays} 🎂</span>}
                  {d.events.slice(0, 1).map((e) => (
                    <span key={e} title={e} className="w-full truncate text-center text-[10px] text-[#a3a99d]">
                      {e}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {quiet ? (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-[#121410] px-3 py-2.5 ring-1 ring-[#1e221b]">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#ffb23d]" />
            <span className="text-[13px] text-[#edefe8]">{WEEKDAY_LONG[new Date(`${quiet.date}T12:00:00Z`).getUTCDay()]} looks quiet.</span>
          </div>
          <a href={whatsAppLink(ourWhatsAppNumber(), `${WEEKDAY_LONG[new Date(`${quiet.date}T12:00:00Z`).getUTCDay()]} is quiet`)} target="_blank" rel="noreferrer" className="text-[13px] font-medium text-[#c8f03c]">
            Draft an offer →
          </a>
        </div>
      ) : !data.hasForecast ? (
        <p className="text-[12px] text-[#6e7468]">Forecasts appear here once there are 8 weeks of sales. Numbers are expected orders.</p>
      ) : (
        <p className="text-[12px] text-[#6e7468]">Numbers are expected orders. Amber means quieter than a normal day, green busier.</p>
      )}
    </div>
  );
}

function ReviewsCard({ data, r }: { data: HomeData; r: string }) {
  const { rating } = data.week;
  const waiting = new Set(data.waiting.map((w) => w.review?.id).filter(Boolean));
  return (
    <Section title="Reviews" href={withR("/reviews", r)}>
      <Panel className="space-y-3">
        <div className="flex items-baseline gap-2">
          <span className="text-[22px] font-semibold text-[#edefe8]">{rating.avg !== null ? rating.avg.toFixed(1) : "–"}</span>
          <Stars rating={rating.avg ?? 0} />
          <span className="text-[13px] text-[#a3a99d]">from {rating.total}</span>
        </div>
        {data.latestReviews.length ? (
          <ul className="divide-y divide-[#1e221b]">
            {data.latestReviews.map((rv) => (
              <li key={rv.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Stars rating={rv.rating} size="text-[12px]" />
                    <span className="text-[14px] text-[#edefe8]">{shortName(rv.author_name)}</span>
                  </div>
                  {rv.text && <p className="mt-0.5 truncate text-[13px] text-[#a3a99d]">{rv.text}</p>}
                </div>
                {waiting.has(rv.id) ? <Pill tone="amber">Waiting for you</Pill> : rv.replied ? <Pill tone="signal">Replied</Pill> : <Pill>No reply</Pill>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-[#a3a99d]">No reviews yet.</p>
        )}
      </Panel>
    </Section>
  );
}

function CustomersCard({ data, restaurant }: { data: HomeData; restaurant: Restaurant }) {
  const c = data.week.customers;
  return (
    <Section title="Customers" href={withR("/customers", restaurant.id)}>
      <Panel className="space-y-3">
        <div>
          <div className="text-[22px] font-semibold text-[#edefe8]">{c.total.toLocaleString("en-GB")}</div>
          <div className="text-[13px] text-[#a3a99d]">on your email list</div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[13px]">
          <div className="rounded-xl bg-[#1e221b] p-2.5">
            <div className="font-semibold text-[#c8f03c]">+{c.newThisWeek.now}</div>
            <div className="text-[#a3a99d]">this week</div>
          </div>
          <div className="rounded-xl bg-[#1e221b] p-2.5">
            <div className="font-semibold text-[#edefe8]">{c.notRedeemed}</div>
            <div className="text-[#a3a99d]">reward not used yet</div>
          </div>
        </div>
        {restaurant.slug && (
          <a href={`/r/${restaurant.slug}/qr-pack`} className={`${btnSecondary} w-full`}>
            <Icon name="qr" className="h-4 w-4" /> Print QR table cards
          </a>
        )}
      </Panel>
    </Section>
  );
}

function CampaignCard({ data }: { data: HomeData }) {
  const s = data.campaign;
  if (!s) return null;
  const sent = s.emailed + s.simulated;
  const openPct = sent ? Math.round((s.opened / sent) * 100) : 0;
  return (
    <Section title="Latest campaign">
      <Panel className="space-y-3">
        <div className="text-[15px] font-medium text-[#edefe8]">{s.campaign.name}</div>
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            ["Sent", sent],
            ["Opened", `${openPct}%`],
            ["Redeemed", s.redeemed],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-[#1e221b] p-2.5">
              <div className="text-[17px] font-semibold text-[#edefe8]">{v}</div>
              <div className="text-[12px] text-[#a3a99d]">{k}</div>
            </div>
          ))}
        </div>
        {s.simulated > 0 && <p className="text-[12px] text-[#6e7468]">{s.simulated} of these were test customers (simulated, nothing sent).</p>}
      </Panel>
    </Section>
  );
}

function SetupCard({ data }: { data: HomeData }) {
  const left = data.setup.filter((s) => !s.done);
  if (!left.length) return null;
  const done = data.setup.length - left.length;
  return (
    <Section title="Finish setting up">
      <Panel className="space-y-3">
        <div className="flex items-center justify-between text-[13px] text-[#a3a99d]">
          <span>
            {done} of {data.setup.length} done
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-[#1e221b]">
          <div className="h-full rounded-full bg-[#c8f03c]" style={{ width: `${Math.max(4, (done / data.setup.length) * 100)}%` }} />
        </div>
        <ul className="divide-y divide-[#1e221b]">
          {left.map((s) => (
            <li key={s.label}>
              <Link href={s.href} className="flex items-center justify-between gap-3 py-2.5 text-[14px] text-[#edefe8]">
                {s.label}
                <Icon name="chevron" className="h-4 w-4 text-[#a3a99d]" />
              </Link>
            </li>
          ))}
        </ul>
        <span className={linkText}>Each takes a minute or two.</span>
      </Panel>
    </Section>
  );
}
