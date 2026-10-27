import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { NotFoundCard } from "@/components/brand-shell";
import { rotaByToken, rotaForPreview } from "@/lib/rota/build";
import { money, weekLabel } from "@/lib/rota/message";
import { rotaView } from "@/lib/rota/view";

export const metadata: Metadata = { title: "Rota", robots: { index: false, follow: false } };

// A published rota: read-only, on an unguessable link the owner forwards to the
// team. Who works when, and nothing else (no pay, costs or labour %).
// With ?preview=<signature> (the link on the owner's WhatsApp draft): the draft
// too, with each day's cost and labour %, for the owner only.
export default function RotaPage({ params, searchParams }: PageProps<"/rota/[token]">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-stone-100" />}>
      <Rota params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Rota({ params, searchParams }: Pick<PageProps<"/rota/[token]">, "params" | "searchParams">) {
  const { token } = await params;
  const q = await searchParams;
  const signature = typeof q.preview === "string" ? q.preview : null;
  await connection(); // always fresh: an UNDO switches the link off
  const preview = signature ? await rotaForPreview(token, signature) : null;
  const week = preview ?? (await rotaByToken(token));
  if (!week?.summary) return <NotFoundCard />;
  const owner = Boolean(preview);
  const draft = week.status !== "published";
  const plan = week.summary;
  const view = rotaView(plan, { restaurant: plan.restaurant.name, week: weekLabel(week.week_start) });
  const brand = plan.restaurant.brand_color ?? "#1c1917";

  return (
    <div className="min-h-dvh bg-stone-100 text-stone-900">
      <header className="bg-stone-900 px-4 pb-10 pt-8 text-white">
        <div className="mx-auto max-w-3xl">
          <div className="mb-3 h-1 w-10 rounded-full" style={{ background: brand }} />
          <p className="text-sm text-stone-300">Rota · {view.week}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{view.title}</h1>
          {owner && (
            <p className="mt-3 rounded-lg bg-white/10 px-3 py-2 text-sm text-stone-100">
              {draft ? "Draft: only you can see this. Approve it on WhatsApp to share it with your team. " : "Your view, with costs. Your team's link shows only who works when. "}
              Labour {money(plan.totals.costPence)}
              {plan.totals.labourPct !== null ? `, ${plan.totals.labourPct}% of forecast sales` : ""}.
            </p>
          )}
          {!draft && <a
            href={`/rota/${token}/pdf`}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-stone-900 active:opacity-80"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden>
              <path d="M10 2a1 1 0 0 1 1 1v8.6l2.3-2.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L9 11.6V3a1 1 0 0 1 1-1ZM4 15a1 1 0 0 1 1 1v1h10v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Z" />
            </svg>
            Download PDF
          </a>}
        </div>
      </header>
      <main className="mx-auto -mt-5 w-full max-w-3xl space-y-4 px-4 pb-12">
        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-base font-bold">By person</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead>
                <tr className="text-xs text-stone-500">
                  <th className="py-1 pr-2 font-medium">Name</th>
                  {view.dayHeads.map((d) => (
                    <th key={d} className="px-1 py-1 font-medium">
                      {d}
                    </th>
                  ))}
                  <th className="py-1 pl-2 text-right font-medium">Hours</th>
                </tr>
              </thead>
              <tbody>
                {view.people.map((p) => (
                  <tr key={p.name} className="border-t border-stone-100">
                    <td className="py-2 pr-2 font-medium">{p.name}</td>
                    {p.cells.map((c, i) => (
                      <td key={i} className="px-1 py-2 tabular-nums text-stone-700">
                        {c || <span className="text-stone-300">–</span>}
                      </td>
                    ))}
                    <td className="py-2 pl-2 text-right tabular-nums">{p.hours}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {view.days.map((d, i) => (
          <section key={d.date} className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h2 className="text-base font-bold">{d.label}</h2>
              <p className="text-xs text-stone-500">
                {d.open === "Closed" ? "Closed" : `Open ${d.open}`}
                {owner && d.open !== "Closed" ? ` · ${money(plan.days[i].costPence)}${plan.days[i].labourPct !== null ? ` · ${plan.days[i].labourPct}%` : ""}` : ""}
              </p>
            </div>
            {d.shifts.length ? (
              <ul className="divide-y divide-stone-100 text-sm">
                {d.shifts.map((s, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 py-2">
                    <span className="tabular-nums text-stone-600">{s.time}</span>
                    <span className={`flex-1 font-medium ${s.name.startsWith("Open shift") ? "text-amber-700" : ""}`}>{s.name}</span>
                    <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">{s.role}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-stone-500">{d.open === "Closed" ? "No shifts." : "Nobody rota'd."}</p>
            )}
          </section>
        ))}
        <p className="pt-2 text-center text-xs text-stone-500">
          {view.openShifts ? `${view.openShifts} open shift${view.openShifts === 1 ? "" : "s"} still to fill. ` : ""}Published{" "}
          {week.published_at
            ? new Date(week.published_at).toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
            : ""}
        </p>
      </main>
    </div>
  );
}
