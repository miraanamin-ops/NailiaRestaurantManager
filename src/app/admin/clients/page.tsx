import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { PageSkeleton } from "@/components/app-shell";
import { requireFounder } from "@/lib/founder/access";
import { loadClients, isTestSite, type Client } from "@/lib/founder/data";
import { PAYING, STANDING_LABEL } from "@/lib/founder/metrics";
import { AdminPage, H1, Light, months1, usd, when } from "../_ui";

// Every client: search by name, email or phone; filter by status; sort any column.
export default function ClientsPage({ searchParams }: PageProps<"/admin/clients">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Clients searchParams={searchParams} />
    </Suspense>
  );
}

const STATUSES: Record<string, { label: string; test: (c: Client) => boolean }> = {
  all: { label: "All", test: () => true },
  attention: { label: "Needs attention", test: (c) => c.health.light !== "green" },
  active: { label: "Active", test: (c) => Boolean(c.r.active) },
  trialing: { label: "Free trial", test: (c) => c.standing === "trialing" },
  paying: { label: "Paying", test: (c) => PAYING.has(c.standing) },
  pilot: { label: "Pilot / free", test: (c) => c.standing === "pilot" || c.standing === "exempt" },
  setup: { label: "In setup", test: (c) => !c.r.active && !["ended", "closed"].includes(c.standing) },
  cancelled: { label: "Cancelled", test: (c) => c.standing === "ended" },
};

const SORTS: Record<string, { label: string; key: (c: Client) => number | string }> = {
  name: { label: "Name", key: (c) => c.r.name.toLowerCase() },
  health: { label: "Health", key: (c) => ({ red: 0, amber: 1, green: 2 })[c.health.light] },
  months: { label: "Months active", key: (c) => -c.monthsActive },
  cost: { label: "Claude (month)", key: (c) => -c.aiCostMonthUsd },
  seen: { label: "Last used", key: (c) => -(c.lastSeenAt ? Date.parse(c.lastSeenAt) : 0) },
  joined: { label: "Joined", key: (c) => -Date.parse(c.r.created_at) },
};

const digits = (s: string) => s.replace(/\D/g, "");

