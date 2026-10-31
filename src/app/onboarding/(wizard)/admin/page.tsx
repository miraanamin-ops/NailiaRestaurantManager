import { PageSkeleton } from "@/components/app-shell";
import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { requireOwner } from "@/lib/auth";
import { availableSteps, STEP_DEFS } from "@/lib/onboarding/flow";
import { setupsForAdmin } from "@/lib/onboarding/dina/test-sites";
import { Card, Frame } from "@/app/onboarding/ui";
import { deleteTest, jumpTest, linkMyNumber, markGoogleAccepted, resetTest, startTest } from "./actions";

export const metadata: Metadata = { title: "Setup test controls · DinerAI", robots: { index: false, follow: false } };

// The builder's view of setup with Dina: every restaurant setting up (progress,
// step, channel, Google, gaps, a 48-hour stall flag), test restaurants apart from
// real ones, and the test controls. Builder only.
export default function AdminPage({ searchParams }: PageProps<"/onboarding/admin">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Admin searchParams={searchParams} />
    </Suspense>
  );
}

const small = "rounded-full px-3 py-2 text-sm font-semibold ring-1 ring-stone-300 hover:ring-stone-500 disabled:opacity-50";

async function Admin({ searchParams }: Pick<PageProps<"/onboarding/admin">, "searchParams">) {
  await connection();
  const owner = await requireOwner("/onboarding/admin");
  if (!owner.isBuilder) notFound();
  const q = await searchParams;
  const setups = await setupsForAdmin();
  const tests = setups.filter((s) => s.is_test);
  const real = setups.filter((s) => !s.is_test);
  type Setup = (typeof setups)[number];

  const row = (s: Setup) => (
    <Card key={s.id}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold">{s.name}</h3>
        <span className="text-sm text-stone-500">
          {s.progress} · {s.step} · last on {s.session.channel_last_used ?? "?"}
          {s.active ? " · switched on" : ""}
        </span>
      </div>
      <p className="text-sm text-stone-600">
        Google: {s.google} · WhatsApp {s.owner_whatsapp ? "linked" : "not linked"}
        {s.gaps.length ? ` · gaps: ${s.gaps.join(", ")}` : ""}
        {s.stalled && <b className="text-amber-700"> · no progress for 48 hours</b>}
      </p>
      <div className="flex flex-wrap gap-2">
        <Link href={`/onboarding/chat?r=${s.id}`} className={small}>
          Open the chat
        </Link>
        {s.googleWaiting && (
          <form action={markGoogleAccepted}>
            <input type="hidden" name="r" value={s.id} />
            <button className={small}>Mark Google accepted</button>
          </form>
        )}
        {s.is_test && (
          <>
            <form action={jumpTest} className="flex gap-1">
              <input type="hidden" name="r" value={s.id} />
              <select name="step" aria-label="Step to jump to" className="rounded-full px-2 text-sm ring-1 ring-stone-300">
                {availableSteps().map((k) => (
                  <option key={k} value={k}>
                    {STEP_DEFS[k].title}
                  </option>
                ))}
              </select>
              <button className={small}>Jump</button>
            </form>
            <form action={linkMyNumber}>
              <input type="hidden" name="r" value={s.id} />
              <button className={small}>Link my WhatsApp</button>
            </form>
            <form action={resetTest}>
              <input type="hidden" name="r" value={s.id} />
              <button className={small}>Reset to step 1</button>
            </form>
            <form action={deleteTest}>
              <input type="hidden" name="r" value={s.id} />
              <button className={`${small} text-red-700`}>Delete</button>
            </form>
          </>
        )}
      </div>
    </Card>
  );

  return (
    <Frame>
      <h1 className="text-3xl font-bold tracking-tight">Setup test controls</h1>
      {typeof q.done === "string" && <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">✓ {q.done}</p>}
      {typeof q.error === "string" && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{q.error}</p>}
      <form action={startTest} className="mt-4">
        <button className="block w-full rounded-full bg-[#c8f03c] px-4 py-4 text-center text-base font-semibold text-[#0b0c0a]">Start a test onboarding</button>
      </form>
      <p className="mt-2 text-sm text-stone-500">A test restaurant never reaches anyone real on any channel. It opens straight into the chat with Dina.</p>

      <h2 className="mt-8 text-xl font-semibold">Test restaurants ({tests.length})</h2>
      <div className="mt-3 space-y-3">{tests.length ? tests.map(row) : <p className="text-sm text-stone-500">None yet.</p>}</div>

      <h2 className="mt-8 text-xl font-semibold">Real restaurants setting up ({real.length})</h2>
      <div className="mt-3 space-y-3">{real.length ? real.map(row) : <p className="text-sm text-stone-500">None yet.</p>}</div>
    </Frame>
  );
}
