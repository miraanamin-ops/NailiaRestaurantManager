import { PageSkeleton } from "@/components/app-shell";
import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { loadOnboarding } from "@/app/onboarding/load";
import { loadChat } from "@/lib/onboarding/dina/chat";
import { ChatClient } from "./chat-client";

export const metadata: Metadata = { title: "Set up with Dina · DinerAI", robots: { index: false, follow: false } };

// The web chat with Dina. Logged in, and only for the owner's own restaurant
// (loadOnboarding). The conversation so far is drawn here; new turns stream in.
export default function ChatPage({ searchParams }: PageProps<"/onboarding/chat">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Chat searchParams={searchParams} />
    </Suspense>
  );
}

async function Chat({ searchParams }: Pick<PageProps<"/onboarding/chat">, "searchParams">) {
  await connection(); // always the conversation as it is now
  const { restaurantId } = await loadOnboarding(searchParams, "/onboarding/chat");
  const chat = await loadChat(restaurantId);
  // "Change" on the summary card opens the chat at that step (?step=menu).
  const step = (await searchParams).step;
  return <ChatClient restaurantId={restaurantId} {...chat} jumpTo={typeof step === "string" && /^[a-z_]{2,30}$/.test(step) ? step : null} />;
}
