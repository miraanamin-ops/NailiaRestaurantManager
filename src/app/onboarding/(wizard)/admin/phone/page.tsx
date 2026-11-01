import { PageSkeleton } from "@/components/app-shell";
import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { requireOwner } from "@/lib/auth";
import { demoConversation, demoPhones } from "@/lib/demo-phone";
import { Card, Frame } from "@/app/onboarding/ui";
import { sendAsDemo } from "./actions";
import { AutoRefresh } from "./refresh";

export const metadata: Metadata = { title: "Demo phone · DinerAI", robots: { index: false, follow: false } };

// The builder's demo phone: talk to a demo restaurant (on a placeholder owner
// number) as its owner, exactly as on WhatsApp, and see its answers. Test
// commands (TIME, RUN BRIEF, RUN REPORT...) work here. Builder only.
export default function DemoPhonePage({ searchParams }: PageProps<"/onboarding/admin/phone">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <DemoPhone searchParams={searchParams} />
    </Suspense>
  );
}

const small = "rounded-full px-3 py-2 text-sm font-semibold ring-1 ring-stone-300 hover:ring-stone-500";
const QUICK = ["1", "2", "3", "HELP", "RUN BRIEF", "RUN REPORT", "TIME OFF"];

async function DemoPhone({ searchParams }: Pick<PageProps<"/onboarding/admin/phone">, "searchParams">) {
  await connection();
  const owner = await requireOwner("/onboarding/admin/phone");
  if (!owner.isBuilder) notFound();
  const q = await searchParams;
  const phones = await demoPhones();
  const chosen = typeof q.r === "string" ? phones.find((p) => p.id === q.r) : phones[0];
  const convo = chosen ? await demoConversation(chosen.id) : null;
  const sent = typeof q.sent === "string" ? Number(q.sent) : 0;

  return (
    <Frame>
      <p className="text-sm">
        <Link href="/onboarding/admin" className="underline">
          ← Setup test controls
        </Link>
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Demo phone</h1>
      <p className="mt-2 text-sm text-stone-500">
        Write as a demo restaurant&apos;s owner. It goes in exactly like a WhatsApp message; answers are never sent anywhere, only shown here. Buttons: reply 1, 2 or 3.
      </p>
      {typeof q.error === "string" && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{q.error}</p>}
      {!phones.length && <p className="mt-4 text-sm text-stone-500">No demo restaurant is on a placeholder number yet (scripts/demo-numbers.mjs).</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        {phones.map((p) => (
          <Link key={p.id} href={`/onboarding/admin/phone?r=${p.id}`} className={`${small} ${p.id === chosen?.id ? "bg-stone-900 text-white" : ""}`}>
            {p.name}
          </Link>
        ))}
      </div>
      {convo && (
        <Card>
          <div className="space-y-2">
            {convo.messages.length ? (
              convo.messages.map((m) => (
                <div key={m.id} className={m.direction === "inbound" ? "flex justify-end" : "flex justify-start"}>
                  <p
                    className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${m.direction === "inbound" ? "bg-[#d9fdd3]" : "bg-stone-100"}`}
                  >
                    {m.body}
                    <span className="mt-1 block text-[11px] text-stone-400">
                      {new Date(m.created_at).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "short", timeStyle: "short" })}
                    </span>
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-stone-500">No messages yet.</p>
            )}
          </div>
          <form action={sendAsDemo} className="flex gap-2">
            <input type="hidden" name="r" value={convo.restaurant.id} />
            <input name="body" aria-label="Message" autoComplete="off" className="min-w-0 flex-1 rounded-full border border-stone-300 px-4 py-3 text-base" placeholder="Message" />
            <button className="rounded-full bg-[#c8f03c] px-4 py-3 font-semibold text-[#0b0c0a]">Send</button>
          </form>
          <div className="flex flex-wrap gap-2">
            {QUICK.map((t) => (
              <form key={t} action={sendAsDemo}>
                <input type="hidden" name="r" value={convo.restaurant.id} />
                <input type="hidden" name="body" value={t} />
                <button className={small}>{t}</button>
              </form>
            ))}
          </div>
        </Card>
      )}
      {sent > 0 && <AutoRefresh since={sent} />}
    </Frame>
  );
}
