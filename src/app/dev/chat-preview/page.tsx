import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { ChatPreview } from "./preview";

export const metadata: Metadata = { title: "Chat preview · DinerAI", robots: { index: false, follow: false } };

// The web chat's look, with sample conversations (?scene=hello|google|tone|menu|summary),
// for signing it off and for screenshots. Only on a copy running on this computer:
// on Vercel (the live site and previews) it doesn't exist.
export default function ChatPreviewPage({ searchParams }: PageProps<"/dev/chat-preview">) {
  return (
    <Suspense fallback={null}>
      <Preview searchParams={searchParams} />
    </Suspense>
  );
}

async function Preview({ searchParams }: Pick<PageProps<"/dev/chat-preview">, "searchParams">) {
  await connection();
  if (process.env.VERCEL || process.env.NODE_ENV === "production") notFound();
  const q = await searchParams;
  const scene = typeof q.scene === "string" ? q.scene : "hello";
  return <ChatPreview key={scene} scene={scene} />;
}
