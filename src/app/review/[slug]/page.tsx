import { Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { NotFoundCard } from "@/components/brand-shell";
import { requireOwner } from "@/lib/auth";
import { reviewPageFor, type ReviewPage } from "@/lib/review/page-data";

export const metadata: Metadata = { title: "Your business review", robots: { index: false } };

// The business review in full (the WhatsApp message links here): the score
// breakdown and every gap, what customers say, you vs nearby rivals (fetched
// fresh, with Google's attribution), the planned campaigns and the posters.
// Owner page: needs a login, and only shows a restaurant this person may see.
export default function ReviewPageRoute({ params }: PageProps<"/review/[slug]">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-stone-100" />}>
      <Review params={params} />
    </Suspense>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-3 space-y-2 text-[15px] leading-relaxed text-stone-800">{children}</div>
    </section>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function Body({ page }: { page: ReviewPage }) {
  const { restaurant: r, profile, themes, backlog, rivals, planned, lines } = page;
  const brand = r.brand_color ?? "#c2410c";
  return (
    <>
      <Card title="At a glance">
        <ul className="space-y-2">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <p className="pt-2 text-sm text-stone-600">Send GO in the app&apos;s Chat and Dina takes you through it, one thing at a time.</p>
      </Card>

      {backlog && (
        <Card title="Review replies">
          {backlog.unanswered === 0 ? (
            <p>You&apos;ve replied to every review. Nice work.</p>
          ) : (
            <p>
              {plural(backlog.unanswered, "review has", "reviews have")} no reply. Dina has drafted {plural(backlog.drafted, "reply", "replies")}: {backlog.positiveReady} to 4 to 5 star reviews are ready to approve together, and{" "}
              {plural(backlog.negative, "lower rating needs", "lower ratings need")} a look one at a time. Nothing is posted until you approve it.
            </p>
          )}
        </Card>
      )}

      {profile && (
        <Card title={`Google profile: ${profile.score}/100`}>
          {profile.items?.length ? (
            <table className="w-full text-sm">
              <tbody>
                {profile.items.map((i) => (
                  <tr key={i.key} className="border-b border-stone-100 last:border-0">
                    <td className="py-1.5 pr-2">{i.label}</td>
                    <td className={`py-1.5 text-right font-semibold ${i.points < i.max ? "text-amber-700" : "text-emerald-700"}`}>
                      {i.points}/{i.max}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {profile.steps?.length ? (
            <div className="pt-2">
              <h3 className="font-semibold">Things only you can change in Google</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {profile.steps.map((s) => (
                  <li key={s.label}>
                    <b>{s.label}:</b> <span className="whitespace-pre-line">{s.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {profile.asks.length ? <p className="pt-2">To finish the rest, Dina needs: {profile.asks.join("; ")}.</p> : null}
        </Card>
      )}

      {themes && !themes.skipped && (themes.praises.length || themes.complaint) && (
        <Card title="What customers say">
          {themes.summary && <p>{themes.summary}</p>}
          {themes.praises.length > 0 && <p>👍 They love: {themes.praises.join(", ")}.</p>}
          {(themes.complaints ?? []).map((c) => (
            <p key={c.label}>
              👎 {c.label} ({plural(c.count, "review", "reviews")}){c.example ? <span className="text-stone-600">: &ldquo;{c.example}&rdquo;</span> : null}
            </p>
          ))}
          {themes.action && <p className="font-semibold">💡 {themes.action}</p>}
        </Card>
      )}

      {rivals && (
        <Card title="You vs nearby rivals">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-stone-500">
                <th className="py-1 font-normal">Restaurant</th>
                <th className="py-1 text-right font-normal">Rating</th>
                <th className="py-1 text-right font-normal">Reviews</th>
              </tr>
            </thead>
            <tbody>
              {rivals.ours && (
                <tr className="font-semibold" style={{ color: brand }}>
                  <td className="py-1.5">{r.name} (you)</td>
                  <td className="py-1.5 text-right">{rivals.ours.rating.toFixed(1)}</td>
                  <td className="py-1.5 text-right">{rivals.ours.count}</td>
                </tr>
              )}
              {rivals.list.map((x) => (
                <tr key={x.id} className="border-t border-stone-100">
                  <td className="py-1.5">{x.name}</td>
                  <td className="py-1.5 text-right">{x.rating?.toFixed(1) ?? "-"}</td>
                  <td className="py-1.5 text-right">{x.count ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rivals.list.length && <p className="text-sm text-stone-600">No restaurants of the same kind within a mile.</p>}
          <p className="pt-1 text-xs text-stone-500">Ratings and review counts from Google Maps, fetched just now. The 5 closest with the same main category, within a mile.</p>
        </Card>
      )}

      {planned.length > 0 && (
        <Card title="Planned for the next 30 days">
          <ul className="space-y-2">
            {planned.map((d) => (
              <li key={d.id}>
                <b>{d.kind === "email_campaign" ? "📧 Email campaign" : "📍 Google post"}</b>
                {d.audience ? ` for ${d.audience}` : ""} <span className="text-sm text-stone-500">({d.status === "pending" ? "waiting for your approval" : d.status})</span>
                <p className="line-clamp-3 text-sm text-stone-600">{d.content}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {page.poster && r.slug && (
        <Card title="Your QR poster">
          <p>Print it and put it by the till or on the tables: customers scan it to join your list.</p>
          <div className="flex flex-wrap gap-2 pt-1">
            {(["A4", "A5"] as const).map((size) => (
              <a key={size} href={`/r/${r.slug}/poster?size=${size}`} className="rounded-lg px-4 py-2.5 text-sm font-semibold text-white" style={{ background: brand }}>
                Download {size}
              </a>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

async function Review({ params }: Pick<PageProps<"/review/[slug]">, "params">) {
  const { slug } = await params;
  await connection();
  const owner = await requireOwner(`/review/${slug}`);
  const page = await reviewPageFor(owner, slug);
  if (!page) return <NotFoundCard />;
  const { restaurant, review } = page;
  const running = review && (review.status === "queued" || review.status === "running" || review.status === "sending");

  return (
    <div className="min-h-dvh bg-stone-100 text-stone-900">
      <header className="px-4 pb-10 pt-8 text-white" style={{ background: restaurant.brand_dark ?? "#1c1917" }}>
        <div className="mx-auto max-w-xl">
          <div className="mb-3 h-1 w-10 rounded-full" style={{ background: restaurant.brand_color ?? "#c2410c" }} />
          <p className="text-sm text-stone-300">Business review</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{restaurant.name}</h1>
        </div>
      </header>
      <main className="mx-auto -mt-5 w-full max-w-xl space-y-4 px-4 pb-12">
        {!review ? (
          <Card title="Not yet">
            <p>Dina hasn&apos;t reviewed this restaurant yet.</p>
          </Card>
        ) : running ? (
          <Card title="Working on it">
            <p>Dina is reviewing your business now. This page fills in within about 10 minutes.</p>
          </Card>
        ) : (
          <Body page={page} />
        )}
      </main>
    </div>
  );
}
