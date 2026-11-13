import Link from "next/link";
import { sparkPath, type Change } from "@/lib/dashboard/rules";
import { Icon, type IconName } from "./icons";

// The DinerAI owner-page design system (the Stitch mockups, Nov 2026): near-black
// ink, cards a step lighter, chartreuse "signal" for the one main action and good
// news, ember for urgent, amber for "needs a look". Raw colours on purpose: the
// ordinary Tailwind colour names are re-pointed inside .dai-app (globals.css).

export const C = {
  ink: "#0b0c0a",
  card: "#171a14",
  raised: "#1e221b",
  line: "#2c3127",
  mist: "#edefe8",
  fog: "#a3a99d",
  muted: "#6e7468",
  signal: "#c8f03c",
  ember: "#ff7a3d",
  amber: "#ffb23d",
  neg: "#ff8a6e",
  sky: "#bfe6ff",
};

export const btnPrimary =
  "inline-flex h-10 items-center justify-center gap-1.5 rounded-full bg-[#c8f03c] px-4 text-[14px] font-semibold text-[#0b0c0a] transition hover:bg-[#d6f86a] active:opacity-85 disabled:opacity-50";
export const btnSecondary =
  "inline-flex h-10 items-center justify-center gap-1.5 rounded-full bg-[#1e221b] px-4 text-[14px] font-medium text-[#edefe8] ring-1 ring-[#2c3127] transition hover:ring-[#3a4034] active:opacity-85";
export const btnGhost = "inline-flex h-10 items-center justify-center rounded-full px-3 text-[14px] text-[#a3a99d] transition hover:text-[#edefe8]";
export const linkText = "text-[13px] text-[#a3a99d] transition hover:text-[#edefe8]";

// Page width for the owner pages (the frame adds the sidebar on big screens).
export function Page({ children, narrow = false }: { children: React.ReactNode; narrow?: boolean }) {
  return <main className={`mx-auto w-full ${narrow ? "max-w-2xl" : "max-w-5xl"} px-4 pb-10 pt-5 sm:px-6`}>{children}</main>;
}

export function Eyebrow({ children, className = "", tone = "fog" }: { children: React.ReactNode; className?: string; tone?: "fog" | "signal" | "ember" | "amber" }) {
  const colour = { fog: "text-[#a3a99d]", signal: "text-[#c8f03c]", ember: "text-[#ff7a3d]", amber: "text-[#ffb23d]" }[tone];
  return <span className={`font-mono text-[11px] uppercase leading-[14px] tracking-[0.18em] ${colour} ${className}`}>{children}</span>;
}

