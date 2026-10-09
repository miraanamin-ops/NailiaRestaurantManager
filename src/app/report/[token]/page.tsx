import { Suspense } from "react";
import type { Metadata } from "next";
import { NotFoundCard } from "@/components/brand-shell";
import { getReportByToken } from "@/lib/report/build";
import { Section } from "./sections";

export const metadata: Metadata = { title: "Weekly report", robots: { index: false } };

// The Monday report: a frozen snapshot behind a private link, read on the owner's phone.
export default function ReportPage({ params }: PageProps<"/report/[token]">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-stone-100" />}>
      <Report params={params} />
    </Suspense>
  );
}

async function Report({ params }: Pick<PageProps<"/report/[token]">, "params">) {
  const { token } = await params;
  const report = await getReportByToken(token);
  if (!report) return <NotFoundCard />;
  const { data } = report;
  const brand = data.restaurant.brandColor;

  return (
    <div className="min-h-dvh bg-stone-100 text-stone-900">
      <header className="px-4 pb-10 pt-8 text-white" style={{ background: data.restaurant.brandDark }}>
        <div className="mx-auto max-w-xl">
          <div className="mb-3 h-1 w-10 rounded-full" style={{ background: brand }} />
          <p className="text-sm text-stone-300">Weekly report · {data.period.label}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{data.restaurant.name}</h1>
          <p className="mt-1 text-xs text-stone-400">Compared with the week before ({data.period.prevLabel})</p>
          <a
            href={`/report/${token}/pdf`}
            className="mt-5 inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white active:opacity-80"
            style={{ background: brand }}
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden>
              <path d="M10 2a1 1 0 0 1 1 1v8.6l2.3-2.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L9 11.6V3a1 1 0 0 1 1-1ZM4 15a1 1 0 0 1 1 1v1h10v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Z" />
            </svg>
            Download PDF
          </a>
        </div>
      </header>
      <main className="mx-auto -mt-5 w-full max-w-xl space-y-4 px-4 pb-12">
        {data.sections.map((s) => (
          <Section key={s.id} section={s} ctx={{ data, brand }} />
        ))}
        <p className="pt-2 text-center text-xs text-stone-500">
          {data.googleMode === "dummy" ? "Test data: Google isn't connected yet. " : ""}Made{" "}
          {new Date(report.created_at).toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
        </p>
      </main>
    </div>
  );
}
