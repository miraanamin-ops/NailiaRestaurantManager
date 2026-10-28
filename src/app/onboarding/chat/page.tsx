import { PageSkeleton } from "@/components/app-shell";
import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { getSession, startOnboarding } from "@/lib/onboarding/sessions";
import { loadOnboarding } from "../load";
import { Card, Frame } from "../ui";

export const metadata: Metadata = { title: "Set up with Dina · DinerAI", robots: { index: false, follow: false } };

// The web chat with Dina. PLACEHOLDER until phase 4 (docs/onboarding-audit.md):
// for now it only records that the owner chose the web.
export default function ChatPage({ searchParams }: PageProps<"/onboarding/chat">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Chat searchParams={searchParams} />
    </Suspense>
  );
}

async function Chat({ searchParams }: Pick<PageProps<"/onboarding/chat">, "searchParams">) {
  const { restaurantId } = await loadOnboarding(searchParams, "/onboarding/chat");
  const session = (await getSession(restaurantId)) ?? (await startOnboarding(restaurantId, { channel: "web" }));
  return (
    <Frame>
      <Card>
        <h1 className="text-xl font-bold">Dina&apos;s chat is on its way</h1>
        <p className="text-stone-600">The web chat comes in the next build. You&apos;re on step: {session.current_step ?? "all done"}.</p>
        <Link href={`/onboarding/in?r=${restaurantId}`} className="block text-center text-sm font-medium text-emerald-700 underline">
          Back
        </Link>
      </Card>
    </Frame>
  );
}
