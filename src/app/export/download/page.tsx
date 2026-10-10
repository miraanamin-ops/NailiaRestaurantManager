import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { verifyLink } from "@/lib/signed-links";

export const metadata: Metadata = { title: "Download your customer list", robots: { index: false, follow: false } };

// Where the EXPORT CUSTOMERS link from WhatsApp lands. Opening it downloads nothing:
// WhatsApp (and other apps) open links by themselves to make previews, which would
// count as downloads. The file only comes when the owner taps the button.
export default function ExportDownloadPage({ searchParams }: PageProps<"/export/download">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-stone-100" />}>
      <Download searchParams={searchParams} />
    </Suspense>
  );
}

async function Download({ searchParams }: Pick<PageProps<"/export/download">, "searchParams">) {
  await connection(); // the link's expiry is checked against the time of each visit
  const q = await searchParams;
  const one = (k: string) => (Array.isArray(q[k]) ? q[k][0] : q[k]) ?? "";
  const r = one("r");
  const t = one("t");
  const valid = verifyLink("customer-export", r, t);
  return (
    <div className="flex min-h-dvh items-center justify-center bg-stone-100 p-5 text-stone-900">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-sm">
        <p className="text-3xl" aria-hidden>
          📄
        </p>
        <h1 className="mt-2 text-xl font-bold">Your customer list</h1>
        {valid ? (
          <>
            <p className="mt-2 text-sm text-stone-600">A CSV file for Excel, Numbers or Google Sheets. It has your customers&apos; contact details, so keep it safe.</p>
            <form method="post" action="/export/customers" className="mt-5">
              <input type="hidden" name="r" value={r} />
              <input type="hidden" name="t" value={t} />
              <button type="submit" className="w-full rounded-full bg-stone-900 px-6 py-4 text-base font-semibold text-white">
                Download
              </button>
            </form>
          </>
        ) : (
          <p className="mt-2 text-sm text-stone-600">This link has expired (they last an hour). Text EXPORT CUSTOMERS on WhatsApp for a new one.</p>
        )}
      </div>
    </div>
  );
}