export function PageHeader({ eyebrow, title, sub, action }: { eyebrow?: string; title: string; sub?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h1 className="mt-1 text-[28px] font-semibold leading-tight tracking-[-0.02em] text-[#edefe8]">{title}</h1>
        {sub && <div className="mt-1 text-[14px] text-[#a3a99d]">{sub}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Panel({ children, className = "", edge }: { children: React.ReactNode; className?: string; edge?: "ember" | "amber" | "signal" }) {
  const edgeColour = edge ? { ember: "bg-[#ff7a3d]", amber: "bg-[#ffb23d]", signal: "bg-[#c8f03c]" }[edge] : null;
  return (
    <div className={`relative overflow-hidden rounded-2xl bg-[#171a14] p-4 ${className}`}>
      {edgeColour && <div className={`absolute inset-y-0 left-0 w-1 ${edgeColour}`} />}
      {children}
    </div>
  );
}

export function Section({
  title,
  count,
  href,
  linkLabel = "See all",
  aside,
  children,
  id,
}: {
  title: string;
  count?: number | string;
  href?: string;
  linkLabel?: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-[#edefe8]">{title}</h2>
          {count !== undefined && <span className="rounded-full bg-[#1e221b] px-2 py-0.5 font-mono text-[11px] text-[#a3a99d]">{count}</span>}
        </div>
        {aside ?? (href ? (
          <Link href={href} className={linkText}>
            {linkLabel}
          </Link>
        ) : null)}
      </div>
      {children}
    </section>
  );
}

type Tone = "signal" | "amber" | "ember" | "neutral" | "sky" | "neg";
const PILL: Record<Tone, string> = {
  signal: "bg-[#c8f03c]/10 text-[#c8f03c] ring-[#c8f03c]/30",
  amber: "bg-[#ffb23d]/12 text-[#ffb23d] ring-[#ffb23d]/30",
  ember: "bg-[#ff7a3d]/12 text-[#ff7a3d] ring-[#ff7a3d]/30",
  neg: "bg-[#ff8a6e]/12 text-[#ff8a6e] ring-[#ff8a6e]/30",
  sky: "bg-[#bfe6ff]/10 text-[#bfe6ff] ring-[#bfe6ff]/25",
  neutral: "bg-[#1e221b] text-[#a3a99d] ring-[#2c3127]",
};
export function Pill({ tone = "neutral", children, dot = false }: { tone?: Tone; children: React.ReactNode; dot?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-medium ring-1 ${PILL[tone]}`}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function Spark({ values, tone = "signal" }: { values: number[]; tone?: "signal" | "fog" }) {
  const d = sparkPath(values);
  if (!d) return <div className="h-7" />;
  const colour = tone === "signal" ? C.signal : C.fog;
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="h-7 w-full" aria-hidden>
      <path d={`${d} L100 28 L0 28 Z`} fill={colour} fillOpacity={0.1} />
      <path d={d} fill="none" stroke={colour} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// A number tile: label, big number, change, optional sparkline and a foot line.
export function Tile({
  label,
  value,
  change,
  changeText,
  goodWhenUp = true,
  spark,
  foot,
  href,
}: {
  label: string;
  value: React.ReactNode;
  change?: Change | null;
  changeText?: string;
  goodWhenUp?: boolean;
  spark?: number[];
  foot?: React.ReactNode;
  href?: string;
}) {
  const good = change ? (change.dir === "same" ? null : (change.dir === "up") === goodWhenUp) : null;
  const colour = good === null ? "text-[#a3a99d]" : good ? "text-[#c8f03c]" : "text-[#ff8a6e]";
  const body = (
    <div className="flex h-full flex-col gap-1.5 rounded-2xl bg-[#171a14] p-3.5 transition hover:bg-[#1b1f18]">
      <div className="flex items-center justify-between gap-2">
        <Eyebrow>{label}</Eyebrow>
        {changeText && change?.dir !== "same" && <span className={`font-mono text-[11px] font-semibold ${colour}`}>{changeText}</span>}
      </div>
      <div className="text-[22px] font-semibold tracking-[-0.02em] text-[#edefe8]">{value}</div>
      {spark && spark.length > 1 && <Spark values={spark} />}
      {foot && <div className="text-[12px] text-[#a3a99d]">{foot}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

export function Stars({ rating, size = "text-[13px]" }: { rating: number; size?: string }) {
  const r = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <span className={`${size} leading-none tracking-tight`} aria-label={`${rating} out of 5 stars`}>
      <span className={r <= 3 ? "text-[#ff7a3d]" : "text-[#ffb23d]"}>{"★".repeat(r)}</span>
      <span className="text-[#2c3127]">{"★".repeat(5 - r)}</span>
    </span>
  );
}

// A row inside a list card: icon, label, value on the right, chevron.
export function Row({
  href,
  icon,
  label,
  sub,
  value,
  danger = false,
}: {
  href?: string;
  icon?: IconName;
  label: string;
  sub?: React.ReactNode;
  value?: React.ReactNode;
  danger?: boolean;
}) {
  const inner = (
    <>
      <div className="flex min-w-0 items-center gap-3">
        {icon && <Icon name={icon} className={`h-5 w-5 ${danger ? "text-[#ff8a6e]" : "text-[#a3a99d]"}`} />}
        <div className="min-w-0">
          <div className={`truncate text-[15px] ${danger ? "font-medium text-[#ff8a6e]" : "text-[#edefe8]"}`}>{label}</div>
          {sub && <div className="truncate text-[12px] text-[#a3a99d]">{sub}</div>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 text-[13px] text-[#a3a99d]">
        {value}
        {href && <Icon name="chevron" className="h-4 w-4 transition group-hover:translate-x-0.5" />}
      </div>
    </>
  );
  return href ? (
    <Link href={href} className="group flex min-h-[54px] items-center justify-between gap-3 px-4 py-2.5 transition hover:bg-[#1e221b]">
      {inner}
    </Link>
  ) : (
    <div className="flex min-h-[54px] items-center justify-between gap-3 px-4 py-2.5">{inner}</div>
  );
}

export function ListCard({ children }: { children: React.ReactNode }) {
  return <div className="divide-y divide-[#2c3127] overflow-hidden rounded-2xl bg-[#171a14]">{children}</div>;
}

// A green, amber or red message at the top of a page (after a form, say).
export function Notice({ tone = "signal", children }: { tone?: "signal" | "neg" | "amber"; children: React.ReactNode }) {
  const cls = {
    signal: "bg-[#c8f03c]/10 text-[#e4f9a8] ring-[#c8f03c]/25",
    neg: "bg-[#ff8a6e]/10 text-[#ffc9ba] ring-[#ff8a6e]/30",
    amber: "bg-[#ffb23d]/10 text-[#ffe2a8] ring-[#ffb23d]/30",
  }[tone];
  return <div className={`whitespace-pre-line rounded-2xl px-4 py-3 text-[14px] ring-1 ${cls}`}>{children}</div>;
}

// Shown where there's no data yet: what it is and how to get it, never a row of zeros.
export function EmptyCard({ icon, title, text, children }: { icon?: IconName; title: string; text: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-[#2c3127] bg-[#121410] p-4">
      <div className="flex items-start gap-3">
        {icon && (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#1e221b] text-[#a3a99d]">
            <Icon name={icon} className="h-[18px] w-[18px]" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-medium text-[#edefe8]">{title}</div>
          <div className="mt-0.5 text-[13px] leading-snug text-[#a3a99d]">{text}</div>
          {children && <div className="mt-3 flex flex-wrap gap-2">{children}</div>}
        </div>
      </div>
    </div>
  );
}

// A tip about doing the same thing on WhatsApp.
export function AppTip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-[#121410] p-4 ring-1 ring-[#1e221b]">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#c8f03c]/12 text-[#c8f03c]">
        <Icon name="chat" className="h-[17px] w-[17px]" />
      </div>
      <p className="text-[13px] leading-relaxed text-[#a3a99d]">{children}</p>
    </div>
  );
}

// ?r= kept on every link, so the builder stays on the restaurant they're looking at.
export function withR(path: string, r: string | null | undefined) {
  if (!r) return path;
  return `${path}${path.includes("?") ? "&" : "?"}r=${r}`;
}
