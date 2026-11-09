import { Suspense } from "react";
import type { Metadata } from "next";
import { PageSkeleton } from "@/components/app-shell";
import { Icon } from "@/components/icons";
import { RestaurantSwitcher } from "@/components/restaurant-switcher";
import { btnSecondary, EmptyCard, Eyebrow, Page, PageHeader, Pill, Section, Tile, WhatsAppTip, withR } from "@/components/ui";
import { ownerPage } from "@/lib/dashboard/page-context";
import { birthdayOn, compare } from "@/lib/dashboard/rules";
import { check } from "@/lib/drafts";
import { addDays } from "@/lib/sales/format";
import { londonYmd } from "@/lib/clock";
import { getSupabase } from "@/lib/supabase";
import { importHistory } from "@/lib/customer-import";

// The owner's email list: how it's growing, who's who, the QR cards, imports and the export.
const IMPORT_STATUS: Record<string, string> = {
  imported: "Welcome email waiting for your approval",
  sending: "Sending welcome emails",
  done: "Welcome emails sent",
  paused: "Paused: too many bounced",
  undone: "Removed",
};
// Only this restaurant's customers; deleted ones never show.
export const metadata: Metadata = { title: "Customers · DinerAI", robots: { index: false, follow: false } };

export default function CustomersPage({ searchParams }: PageProps<"/customers">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Customers searchParams={searchParams} />
    </Suspense>
  );
}

type Row = {
  id: string;
  name: string;
  email: string | null;
  birthday: string | null;
  created_at: string;
  email_confirmed_at: string | null;
  unsubscribed_at: string | null;
  source: string | null;
  import_status: string | null;
};

const DAY_MS = 86_400_000;

