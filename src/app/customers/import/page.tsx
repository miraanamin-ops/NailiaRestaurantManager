import { PageSkeleton } from "@/components/app-shell";
import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { pickRestaurantId, requireOwner } from "@/lib/auth";
import { MAX_IMPORT_ROWS } from "@/lib/customer-import/rules";
import { button, Card, Frame } from "../../onboarding/ui";

export const metadata: Metadata = { title: "Import customers", robots: { index: false, follow: false } };

// Import a customer list: choose the file (CSV or Excel). The next page shows what
// was found and asks how these people agreed to hear from the restaurant.
export default function ImportCustomersPage({ searchParams }: PageProps<"/customers/import">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Upload searchParams={searchParams} />
    </Suspense>
  );
}

async function Upload({ searchParams }: Pick<PageProps<"/customers/import">, "searchParams">) {
  const q = await searchParams;
  const one = (k: string) => (Array.isArray(q[k]) ? q[k]![0] : (q[k] as string | undefined));
  const owner = await requireOwner(`/customers/import${one("r") ? `?r=${one("r")}` : ""}`);
  const rid = pickRestaurantId(owner, one("r"));
  if (!rid) return <Frame>That restaurant couldn&apos;t be found.</Frame>;
  return (
    <Frame>
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Import customers</h1>
      <p className="mb-4 text-sm text-stone-600">
        Add customers you already have, from a booking system, a loyalty scheme or a spreadsheet: up to {MAX_IMPORT_ROWS.toLocaleString("en-GB")} at a time. Nothing is saved or sent until you&apos;ve checked it.
      </p>
      {one("error") && <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-red-800">{one("error")}</p>}
      <Card>
        <form action="/customers/import/upload" method="post" encType="multipart/form-data" className="space-y-3">
          <input type="hidden" name="r" value={rid} />
          <label className="block text-sm font-medium">
            Your list (CSV or Excel, with a column of email addresses)
            <input type="file" name="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="mt-2 block w-full text-sm" required />
          </label>
          <button className={button}>Check the file</button>
        </form>
      </Card>
      <p className="mt-4 text-sm text-stone-600">
        You can also just send the file to DinerAI in the app. <Link className="text-emerald-700 underline" href={`/customers?r=${rid}`}>Back to customers</Link>
      </p>
    </Frame>
  );
}