async function Clients({ searchParams }: Pick<PageProps<"/admin/clients">, "searchParams">) {
  await connection();
  await requireFounder("/admin/clients");
  const q = await searchParams;
  const one = (k: string) => (Array.isArray(q[k]) ? q[k][0] : q[k]) ?? "";
  const search = one("q").trim().toLowerCase();
  const status = STATUSES[one("status")] ? one("status") : "all";
  const sort = SORTS[one("sort")] ? one("sort") : "health";
  const includeTest = one("test") === "1";
  const { clients } = await loadClients({ includeTest });
  const list = clients
    .filter(STATUSES[status].test)
    .filter((c) => {
      if (!search) return true;
      const hay = [c.r.name, c.r.owner_name, c.r.owner_email, c.r.slug, c.r.referral_code].filter(Boolean).join(" ").toLowerCase();
      const phone = digits(search).length >= 4 && [c.r.owner_whatsapp, c.r.phone].some((p) => p && digits(p).includes(digits(search)));
      return hay.includes(search) || phone;
    })
    .sort((a, b) => {
      const x = SORTS[sort].key(a), y = SORTS[sort].key(b);
      return x < y ? -1 : x > y ? 1 : a.r.name.localeCompare(b.r.name);
    });
  const link = (over: Record<string, string>) => {
    const p = new URLSearchParams({ ...(search ? { q: search } : {}), status, sort, ...(includeTest ? { test: "1" } : {}), ...over });
    return `/admin/clients?${p}`;
  };

  return (
    <AdminPage>
      <H1
        sub={`${list.length} of ${clients.length} ${includeTest ? "restaurants (test sites included)" : "real clients"}`}
        aside={
          <div className="flex gap-2">
            <Link href={link({ test: includeTest ? "0" : "1" })} className="rounded-full px-3 py-1.5 text-[13px] text-[#a3a99d] ring-1 ring-[#2c3127] hover:text-[#edefe8]">
              {includeTest ? "Hide test sites" : "Show test sites"}
            </Link>
            <a href={`/admin/clients/export${includeTest ? "?test=1" : ""}`} className="rounded-full px-3 py-1.5 text-[13px] text-[#a3a99d] ring-1 ring-[#2c3127] hover:text-[#edefe8]">
              Download CSV
            </a>
          </div>
        }
      >
        Clients
      </H1>

      <form className="flex flex-wrap gap-2" action="/admin/clients">
        <input name="q" defaultValue={search} placeholder="Name, email, phone or referral code" className="h-10 min-w-[260px] flex-1 rounded-full bg-[#171a14] px-4 text-[14px] text-[#edefe8] ring-1 ring-[#2c3127] placeholder:text-[#6e7468]" />
        <input type="hidden" name="status" value={status} />
        <input type="hidden" name="sort" value={sort} />
        {includeTest && <input type="hidden" name="test" value="1" />}
        <button className="h-10 rounded-full bg-[#c8f03c] px-4 text-[14px] font-semibold text-[#0b0c0a]">Search</button>
      </form>

      <div className="flex flex-wrap gap-1.5">
        {Object.entries(STATUSES).map(([k, s]) => (
          <Link key={k} href={link({ status: k })} className={`rounded-full px-3 py-1 text-[13px] ring-1 ${k === status ? "bg-[#c8f03c]/10 text-[#c8f03c] ring-[#c8f03c]/30" : "text-[#a3a99d] ring-[#2c3127] hover:text-[#edefe8]"}`}>
            {s.label} <span className="font-mono text-[11px] opacity-70">{clients.filter(s.test).length}</span>
          </Link>
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl bg-[#171a14]">
        <table className="w-full min-w-[900px] text-[13px]">
          <thead className="text-left text-[11px] uppercase tracking-wider text-[#6e7468]">
            <tr>
              {[
                ["name", "Restaurant"],
                ["", "Owner"],
                ["", "Status"],
                ["months", "Months active"],
                ["", "Paid"],
                ["cost", "Claude (month)"],
                ["seen", "Last used"],
                ["health", "Health"],
              ].map(([k, label]) => (
                <th key={label} className="px-4 py-3 font-medium">
                  {k ? (
                    <Link href={link({ sort: k })} className={k === sort ? "text-[#c8f03c]" : "hover:text-[#edefe8]"}>
                      {label}
                    </Link>
                  ) : (
                    label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.r.id} className="border-t border-[#1e221b] hover:bg-[#1b1f18]">
                <td className="px-4 py-2.5">
                  <Link href={`/admin/clients/${c.r.id}`} className="font-medium text-[#edefe8] hover:underline">
                    {c.r.name}
                  </Link>
                  {isTestSite(c.r) && <span className="ml-2 rounded-full bg-[#1e221b] px-2 py-0.5 text-[10px] text-[#a3a99d]">test</span>}
                </td>
                <td className="px-4 py-2.5 text-[#a3a99d]">
                  <div>{c.r.owner_name ?? "–"}</div>
                  <div className="text-[11px]">{c.r.owner_email}</div>
                </td>
                <td className="px-4 py-2.5 text-[#edefe8]">{c.closing ? "Closing" : STANDING_LABEL[c.standing]}</td>
                <td className="px-4 py-2.5 font-mono text-[#edefe8]">{months1(c.monthsActive)}</td>
                <td className="px-4 py-2.5 font-mono text-[#a3a99d]">{c.monthsPaid ? months1(c.monthsPaid) : "–"}</td>
                <td className="px-4 py-2.5 font-mono text-[#edefe8]">{usd(c.aiCostMonthUsd)}</td>
                <td className="px-4 py-2.5 text-[#a3a99d]">{when(c.lastSeenAt)}</td>
                <td className="px-4 py-2.5" title={c.health.reasons.map((r) => r.text).join("\n")}>
                  <Light light={c.health.light} />
                </td>
              </tr>
            ))}
            {!list.length && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-[#a3a99d]">
                  No clients match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AdminPage>
  );
}