async function Customers({ searchParams }: Pick<PageProps<"/customers">, "searchParams">) {
  const { owner, restaurant, choices, one, now } = await ownerPage("/customers", searchParams);
  if (!restaurant) return <Page narrow>No restaurant found for {owner.email}.</Page>;
  const r = restaurant.id;
  const all =
    check(
      await getSupabase()
        .from("customers")
        .select("id, name, email, birthday, created_at, email_confirmed_at, unsubscribed_at, source, import_status")
        .eq("restaurant_id", r)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(2000)
        .returns<Row[]>(),
    ) ?? [];
  // On the list: confirmed their email, or (imported) their welcome email has gone.
  const onList = (c: Row) => !c.unsubscribed_at && (Boolean(c.email_confirmed_at) || c.import_status === "welcomed");
  const confirmed = all.filter(onList);
  const imports = await importHistory(r).catch(() => []);
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  const twoWeeksAgo = new Date(now.getTime() - 14 * DAY_MS).toISOString();
  const joined = (c: Row) => c.email_confirmed_at ?? c.created_at;
  const newNow = confirmed.filter((c) => joined(c) >= weekAgo).length;
  const newBefore = confirmed.filter((c) => joined(c) >= twoWeeksAgo && joined(c) < weekAgo).length;
  const waitingConfirm = all.filter((c) => !c.email_confirmed_at && c.source === "signup").length;
  const today = londonYmd(now);
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const birthdays = confirmed.filter((c) => week.some((d) => birthdayOn(c.birthday, d)));
  const q = (one("q") ?? "").trim().toLowerCase();
  const list = (q ? all.filter((c) => c.name.toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q)) : all).slice(0, 100);
  const status = (c: Row) =>
    c.unsubscribed_at ? (
      <Pill>Unsubscribed</Pill>
    ) : onList(c) ? (
      <Pill tone="signal">On the list</Pill>
    ) : c.import_status === "not_contacted" ? (
      <Pill tone="amber">Imported, not yet contacted</Pill>
    ) : (
      <Pill tone="amber">Not confirmed</Pill>
    );

  return (
    <Page>
      <RestaurantSwitcher choices={choices} current={r} path="/customers" />
      <PageHeader
        eyebrow="Customers"
        title="Your email list"
        sub="People who signed up with your QR code and confirmed their email."
        action={
          <span className="flex gap-2">
            <a href={`/customers/import?r=${r}`} className={btnSecondary}>
              <Icon name="upload" className="h-4 w-4" /> Import customers
            </a>
            <a href={`/export/customers?r=${r}`} className={btnSecondary}>
              <Icon name="download" className="h-4 w-4" /> Export
            </a>
          </span>
        }
      />
      {one("done") && <p className="mb-4 rounded-xl bg-emerald-950/40 px-4 py-3 text-[14px] text-[#c8f03c]">✓ {one("done")}</p>}
      {one("oops") && <p className="mb-4 rounded-xl bg-amber-950/40 px-4 py-3 text-[14px] text-amber-200">{one("oops")}</p>}
      <div className="space-y-8">
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <Tile label="On your list" value={confirmed.length.toLocaleString("en-GB")} foot="Can get your offers" />
          <Tile label="New this week" value={newNow} change={compare(newNow, newBefore)} changeText={newBefore || newNow ? `${newBefore} last week` : undefined} />
          <Tile label="Birthdays" value={birthdays.length} foot="In the next 7 days" />
          <Tile label="Not confirmed" value={waitingConfirm} foot="Haven't tapped the email link yet" />
        </div>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Section title="Everyone" count={all.length}>
            <form action="/customers" method="get" className="flex gap-2">
              <input type="hidden" name="r" value={r} />
              <input
                name="q"
                defaultValue={one("q") ?? ""}
                placeholder="Search by name or email"
                className="h-11 min-w-0 flex-1 rounded-xl bg-[#171a14] px-4 text-[15px] text-[#edefe8] ring-1 ring-[#2c3127] placeholder:text-[#6e7468] focus:outline-none focus:ring-[#c8f03c]"
              />
              <button className={btnSecondary}>Search</button>
            </form>
            {list.length ? (
              <div className="divide-y divide-[#1e221b] overflow-hidden rounded-2xl bg-[#171a14]">
                {list.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-[14px] text-[#edefe8]">{c.name}</div>
                      <div className="truncate text-[12px] text-[#a3a99d]">
                        {c.email ?? "No email"} · joined{" "}
                        {new Date(joined(c)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" })}
                      </div>
                    </div>
                    {status(c)}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyCard icon="customers" title={q ? "Nobody matches that" : "No customers yet"} text={q ? "Try part of a name or email." : "Put your QR cards on the tables: customers sign up for your reward and join your list."} />
            )}
            {all.length > list.length && !q && <p className="text-[12px] text-[#6e7468]">Showing the newest 100. Search, or export the full list.</p>}
          </Section>

          <div className="space-y-6">
            <Section title="Get more sign-ups">
              <div className="space-y-3 rounded-2xl bg-[#171a14] p-4">
                <p className="text-[14px] text-[#a3a99d]">
                  Customers scan your QR code, tick to hear from you and get {restaurant.signup_reward ? <span className="text-[#edefe8]">{restaurant.signup_reward}</span> : "your sign-up reward"}.
                </p>
                {restaurant.slug && (
                  <a href={`/r/${restaurant.slug}/qr-pack`} className={`${btnSecondary} w-full`}>
                    <Icon name="qr" className="h-4 w-4" /> Print QR table cards
                  </a>
                )}
                {restaurant.slug && (
                  <a href={`/r/${restaurant.slug}`} className="block text-center text-[13px] text-[#a3a99d] underline">
                    See your sign-up page
                  </a>
                )}
              </div>
            </Section>
            {imports.length > 0 && (
              <Section title="Imports">
                <div className="divide-y divide-[#1e221b] rounded-2xl bg-[#171a14]">
                  {imports.map((imp) => (
                    <div key={imp.id} className="space-y-1 px-4 py-3 text-[13px] text-[#a3a99d]">
                      <div className="text-[14px] text-[#edefe8]">
                        {new Date(imp.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" })}: {imp.rows_added.toLocaleString("en-GB")} customers
                        {imp.file_name ? ` (${imp.file_name})` : ""}
                      </div>
                      <div>{imp.basis === "opted_in" ? "They opted in" : "Past customers, given a chance to opt out"}{imp.double_opt_in ? " · asked to confirm first" : ""}</div>
                      <div>
                        {IMPORT_STATUS[imp.status] ?? imp.status} · sent {imp.sent} · bounced {imp.bounced} · unsubscribed {imp.unsubscribed}
                      </div>
                      {imp.status !== "undone" && (
                        <form action={`/customers/import/${imp.id}/remove`} method="post">
                          <input type="hidden" name="r" value={r} />
                          <button className="text-[13px] text-amber-300 underline">Remove this import</button>
                        </form>
                      )}
                    </div>
                  ))}
                </div>
              </Section>
            )}
            {birthdays.length > 0 && (
              <Section title="Birthdays this week">
                <div className="divide-y divide-[#1e221b] rounded-2xl bg-[#171a14]">
                  {birthdays.slice(0, 8).map((c) => (
                    <div key={c.id} className="flex items-center justify-between px-4 py-2.5 text-[14px]">
                      <span className="text-[#edefe8]">{c.name}</span>
                      <Eyebrow>{c.birthday ? new Date(`2000-${c.birthday.slice(5, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : ""}</Eyebrow>
                    </div>
                  ))}
                </div>
              </Section>
            )}
            <WhatsAppTip>
              Text <span className="text-[#edefe8]">“Thursday is quiet”</span> for an offer email to your list, or <span className="text-[#edefe8]">EXPORT CUSTOMERS</span> for a download link.
              Settings has the full list of what you can change: <a className="underline" href={withR("/settings", r)}>open Settings</a>.
            </WhatsAppTip>
          </div>
        </div>
      </div>
    </Page>
  );
}
