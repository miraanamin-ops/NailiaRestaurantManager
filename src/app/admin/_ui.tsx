import Link from "next/link";
import { Eyebrow } from "@/components/ui";

// Pieces of the founder dashboard: a wide page, number tiles with a definition,
// and a one-series monthly bar chart (hover a bar for its value; the numbers are
// also in a table under it).

export function AdminPage({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto w-full max-w-7xl space-y-8 px-4 pb-16 pt-6 sm:px-6">{children}</main>;
}

export function H1({ children, sub, aside }: { children: React.ReactNode; sub?: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[28px] font-semibold tracking-[-0.02em] text-[#edefe8]">{children}</h1>
        {sub && <div className="mt-1 text-[14px] text-[#a3a99d]">{sub}</div>}
      </div>
      {aside}
    </div>
  );
}

export function H2({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-[#edefe8]">{children}</h2>
      {aside}
    </div>
  );
}

// A headline number. `info` is its exact definition (hover or tap the i).
export function Stat({ label, value, change, good = "up", info, foot, href }: { label: string; value: React.ReactNode; change?: { dir: "up" | "down"; text: string } | null; good?: "up" | "down" | "none"; info: string; foot?: React.ReactNode; href?: string }) {
  const colour = !change || good === "none" ? "text-[#a3a99d]" : change.dir === good ? "text-[#c8f03c]" : "text-[#ff8a6e]";
  const body = (
    <div className="flex h-full flex-col gap-1 rounded-2xl bg-[#171a14] p-4 transition hover:bg-[#1b1f18]">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <Eyebrow>{label}</Eyebrow>
          <span title={info} aria-label={info} className="cursor-help rounded-full px-1 font-mono text-[11px] text-[#6e7468] ring-1 ring-[#2c3127]">
            i
          </span>
        </span>
        {change && <span className={`font-mono text-[11px] font-semibold ${colour}`}>{change.text}</span>}
      </div>
      <div className="text-[26px] font-semibold tracking-[-0.02em] text-[#edefe8]">{value}</div>
      {foot && <div className="text-[12px] text-[#a3a99d]">{foot}</div>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-[#171a14] p-4 ${className}`}>{children}</div>;
}

// One measure by month: bars from a zero baseline, the latest month's value
// labelled, every bar's value on hover, and the numbers in a table below.
export function MonthBars({ title, info, months, format, tone = "signal" }: { title: string; info: string; months: { label: string; value: number | null }[]; format: (v: number) => string; tone?: "signal" | "ember" | "sky" }) {
  const colour = { signal: "#c8f03c", ember: "#ff7a3d", sky: "#bfe6ff" }[tone];
  const values = months.map((m) => m.value ?? 0);
  const max = Math.max(...values, 0) || 1;
  const W = 100 / months.length;
  const last = months[months.length - 1];
  return (
    <Card>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <div className="text-[14px] font-medium text-[#edefe8]">{title}</div>
          <div className="text-[12px] text-[#6e7468]">{info}</div>
        </div>
        <div className="text-right">
          <div className="text-[18px] font-semibold text-[#edefe8]">{last.value === null ? "–" : format(last.value)}</div>
          <div className="text-[11px] text-[#6e7468]">{last.label} so far</div>
        </div>
      </div>
      <div className="relative h-32">
        <div className="absolute inset-x-0 bottom-5 top-0 flex items-end">
          {months.map((m, i) => {
            const h = m.value === null ? 0 : Math.max((m.value / max) * 100, m.value > 0 ? 2 : 0);
            return (
              <div key={m.label} className="group relative flex h-full items-end justify-center px-[2px]" style={{ width: `${W}%` }} title={`${m.label}: ${m.value === null ? "no data" : format(m.value)}`}>
                <div className="w-full max-w-[28px] rounded-t-[4px] transition-opacity group-hover:opacity-80" style={{ height: `${h}%`, background: colour, opacity: i === months.length - 1 ? 1 : 0.55 }} />
                <div className="pointer-events-none absolute -top-6 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-[#2c3127] px-2 py-0.5 text-[11px] text-[#edefe8] group-hover:block">
                  {m.value === null ? "–" : format(m.value)}
                </div>
              </div>
            );
          })}
        </div>
        <div className="absolute inset-x-0 bottom-5 border-t border-[#2c3127]" />
        <div className="absolute inset-x-0 bottom-0 flex">
          {months.map((m, i) => (
            <div key={m.label} className="text-center font-mono text-[9px] text-[#6e7468]" style={{ width: `${W}%` }}>
              {i % 2 === months.length % 2 ? m.label : ""}
            </div>
          ))}
        </div>
      </div>
      <details className="mt-2 text-[12px] text-[#a3a99d]">
        <summary className="cursor-pointer select-none">Table</summary>
        <table className="mt-2 w-full">
          <tbody>
            {[...months].reverse().map((m) => (
              <tr key={m.label} className="border-t border-[#1e221b]">
                <td className="py-1">{m.label}</td>
                <td className="py-1 text-right font-mono text-[#edefe8]">{m.value === null ? "–" : format(m.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </Card>
  );
}

export function Light({ light }: { light: "green" | "amber" | "red" }) {
  const c = { green: "#c8f03c", amber: "#ffb23d", red: "#ff7a3d" }[light];
  const word = { green: "OK", amber: "Look", red: "Problem" }[light];
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-[#a3a99d]">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />
      {word}
    </span>
  );
}

export const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }) : "–";
export const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }) : "–");
export const usd = (n: number) => (n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`);
export const months1 = (n: number) => (n < 1 ? `${Math.round(n * 30.4375)} days` : `${n.toFixed(1)} mo`);
