import { PageSkeleton } from "@/components/app-shell";
import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { requireOwner } from "@/lib/auth";
import { formatLondon } from "@/lib/clock";
import { closuresView, type Closure } from "@/lib/closure";
import { EXPORT_DAYS } from "@/lib/closure-rules";
import { Card, Frame } from "@/app/onboarding/ui";
import { cancelClose, confirmClose, requestClose, retryClose } from "./actions";

export const metadata: Metadata = { title: "Close an account · DinerAI", robots: { index: false, follow: false } };

// The builder's close-account controls (lib/closure.ts): ask once (request), ask
// again (confirm), a 24-hour cooling-off that can be cancelled, then the closing.
// The owner-facing version (web and WhatsApp) comes later. Builder only.
export default function ClosePage({ searchParams }: PageProps<"/onboarding/admin/close">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Close searchParams={searchParams} />
    </Suspense>
  );
}

const small = "rounded-full px-3 py-2 text-sm font-semibold ring-1 ring-stone-300 hover:ring-stone-500";
const input = "rounded-full px-3 py-2 text-sm ring-1 ring-stone-300";
const when = (iso: string | null) => (iso ? formatLondon(new Date(iso)) : "");

function Pending({ c }: { c: Closure & { name: string | null } }) {
  const name = c.name ?? "(gone)";
  const hidden = <input type="hidden" name="c" value={c.id} />;
  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold">{name}</h3>
        <span className="text-sm text-stone-500">
          {c.ref} · {c.kind.replace("_", " ")} · {c.status}
        </span>
      </div>
      {c.status === "requested" && (
        <>
          <p className="text-sm text-stone-700">
            Requested {when(c.requested_at)}. Nothing has changed yet. Confirming pauses sending, emails the owner, and closes the account after 24 hours (cancellable until then). Closing makes a {EXPORT_DAYS}-day export (CSV and JSON) and emails the link, stops our Google access, cancels Stripe if it&apos;s on, then deletes every customer, file, chat and setting. One anonymous line is kept.
          </p>
          <form action={confirmClose} className="space-y-2">
            {hidden}
            <input name="name" required autoComplete="off" placeholder={`Type "${name}" again`} aria-label={`Type the restaurant name, ${name}, again`} className={`${input} w-full`} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="understood" required /> I understand everything for {name} will be deleted, and it can&apos;t be undone.
            </label>
            {c.kind !== "real" && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="skip" /> Skip the 24-hour cooling-off (demo and Pilot Zero restaurants only)
              </label>
            )}
            <button className={`${small} text-red-700`}>Confirm closing</button>
          </form>
        </>
      )}
      {c.status === "scheduled" && <p className="text-sm text-stone-700">Confirmed {when(c.confirmed_at)}. Sending is paused. Closes {when(c.closes_at)}.</p>}
      {c.status === "closing" && <p className="text-sm text-stone-700">Closing now (refresh to see it finish).</p>}
      {c.status === "failed" && <p className="text-sm text-red-700">Stopped with an error: {c.last_error}. Nothing after the failed step was done.</p>}
      <div className="flex flex-wrap gap-2">
        {(c.status === "requested" || c.status === "scheduled" || c.status === "failed") && (
          <form action={cancelClose}>
            {hidden}
            <button className={small}>Cancel closing</button>
          </form>
        )}
        {c.status === "failed" && (
          <form action={retryClose}>
            {hidden}
            <button className={small}>Try again</button>
          </form>
        )}
      </div>
    </Card>
  );
}

async function Close({ searchParams }: Pick<PageProps<"/onboarding/admin/close">, "searchParams">) {
  await connection();
  const owner = await requireOwner("/onboarding/admin/close");
  if (!owner.isBuilder) notFound();
  const q = await searchParams;
  const view = await closuresView();
  const pending = view?.closures.filter((c) => ["requested", "scheduled", "closing", "failed"].includes(c.status)) ?? [];
  const done = view?.closures.filter((c) => c.status === "closed" || c.status === "cancelled") ?? [];
  const busy = new Set(pending.map((c) => c.restaurant_id));

  return (
    <Frame>
      <p className="text-sm">
        <Link href="/onboarding/admin" className="underline">
          Setup test controls
        </Link>
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Close an account</h1>
      {typeof q.done === "string" && <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">✓ {q.done}</p>}
      {typeof q.error === "string" && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{q.error}</p>}
      {!view ? (
        <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">This database doesn&apos;t have closing set up yet (supabase/056_pilot_zero.sql).</p>
      ) : (
        <>
          <h2 className="mt-6 text-xl font-semibold">Start closing</h2>
          <form action={requestClose} className="mt-2 flex flex-wrap gap-2">
            <select name="r" aria-label="Restaurant" className={input}>
              {view.restaurants
                .filter((r) => !busy.has(r.id))
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.pilot_zero ? " (Pilot Zero)" : r.is_demo ? " (demo)" : ""}
                  </option>
                ))}
            </select>
            <input name="name" required autoComplete="off" placeholder="Type its name" aria-label="Type the restaurant's name" className={`${input} min-w-0 flex-1`} />
            <button className={`${small} text-red-700`}>Request closing</button>
          </form>
          <p className="mt-1 text-sm text-stone-500">Ember &amp; Spice and Cardamom Corner can&apos;t be closed.</p>

          <h2 className="mt-8 text-xl font-semibold">In progress ({pending.length})</h2>
          <div className="mt-3 space-y-3">{pending.length ? pending.map((c) => <Pending key={c.id} c={c} />) : <p className="text-sm text-stone-500">None.</p>}</div>

          <h2 className="mt-8 text-xl font-semibold">Closed and cancelled</h2>
          <ul className="mt-2 space-y-1 text-sm text-stone-700">
            {done.length ? (
              done.map((c) => (
                <li key={c.id}>
                  {c.ref} · {c.kind.replace("_", " ")} · {c.status === "closed" ? `closed ${when(c.closed_at)}: ${c.counts?.customers ?? 0} customers, ${c.counts?.files ?? 0} files deleted; export ${c.export_deleted_at ? "deleted" : `until ${when(c.export_expires_at)}`}` : `cancelled ${when(c.cancelled_at)}${c.name ? ` (${c.name})` : ""}`}
                </li>
              ))
            ) : (
              <li className="text-stone-500">None.</li>
            )}
          </ul>
        </>
      )}
    </Frame>
  );
}
