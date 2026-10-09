import { bars, CHART, MUTED_BAR, weekTotals } from "@/lib/report/chart";
import {
  changeText,
  direction,
  formatValue,
  SECTION_TITLES,
  whatsappLink,
  type ActionsSection,
  type Compare,
  type CustomersSection,
  type Daily,
  type GoogleSection,
  type HeadlineSection,
  type ReportData,
  type ReportSection,
  type ReputationSection,
} from "@/lib/report/types";

// One renderer per section id. A section type with no renderer here is skipped,
// so new sections (Sales, Operations, Finance) can be added one at a time.

type Ctx = { data: ReportData; brand: string };

export function Section({ section, ctx }: { section: ReportSection; ctx: Ctx }) {
  switch (section.id) {
    case "headline":
      return <Headline s={section} ctx={ctx} />;
    case "reputation":
      return <Reputation s={section} ctx={ctx} />;
    case "customers":
      return <Customers s={section} ctx={ctx} />;
    case "google":
      return <GoogleVisibility s={section} />;
    case "actions":
      return <Actions s={section} ctx={ctx} />;
    default:
      return null;
  }
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-stone-200/70">
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-stone-500">{title}</h2>
      {children}
    </section>
  );
}

// "▲ +3 vs the week before". Up isn't always good (e.g. complaints), so callers can flip it.
function Change({ value, format = "count", goodWhenUp = true }: { value: Compare; format?: "rating" | "count"; goodWhenUp?: boolean }) {
  const d = direction(value, format);
  const good = d === "same" ? null : (d === "up") === goodWhenUp;
  const cls = good === null ? "text-stone-500" : good ? "text-emerald-700" : "text-red-700";
  const icon = d === "up" ? "▲" : d === "down" ? "▼" : "•";
  return (
    <span className={`text-xs font-medium ${cls}`}>
      <span aria-hidden>{icon} </span>
      {changeText(value, format)}
    </span>
  );
}

function Stat({ label, value, format = "count", big = false }: { label: string; value: Compare; format?: "rating" | "count"; big?: boolean }) {
  return (
    <div className="min-w-0">
      <div className={`${big ? "text-4xl" : "text-2xl"} font-bold tabular-nums tracking-tight text-stone-900`}>{formatValue(value.now, format)}</div>
      <div className="mt-0.5 text-sm text-stone-600">{label}</div>
      <Change value={value} format={format} />
    </div>
  );
}

function Bars({ daily, brand, what }: { daily: Daily; brand: string; what: string }) {
  const totals = weekTotals(daily);
  const b = bars(daily);
  return (
    <figure className="mt-5">
      <svg
        viewBox={`0 0 ${CHART.width} ${CHART.height}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${what} per day: ${totals.before} the week before, ${totals.now} last week`}
      >
        {b.map((bar) => (
          <rect key={bar.day + bar.x} x={bar.x} y={bar.y} width={bar.w} height={bar.h} rx={2} fill={bar.lastWeek ? brand : MUTED_BAR}>
            <title>{`${bar.day}: ${bar.value} ${what.toLowerCase()}`}</title>
          </rect>
        ))}
        <line x1={0} x2={CHART.width} y1={CHART.height - CHART.labelSpace + 0.5} y2={CHART.height - CHART.labelSpace + 0.5} stroke="#e7e5e4" />
        <text x={0} y={CHART.height - 2} fontSize={9} fill="#78716c">
          {b[0]?.day}
        </text>
        <text x={b[7]?.x ?? 0} y={CHART.height - 2} fontSize={9} fill="#78716c">
          {b[7]?.day}
        </text>
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: MUTED_BAR }} />
          Week before: {totals.before}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: brand }} />
          Last week: {totals.now}
        </span>
        <span className="text-stone-500">{what} per day</span>
      </figcaption>
    </figure>
  );
}

