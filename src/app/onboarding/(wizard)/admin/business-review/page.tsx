import { PageSkeleton } from "@/components/app-shell";
import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { requireOwner } from "@/lib/auth";
import { formatLondon } from "@/lib/clock";
import { reviewAdminRows, type AdminReviewRow } from "@/lib/review/admin";
import { Card, Frame } from "@/app/onboarding/ui";
import { runReview } from "./actions";

export const metadata: Metadata = { title: "Business review · DinerAI", robots: { index: false, follow: false } };

// The builder's "Run business review" for any restaurant (lib/review/admin.ts):
// pick it, check its Google dry run, type its name, confirm. Builder only.
export default function BusinessReviewAdmin({ searchParams }: PageProps<"/onboarding/admin/business-review">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Admin searchParams={searchParams} />
    </Suspense>
  );
}

const small = "rounded-full px-3 py-2 text-sm font-semibold ring-1 ring-stone-300 hover:ring-stone-500";
const onOff = (dry: boolean) => (dry ? "dry run (nothing reaches Google)" : "LIVE (approved items go to Google)");

function Status({ row }: { row: AdminReviewRow }) {
  if (!row.review) return <span>no review yet</span>;
  const when = row.review.sent_at ?? row.review.created_at;
  return (
    <span>
      review {row.review.status} ({row.review.started_by}) · {formatLondon(new Date(when))}
    </span>
  );
}

async function Admin({ searchParams }: Pick<PageProps<"/onboarding/admin/business-review">, "searchParams">) {
  await connection();
  const owner = await requireOwner("/onboarding/admin/business-review");
  if (!owner.isBuilder) notFound();
  const q = await searchParams;
  const rows = await reviewAdminRows();
  const picked = typeof q.confirm === "string" ? rows.find((r) => r.id === q.confirm) : undefined;

  return (
    <Frame>
      <p className="text-sm">
        <Link href="/onboarding/admin" className="underline">
          ← Setup test controls
        </Link>
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Run business review</h1>
      <p className="mt-2 text-sm text-stone-600">
        The review Dina sends after setup: she reads the reviews and profile, drafts the work and sends one WhatsApp message. Everything she drafts waits for the owner&apos;s approval, and every Google write goes through the release gate, so a dry run stays a dry run.
      </p>
      {typeof q.done === "string" && <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">✓ {q.done}</p>}
      {typeof q.error === "string" && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{q.error}</p>}

      {picked && (
        <Card>
          <h2 className="text-xl font-semibold">Run it for {picked.name}?</h2>
          <ul className="mt-2 list-disc pl-5 text-sm text-stone-700">
            <li>
              {picked.kind === "real" ? <b>A real restaurant.</b> : `A ${picked.kind} restaurant.`} The owner gets the message in the app.
            </li>
            <li>Google: {picked.google}{picked.pilotZero ? " · Pilot Zero" : ""}</li>
            <li>Review replies and posts: {onOff(picked.repliesDryRun)}</li>
            <li>Profile changes (hours, description, photos): {onOff(picked.profileDryRun)}</li>
            <li>
              <Status row={picked} />
            </li>
          </ul>
          <form action={runReview} className="mt-3 space-y-2">
            <input type="hidden" name="r" value={picked.id} />
            <label className="block text-sm">
              Type <b>{picked.name}</b> to confirm
              <input name="name" autoComplete="off" className="mt-1 block w-full rounded-full px-3 py-2 ring-1 ring-stone-300" />
            </label>
            {picked.review && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="again" /> Run again (replaces the old review; what it drafted stays in the queue)
              </label>
            )}
            <button className="rounded-full bg-[#c8f03c] px-4 py-3 text-sm font-semibold text-[#0b0c0a]">Run business review</button>
            <Link href="/onboarding/admin/business-review" className={`${small} ml-2 inline-block`}>
              Cancel
            </Link>
          </form>
        </Card>
      )}

      <div className="mt-6 space-y-3">
        {rows.map((row) => (
          <Card key={row.id}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-lg font-semibold">{row.name}</h3>
              <span className="text-sm text-stone-500">
                {row.kind} · Google {row.google} · replies {row.repliesDryRun ? "dry run" : "live"} · profile {row.profileDryRun ? "dry run" : "live"}
              </span>
            </div>
            <p className="text-sm text-stone-600">
              <Status row={row} />
            </p>
            <Link href={`/onboarding/admin/business-review?confirm=${row.id}`} className={`${small} inline-block`}>
              Run business review…
            </Link>
          </Card>
        ))}
        {!rows.length && <p className="text-sm text-stone-500">No restaurant has WhatsApp linked yet.</p>}
      </div>
    </Frame>
  );
}
