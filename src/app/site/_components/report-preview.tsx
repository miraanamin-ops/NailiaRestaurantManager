import type { site } from "@/content/site";

type Report = (typeof site)["report"];

// A Monday report preview, styled like the real one (/report/<token>), with
// made-up numbers that are labelled as an example on the card and on each figure group.
export function ReportPreview({ report, example }: { report: Report; example: string }) {
  const max = Math.max(...report.days.flatMap((d) => [d.value, d.last]));
  const W = 320;
  const H = 120;
  const slot = W / report.days.length;
  const bar = slot * 0.3;
  const y = (v: number) => H - (v / max) * (H - 8);

  return (
    <div className="relative overflow-hidden rounded-3xl border border-ink-700 bg-mist text-ink-950 shadow-[0_40px_100px_-40px_rgb(0_0_0_/_0.8)]">
      <div className="flex items-center justify-between gap-3 border-b border-ink-950/10 bg-ink-950 px-4 py-2.5 text-mist sm:px-6">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-fog">Monday report</span>
        <span className="rounded border border-ember px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ember">{report.stamp}</span>
      </div>

      <div className="p-4 sm:p-6">
        <p className="font-mono text-[11px] uppercase tracking-wider text-ink-950/60">
          {report.restaurant} · {report.week}
        </p>
        <p className="mt-2 text-balance text-xl font-semibold leading-snug tracking-[-0.01em] sm:text-2xl">{report.headline}</p>

        <div className="mt-5 flex items-center justify-between">
          <p className="font-mono text-[10.5px] uppercase tracking-wider text-ink-950/60">Last week vs the week before</p>
          <DarkExample>{example}</DarkExample>
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {report.kpis.map((k) => (
            <div key={k.label} className="rounded-xl bg-white p-3 ring-1 ring-ink-950/5">
              <dt className="text-[12px] text-ink-950/65">{k.label}</dt>
              <dd className="mt-1 flex items-baseline gap-1.5">
                <span className="font-mono text-xl font-semibold tabular-nums">{k.value}</span>
                <span className="font-mono text-[11px] font-medium text-[#3d6b00]">{k.change}</span>
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-5 rounded-xl bg-white p-3 ring-1 ring-ink-950/5 sm:p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] font-medium">{report.chartLabel}</p>
            <p className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-wider text-ink-950/60">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm bg-ink-950" aria-hidden />
                {report.thisWeek}
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm border border-ink-950/40" aria-hidden />
                {report.lastWeek}
              </span>
            </p>
          </div>
          <svg
            viewBox={`0 0 ${W} ${H + 18}`}
            className="mt-2 w-full"
            role="img"
            aria-label={`${example}: ${report.chartLabel}. ${report.days.map((d) => `${d.day} £${d.value.toLocaleString("en-GB")}`).join(", ")}.`}
          >
            {report.days.map((d, i) => {
              const x = i * slot + slot / 2;
              return (
                <g key={d.day}>
                  <rect x={x - bar - 1} y={y(d.last)} width={bar} height={H - y(d.last)} rx="2" fill="none" stroke="#0b0c0a" strokeOpacity="0.3" />
                  <rect x={x + 1} y={y(d.value)} width={bar} height={H - y(d.value)} rx="2" fill={d.day === "Thu" ? "#7aa300" : "#0b0c0a"} />
                  <text x={x} y={H + 14} textAnchor="middle" fontSize="10" fill="#0b0c0a" fillOpacity="0.6" fontFamily="var(--font-geist-mono)">
                    {d.day}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <p className="mt-5 font-mono text-[10.5px] uppercase tracking-wider text-ink-950/60">{report.actionsLabel}</p>
        <ol className="mt-2 space-y-2">
          {report.actions.map((a, i) => (
            <li key={a} className="flex flex-col gap-2 rounded-xl bg-white p-3 ring-1 ring-ink-950/5 sm:flex-row sm:items-center sm:justify-between">
              <span className="flex gap-2 text-[14px]">
                <span className="font-mono text-ink-950/70">{i + 1}.</span>
                {a}
              </span>
              <span className="self-start rounded-full bg-ink-950 px-3 py-1.5 text-[12px] font-medium text-mist sm:self-auto">{report.actionButton}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

// The example tag on the light report card.
function DarkExample({ children }: { children: React.ReactNode }) {
  return <span className="rounded border border-[#b4471a] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[#b4471a]">{children}</span>;
}