function Headline({ s, ctx }: { s: HeadlineSection; ctx: Ctx }) {
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-stone-200/70">
      <p className="text-lg font-semibold leading-snug text-stone-900">{s.sentence}</p>
      <div className="mt-5 grid grid-cols-3 gap-3 border-t border-stone-100 pt-4">
        {s.stats.map((st) => (
          <div key={st.label} className="min-w-0">
            <div className="text-3xl font-bold tabular-nums tracking-tight" style={{ color: ctx.data.restaurant.brandDark }}>
              {formatValue(st.value.now, st.format)}
            </div>
            <div className="mt-0.5 text-xs leading-tight text-stone-600">{st.label}</div>
            <div className="mt-1 leading-tight">
              <Change value={st.value} format={st.format} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Reputation({ s, ctx }: { s: ReputationSection; ctx: Ctx }) {
  return (
    <Card title={SECTION_TITLES.reputation}>
      <div className="flex items-end gap-3">
        <Stat label={`Google rating · ${s.totalReviews} reviews`} value={s.rating} format="rating" big />
        <span className="mb-9 text-2xl" style={{ color: "#eab308" }} aria-hidden>
          ★
        </span>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-4">
        <Stat label="New reviews" value={s.newReviews} />
        <Stat label="Reviews answered" value={s.answered} />
      </div>
      {s.newAverage && s.newReviews.now > 0 && (
        <p className="mt-3 text-sm text-stone-600">
          New reviews averaged <strong className="text-stone-900">{s.newAverage.now.toFixed(1)} stars</strong>
          {s.newReviews.before > 0 && <> (the week before: {s.newAverage.before.toFixed(1)})</>}.
        </p>
      )}
      <Bars daily={s.daily} brand={ctx.brand} what="New reviews" />
      {(s.praise.length > 0 || s.complaints.length > 0) && (
        <div className="mt-5 grid gap-4 border-t border-stone-100 pt-4 sm:grid-cols-2">
          {s.praise.length > 0 && <Themes title="What customers love" items={s.praise} icon="👍" />}
          {s.complaints.length > 0 && <Themes title="What to fix" items={s.complaints} icon="👎" />}
        </div>
      )}
    </Card>
  );
}

function Themes({ title, items, icon }: { title: string; items: string[]; icon: string }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-stone-800">
        <span aria-hidden>{icon} </span>
        {title}
      </h3>
      <ul className="space-y-1.5 text-sm text-stone-700">
        {items.map((t) => (
          <li key={t} className="rounded-lg bg-stone-50 px-3 py-2">
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Customers({ s, ctx }: { s: CustomersSection; ctx: Ctx }) {
  return (
    <Card title={SECTION_TITLES.customers}>
      <div className="grid grid-cols-2 gap-x-4 gap-y-5">
        <Stat label="New sign-ups" value={s.signups} big />
        <Stat label="Redeemed (offers + rewards)" value={s.redemptions} big />
        <Stat label="Emails sent" value={s.emailsSent} />
        <Stat label="Opened" value={s.opens} />
        <Stat label="Clicked" value={s.clicks} />
        <Stat label="Welcome rewards used" value={s.rewardRedemptions} />
      </div>
      <Bars daily={s.daily} brand={ctx.brand} what="Sign-ups" />
      {s.campaigns.length > 0 && (
        <div className="mt-5 border-t border-stone-100 pt-4">
          <h3 className="mb-2 text-sm font-semibold text-stone-800">Campaigns last week</h3>
          <ul className="space-y-2 text-sm">
            {s.campaigns.map((c) => (
              <li key={c.name} className="rounded-lg bg-stone-50 px-3 py-2">
                <div className="font-medium text-stone-900">{c.name}</div>
                <div className="text-stone-600">
                  {c.sent} sent · {c.opened} opened · {c.redeemed} redeemed
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {s.simulated > 0 && (
        <p className="mt-3 text-xs text-stone-500">
          Test mode: {s.simulated} of last week&apos;s emails were simulated (only your copy is really sent).
        </p>
      )}
    </Card>
  );
}

function GoogleVisibility({ s }: { s: GoogleSection }) {
  return (
    <Card title={SECTION_TITLES.google}>
      <Stat label="Posts published" value={s.posts} big />
      {s.insights && (
        <div className="mt-5 grid grid-cols-3 gap-3">
          <Stat label="Listing views" value={s.insights.views} />
          <Stat label="Calls" value={s.insights.calls} />
          <Stat label="Directions" value={s.insights.directions} />
        </div>
      )}
      {s.recentPosts.length > 0 && (
        <ul className="mt-5 space-y-2 border-t border-stone-100 pt-4 text-sm text-stone-700">
          {s.recentPosts.map((p) => (
            <li key={p.publishedAt} className="rounded-lg bg-stone-50 px-3 py-2">
              <div className="mb-0.5 text-xs text-stone-500">
                {new Date(p.publishedAt).toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" })}
              </div>
              <p className="line-clamp-3">{p.text}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Actions({ s, ctx }: { s: ActionsSection; ctx: Ctx }) {
  return (
    <Card title={SECTION_TITLES.actions}>
      <ol className="space-y-3">
        {s.actions.map((a, i) => {
          const link = whatsappLink(ctx.data.whatsappNumber, a.message);
          return (
            <li key={a.title} className="rounded-xl border border-stone-200 p-4">
              <div className="flex gap-3">
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                  style={{ background: ctx.brand }}
                >
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <h3 className="font-semibold text-stone-900">{a.title}</h3>
                  <p className="mt-0.5 text-sm text-stone-600">{a.why}</p>
                </div>
              </div>
              {link && (
                <a
                  href={link}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-[#25D366] px-4 py-2.5 text-sm font-semibold text-[#0b3d1f] active:opacity-80"
                >
                  Start in WhatsApp
                </a>
              )}
            </li>
          );
        })}
      </ol>
      {ctx.data.whatsappNumber && (
        <p className="mt-3 text-xs text-stone-500">Each button opens WhatsApp with the message ready. Just tap send.</p>
      )}
    </Card>
  );
}
