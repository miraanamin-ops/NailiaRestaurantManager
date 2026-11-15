import { Suspense } from "react";
import { connection } from "next/server";
import { PageSkeleton } from "@/components/app-shell";
import { designResults } from "@/lib/email/design-results";
import { MIN } from "@/lib/email/design-results-rules";
import { LOOK_NAMES, type Look } from "@/lib/email/designs";
import { requireFounder } from "@/lib/founder/access";
import { AdminPage, Card, H1, H2 } from "../_ui";

// How the customer email designs do (phase 5 of the Inbox and emails plan), all
// restaurants together, last 12 months: per look, and with a dish photo against without.
// A look that clearly does worse than its family's others is left out of the turns.
export default function EmailsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Emails />
    </Suspense>
  );
}

const FAMILY: Record<string, string> = { discount: "Discount", occasion: "Occasion", quiet: "Quiet night", new_dish: "New dish", birthday: "Birthday" };
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

async function Emails() {
  await connection();
  await requireFounder("/admin/emails");
  const r = await designResults();
  return (
    <AdminPage>
      <H1 sub="Real customer emails only (not owner copies or simulated sends), all restaurants, last 12 months. Clicks are the yardstick: Apple Mail opens every email by itself, so opens run high.">Email designs</H1>

      <section className="grid gap-3">
        <H2>Photo or no photo</H2>
        <Card>
          <p className="text-[15px] text-[#edefe8]">{r.photo ?? `Not enough yet to say. It needs ${MIN.photoSends} emails from ${MIN.photoCampaigns} campaigns each with and without a photo, and a difference that holds up.`}</p>
        </Card>
      </section>

      <section className="grid gap-3">
        <H2 aside={<span className="text-[13px] text-[#a3a99d]">{r.emails.toLocaleString("en-GB")} emails</span>}>By look</H2>
        <Card className="overflow-x-auto">
          {r.looks.length ? (
            <table className="w-full min-w-[640px] text-left text-[14px] tabular-nums">
              <thead className="text-[12px] uppercase tracking-[0.08em] text-[#a3a99d]">
                <tr>
                  <th className="py-2 pr-3 font-medium">Kind</th>
                  <th className="py-2 pr-3 font-medium">Look</th>
                  <th className="py-2 pr-3 text-right font-medium">Emails</th>
                  <th className="py-2 pr-3 text-right font-medium">Campaigns</th>
                  <th className="py-2 pr-3 text-right font-medium">Opened</th>
                  <th className="py-2 pr-3 text-right font-medium">Clicked</th>
                  <th className="py-2 text-right font-medium">Redeemed</th>
                </tr>
              </thead>
              <tbody>
                {r.looks.map((l) => (
                  <tr key={`${l.family}:${l.look}`} className="border-t border-[#1e221b] text-[#edefe8]">
                    <td className="py-2 pr-3 text-[#a3a99d]">{FAMILY[l.family] ?? l.family}</td>
                    <td className="py-2 pr-3">
                      {LOOK_NAMES[l.look as Look] ?? l.look}
                      {r.skipped.includes(l.look) && <span className="ml-2 rounded-full bg-[#ff8a6e]/15 px-2 py-0.5 text-[11px] text-[#ffc9ba]">left out of the turns</span>}
                    </td>
                    <td className="py-2 pr-3 text-right">{l.sent}</td>
                    <td className="py-2 pr-3 text-right">{l.campaigns}</td>
                    <td className="py-2 pr-3 text-right text-[#a3a99d]">{pct(l.openRate)}</td>
                    <td className="py-2 pr-3 text-right">{pct(l.clickRate)}</td>
                    <td className="py-2 text-right">{pct(l.redeemRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-[15px] text-[#a3a99d]">No designed emails sent yet.</p>
          )}
        </Card>
        <p className="text-[13px] text-[#a3a99d]">
          A look leaves the turns only with {MIN.lookSends}+ emails from {MIN.lookCampaigns}+ campaigns, a click rate under 70% of the rest of its kind, and a difference that passes a 95% test. At most one per kind; it comes back if the numbers change.
        </p>
      </section>
    </AdminPage>
  );
}
